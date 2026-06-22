"""Growatt SPF off-grid inverter over Modbus-RTU (SPF 5000 ES and similar).

Some SPF units speak Modbus-RTU on their USB/RS232 port instead of the Voltronic ASCII
protocol used by :class:`~app.devices.inverters.growatt.GrowattSPF`. This driver reads the
input-register block in a single request and normalizes it into the shared Reading shape.

Reached over a direct serial port, or over TCP via ``tools/usb_bridge.py`` — attach with
baud **9600** (the SPF Modbus default), which the bridge applies to the underlying port.
"""

from __future__ import annotations

import logging
from typing import List, Optional

from ...protocols import growatt_modbus as gm
from ..base import Metric, Reading
from .base import InverterDevice

log = logging.getLogger(__name__)

# Highest Modbus slave id probed when auto-detecting parallel units on the RS485 bus.
MAX_PARALLEL = 8
# Probe each address this many times before deciding it's absent, with this timeout —
# short so scanning the whole range is quick and a single dropped frame doesn't hide a unit.
DISCOVERY_RETRIES = 3
DISCOVERY_TIMEOUT = 0.8
# Re-run discovery every N polls so units that were briefly missed (or added later) appear,
# instead of being locked out by a one-time miss.
REDISCOVER_EVERY = 20


class GrowattSPFModbus(InverterDevice):
    """Growatt SPF 5000 ES / SPF off-grid (Modbus-RTU input registers).

    Parallel inverters share one RS485 bus, each with a distinct Modbus slave id. We scan
    the whole id range (not stopping at the first gap, so non-contiguous ids and transient
    misses don't hide units), retrying each address, and re-scan periodically. Override with
    ``options``: ``units`` = an int count (ids 1..N) or an explicit list of ids;
    ``max_units`` = highest id to scan.
    """

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._slaves: Optional[List[int]] = None
        self._polls_since_discovery = 0

    async def _read_unit(self, slave: int, timeout: Optional[float] = None) -> List[int]:
        frame = gm.build_read(gm.READ_START, gm.READ_COUNT, slave=slave)
        raw = await self.transport.transact(
            frame, read_bytes=gm.response_len(gm.READ_COUNT), timeout=timeout
        )
        return gm.parse_registers(raw, gm.READ_COUNT, slave=slave)

    async def _probe(self, slave: int) -> bool:
        for _ in range(DISCOVERY_RETRIES):
            try:
                await self._read_unit(slave, timeout=DISCOVERY_TIMEOUT)
                return True
            except Exception:
                continue
        return False

    async def _discover_slaves(self) -> List[int]:
        forced = self.options.get("units")
        if forced:
            if isinstance(forced, (list, tuple)):
                return [int(x) for x in forced]
            return list(range(1, int(forced) + 1))
        max_units = int(self.options.get("max_units", MAX_PARALLEL))
        # Scan the FULL range and keep every responder — no early break on a gap.
        found = [s for s in range(1, max_units + 1) if await self._probe(s)]
        return found or [1]

    async def poll(self) -> Reading:
        # Single-reading entry point (the Device API); poll_many is the parallel-aware path.
        return (await self.poll_many())[0]

    async def poll_many(self) -> List[Reading]:
        forced = bool(self.options.get("units"))
        if self._slaves is None or (not forced and self._polls_since_discovery >= REDISCOVER_EVERY):
            slaves = await self._discover_slaves()
            if slaves != self._slaves:
                log.info("Growatt %s: %d parallel unit(s) on slaves %s",
                         self.device_id, len(slaves), slaves)
            self._slaves = slaves
            self._polls_since_discovery = 0
        else:
            self._polls_since_discovery += 1

        readings: List[Reading] = []
        for i, slave in enumerate(self._slaves):
            # First unit keeps this device's id so its configured entry shows online.
            dev_id = self.device_id if i == 0 else f"{self.device_id}:{slave}"
            name = self.name if len(self._slaves) == 1 else f"{self.name} #{slave}"
            try:
                regs = await self._read_unit(slave)
                reading = Reading(
                    device_id=dev_id, device_name=name, kind=self.kind,
                    online=True, raw={"slave": slave, "registers": regs},
                )
                for key, metric in gm.parse_input_block(regs).items():
                    reading.metrics[key] = Metric(
                        value=metric["value"], unit=metric["unit"], label=metric["label"]
                    )
            except Exception as exc:  # noqa: BLE001 - report this unit offline, keep the rest
                log.warning("Modbus poll failed for %s slave %d: %s", self.device_id, slave, exc)
                reading = Reading(
                    device_id=dev_id, device_name=name, kind=self.kind,
                    online=False, error=str(exc),
                )
            readings.append(reading)
        return readings
