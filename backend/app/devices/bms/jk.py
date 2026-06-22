"""JK-BMS (Jikong) battery driver, with daisy-chain support.

Multiple packs share one RS485 bus, each with a unique address set in the JK app. Plug into
any pack (or a USB-RS485 adapter on the bus) and this driver discovers every responding
address and reports each pack as its own reading. Reached over serial directly or over TCP
via ``tools/usb_bridge.py``.

Override discovery with ``options``: ``addresses`` = explicit list of RS485 addresses;
``units`` = a count (addresses 0..N-1); ``max_address`` = highest address to scan.
"""

from __future__ import annotations

import logging
from typing import Dict, List, Optional, Tuple

from ...protocols import jk_bms as jk
from ..base import Metric, Reading
from .base import BMSDevice

log = logging.getLogger(__name__)

MAX_ADDRESS = 7          # highest RS485 address probed during auto-detect
DISCOVERY_RETRIES = 2
DISCOVERY_TIMEOUT = 0.8
REDISCOVER_EVERY = 30    # polls between re-scans, so added/missed packs appear


class JKBms(BMSDevice):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._addresses: Optional[List[int]] = None
        self._polls_since_discovery = 0

    async def _read_addr(self, address: int, timeout: Optional[float] = None):
        req = jk.build_read_all(address)
        raw = await self.transport.transact_framed(
            req, header_len=4, frame_len=jk.frame_total_len, timeout=timeout
        )
        return jk.parse(raw)  # (cells, fields)

    async def _probe(self, address: int) -> Optional[Tuple[list, dict]]:
        for _ in range(DISCOVERY_RETRIES):
            try:
                return await self._read_addr(address, timeout=DISCOVERY_TIMEOUT)
            except Exception:
                continue
        return None

    async def _discover(self) -> List[int]:
        opts = self.options
        if opts.get("addresses"):
            return [int(a) for a in opts["addresses"]]
        if opts.get("units"):
            return list(range(int(opts["units"])))
        max_addr = int(opts.get("max_address", MAX_ADDRESS))
        found: List[int] = []
        seen_sigs = set()
        for addr in range(0, max_addr + 1):
            parsed = await self._probe(addr)
            if parsed is None:
                continue
            cells, fields = parsed
            # De-dupe: address 0 can be answered by a pack that also has a real address,
            # so skip an address whose data is identical to one already found (an echo).
            sig = (tuple(cells), fields.get(0x83), fields.get(0x85), fields.get(0x87))
            if sig in seen_sigs:
                continue
            seen_sigs.add(sig)
            found.append(addr)
        return found or [0]

    async def poll(self) -> Reading:
        return (await self.poll_many())[0]

    async def poll_many(self) -> List[Reading]:
        forced = bool(self.options.get("addresses") or self.options.get("units"))
        if self._addresses is None or (not forced and self._polls_since_discovery >= REDISCOVER_EVERY):
            addrs = await self._discover()
            if addrs != self._addresses:
                log.info("JK-BMS %s: %d pack(s) at addresses %s",
                         self.device_id, len(addrs), addrs)
            self._addresses = addrs
            self._polls_since_discovery = 0
        else:
            self._polls_since_discovery += 1

        readings: List[Reading] = []
        for i, addr in enumerate(self._addresses):
            # First pack keeps this device's id so its configured entry shows online.
            dev_id = self.device_id if i == 0 else f"{self.device_id}:{addr}"
            name = self.name if len(self._addresses) == 1 else f"{self.name} #{addr}"
            try:
                cells, fields = await self._read_addr(addr)
                reading = Reading(
                    device_id=dev_id, device_name=name, kind=self.kind, online=True,
                    raw={"address": addr, "cells_mv": cells, "registers": {f"{k:#x}": v for k, v in fields.items()}},
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
