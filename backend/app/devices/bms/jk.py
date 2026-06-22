"""JK-BMS (Jikong) battery driver — modern JK02 protocol (header 0x55 0xAA 0xEB 0x90).

The BMS streams 300-byte frames at 115200. A poll reads a window of the stream and decodes
every distinct pack's cell-info (0x02) frame, so multiple packs daisy-chained on one RS485
bus are fetched automatically — no per-pack config. Each pack is tracked across polls (by
cell-voltage similarity) so it keeps a stable id/card even as values drift.

``options``: ``units`` forces the expected pack count; ``window_bytes`` tunes how much of the
stream is read per poll (must cover more than one broadcast cycle to see every pack).
"""

from __future__ import annotations

import logging
from typing import List

from ...protocols import jk_bms as jk
from ..base import Metric, Reading
from .base import BMSDevice

log = logging.getLogger(__name__)

# Read enough of the stream to span more than one full broadcast cycle of all packs.
DEFAULT_WINDOW = 8000
READ_TIMEOUT = 4.0


class JKBms(BMSDevice):
    async def poll(self) -> Reading:
        return (await self.poll_many())[0]

    async def poll_many(self) -> List[Reading]:
        window = int(self.options.get("window_bytes", DEFAULT_WINDOW))
        try:
            # The command restarts the broadcast, so packs come back in a stable order.
            buf = await self.transport.transact(
                jk.build_read_all(0), read_bytes=window, timeout=READ_TIMEOUT
            )
            packs = jk.distinct_packs(buf)
        except Exception as exc:  # noqa: BLE001 - whole link down -> single offline reading
            log.warning("JK-BMS poll failed for %s: %s", self.device_id, exc)
            return [self._offline_reading(str(exc))]

        units = self.options.get("units")
        if units:
            packs = packs[: int(units)]

        readings: List[Reading] = []
        for idx, (cells, fields) in enumerate(packs):
            # Packs are identified by broadcast order; first keeps this device's id.
            dev_id = self.device_id if idx == 0 else f"{self.device_id}:{idx}"
            name = self.name if len(packs) == 1 else f"{self.name} #{idx + 1}"
            reading = Reading(
                device_id=dev_id, device_name=name, kind=self.kind, online=True,
                raw={"pack": idx, "cells_mv": cells},
            )
            for key, metric in jk.to_metrics(cells, fields).items():
                reading.metrics[key] = Metric(
                    value=metric["value"], unit=metric["unit"], label=metric["label"]
                )
            readings.append(reading)
        return readings
