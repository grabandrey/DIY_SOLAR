"""Core device abstractions.

Every physical device (inverter, BMS, charge controller, ...) is represented by a
subclass of :class:`Device`. A device knows how to talk to its hardware through a
:class:`~app.transports.base.Transport` and turns the hardware response into a
normalized :class:`Reading`.

This is the seam that keeps the system modular: to support a new inverter or a new
battery BMS you only add a new ``Device`` subclass and register it. Nothing in the
polling loop, event bus, API or frontend needs to change.
"""

from __future__ import annotations

import abc
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Dict, List, Optional


class DeviceKind(str, Enum):
    INVERTER = "inverter"
    BMS = "bms"
    CHARGE_CONTROLLER = "charge_controller"
    METER = "meter"


@dataclass
class Metric:
    """A single normalized measurement."""

    value: Any
    unit: str = ""
    label: str = ""


@dataclass
class Reading:
    """A normalized snapshot from a device at a point in time.

    The ``metrics`` dict is the contract the API and frontend rely on, so it is the
    same shape for every device kind. ``raw`` keeps the untouched device response for
    debugging and future fields.
    """

    device_id: str
    device_name: str
    kind: DeviceKind
    online: bool = True
    ts: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    metrics: Dict[str, Metric] = field(default_factory=dict)
    raw: Dict[str, Any] = field(default_factory=dict)
    error: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "device_id": self.device_id,
            "device_name": self.device_name,
            "kind": self.kind.value,
            "online": self.online,
            "ts": self.ts,
            "error": self.error,
            "metrics": {
                key: {"value": m.value, "unit": m.unit, "label": m.label}
                for key, m in self.metrics.items()
            },
            "raw": self.raw,
        }


class Device(abc.ABC):
    """Abstract base every driver implements.

    Subclasses must set :attr:`kind` and implement :meth:`poll`. Connection handling is
    delegated to the injected transport so drivers stay protocol-focused.
    """

    kind: DeviceKind

    def __init__(self, device_id: str, name: str, transport, options: Optional[Dict[str, Any]] = None):
        self.device_id = device_id
        self.name = name
        self.transport = transport
        self.options = options or {}

    async def connect(self) -> None:
        await self.transport.open()

    async def close(self) -> None:
        await self.transport.close()

    @abc.abstractmethod
    async def poll(self) -> Reading:
        """Query the hardware and return a normalized :class:`Reading`."""
        raise NotImplementedError

    async def poll_many(self) -> List[Reading]:
        """Return one or more readings for a single physical connection.

        Most devices map to one reading (the default). Drivers for inverters wired in
        parallel override this to report each unit as its own reading (own device_id),
        so every inverter in the stack shows up separately. The first reading reuses this
        device's id (so its configured entry shows online); extras use derived ids.
        """
        return [await self.poll()]

    def _offline_reading(self, error: str) -> Reading:
        return Reading(
            device_id=self.device_id,
            device_name=self.name,
            kind=self.kind,
            online=False,
            error=error,
        )
