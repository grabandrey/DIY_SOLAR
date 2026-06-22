"""JK-BMS (Jikong) battery driver — modern JK02 protocol (header 0x55 0xAA 0xEB 0x90).

The BMS streams 300-byte frames at 115200; a poll sends the read-cell-info command and reads
a chunk of the stream, then syncs to a 0x02 (cell info) frame and decodes it.

Daisy chain: set each pack a unique RS485 address in the JK app, then list them via
``options``: ``addresses`` = explicit RS485 address list, or ``units`` = a count (1..N). With
no option the single connected/main pack is read.
"""

from __future__ import annotations

import logging
from typing import List

from ...protocols import jk_bms as jk
from ..base import Metric, Reading
from .base import BMSDevice

log = logging.getLogger(__name__)

# Read a generous slice of the stream so a full 300-byte cell-info frame is captured
# regardless of where in the stream we start.
READ_BYTES = 960
READ_TIMEOUT = 4.0


class JKBms(BMSDevice):
    def _addresses(self) -> List[int]:
        opts = self.options
        if opts.get("addresses"):
            return [int(a) for a in opts["addresses"]]
        if opts.get("units"):
            return list(range(1, int(opts["units"]) + 1))
        return [0]  # single connected pack (no RS485 addressing)

    async def _read(self, address: int):
        cmd = jk.build_read_all(address)
        raw = await self.transport.transact(cmd, read_bytes=READ_BYTES, timeout=READ_TIMEOUT)
        return jk.parse(raw)  # (cells, fields)

    async def poll(self) -> Reading:
        return (await self.poll_many())[0]

    async def poll_many(self) -> List[Reading]:
        addresses = self._addresses()
        readings: List[Reading] = []
        for i, addr in enumerate(addresses):
            # First pack keeps this device's id so its configured entry shows online.
            dev_id = self.device_id if i == 0 else f"{self.device_id}:{addr}"
            name = self.name if len(addresses) == 1 else f"{self.name} #{addr}"
            try:
                cells, fields = await self._read(addr)
                reading = Reading(
                    device_id=dev_id, device_name=name, kind=self.kind, online=True,
                    raw={"address": addr, "cells_mv": cells},
                )
                for key, metric in jk.to_metrics(cells, fields).items():
                    reading.metrics[key] = Metric(
                        value=metric["value"], unit=metric["unit"], label=metric["label"]
                    )
            except Exception as exc:  # noqa: BLE001 - this pack offline, keep the rest
                log.warning("JK-BMS poll failed for %s addr %d: %s", self.device_id, addr, exc)
                reading = Reading(
                    device_id=dev_id, device_name=name, kind=self.kind, online=False, error=str(exc)
                )
            readings.append(reading)
        return readings
