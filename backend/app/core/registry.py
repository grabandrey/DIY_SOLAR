"""Driver registry + device factory.

Maps a string ``driver`` name from config to a concrete :class:`Device` subclass.
Register a new inverter or BMS class here (one line) and it becomes available to the
whole system. This is the single place that knows about every supported device type.
"""

from __future__ import annotations

from typing import Any, Dict, List, Type

from ..devices.base import Device
from ..devices.bms.base import ExampleBMS
from ..devices.inverters.axpert import AxpertInverter
from ..devices.inverters.growatt import GrowattSPF
from ..transports.base import build_transport

DRIVERS: Dict[str, Type[Device]] = {
    # Axpert King and Phocos share the Voltronic protocol.
    "axpert": AxpertInverter,
    "phocos": AxpertInverter,
    # Growatt SPF 5000 ES / SPF off-grid family (also Voltronic protocol).
    "growatt": GrowattSPF,
    "growatt_spf": GrowattSPF,
    # Example BMS stub - replace/extend with real drivers later.
    "example_bms": ExampleBMS,
}


def build_device(config: Dict[str, Any]) -> Device:
    driver = config["driver"]
    if driver not in DRIVERS:
        raise ValueError(f"Unknown driver {driver!r}. Known: {sorted(DRIVERS)}")
    cls = DRIVERS[driver]
    transport = build_transport(config["transport"])
    return cls(
        device_id=config["id"],
        name=config.get("name", config["id"]),
        transport=transport,
        options=config.get("options", {}),
    )


def build_devices(configs: List[Dict[str, Any]]) -> List[Device]:
    return [build_device(c) for c in configs if c.get("enabled", True)]
