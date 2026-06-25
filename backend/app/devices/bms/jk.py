"""JK-BMS (Jikong) battery driver — modern JK02 protocol (header 0x55 0xAA 0xEB 0x90).

The BMS streams 300-byte frames at 115200. A poll reads a window of the stream and decodes
every pack's cell-info (0x02) frame, so multiple packs daisy-chained on one RS485 bus are
fetched automatically — no per-pack config.

Packs are kept across polls *by position in the broadcast cycle*. Distinct packs are told
apart by both their cell voltages and their stable identity fields (cycle count, rated
capacity) — see ``jk_bms._same_pack`` — so a balanced bank with near-identical cell voltages
(typical right after you add a fresh pack to the daisy chain) no longer collapses two packs
into one. A pack that's briefly missing from a capture window is carried forward with its
last-known reading rather than dropped, so the set of batteries the API exposes is stable and
the frontend shows all of them immediately on connect instead of having them appear one by
one as windows happen to capture them.

Pack count auto-detects: every pack physically on the bus is shown, so plugging another JK
battery into the parallel/daisy-chain ports makes it appear on its own with no config change.
``options``: ``units`` is an optional hard cap on how many packs to show (leave unset to show
all that are present); ``window_seconds`` tunes how long the stream is read per poll (must
cover more than one broadcast cycle to see every pack).
"""

from __future__ import annotations

import logging
from typing import Dict, List, Tuple

from ...protocols import jk_bms as jk
from ..base import Metric, Reading
from .base import BMSDevice

log = logging.getLogger(__name__)

# The JK streams at its own (slow) pace, so we read for a fixed DURATION and take whatever
# arrived rather than a fixed byte count (which would time out). The window must span more
# than one full broadcast cycle to capture every pack at least once.
# Wide enough that a long daisy chain's full broadcast cycle fits even when each pack
# broadcasts slowly; `until=jk.cycle_complete` stops the read early once every pack has been
# seen once, so a normal poll returns well before this and only a slow/incomplete bus waits.
DEFAULT_WINDOW_SECONDS = 8.0
MAX_WINDOW_BYTES = 32000

# A pack slot absent from a poll is still reported online for this many consecutive polls
# (short windows routinely skip a pack); after that it's reported offline, and after
# DROP_AFTER consecutive misses it's forgotten entirely (truly removed).
HOLD_MISSES = 4
DROP_AFTER = 60


class _Track:
    """A pack slot kept across polls so its card stays stable when a window skips it."""

    __slots__ = ("cells", "fields", "misses")

    def __init__(self, cells: List[int], fields: Dict[str, float]) -> None:
        self.cells = cells
        self.fields = fields
        self.misses = 0


class JKBms(BMSDevice):
    def __init__(self, *args, **kwargs) -> None:
        super().__init__(*args, **kwargs)
        self._tracks: List[_Track] = []

    async def poll(self) -> Reading:
        return (await self.poll_many())[0]

    async def poll_many(self) -> List[Reading]:
        duration = float(self.options.get("window_seconds", DEFAULT_WINDOW_SECONDS))
        max_bytes = int(self.options.get("window_bytes", MAX_WINDOW_BYTES))
        # Single read on the persistent connection — do NOT reconnect on a hiccup; closing
        # the socket makes the bridge reopen the serial port and disrupts the JK stream
        # (which then causes more failures). A failed read keeps the connection and is
        # smoothed by the poller's offline-debounce (which re-publishes the last-good set).
        try:
            buf = await self.transport.collect(
                jk.build_read_all(0), duration=duration, max_bytes=max_bytes,
                until=jk.cycle_complete,  # stop as soon as every pack has been seen once
            )
            packs = jk.distinct_packs(buf)
        except Exception as exc:  # noqa: BLE001
            log.warning("JK-BMS poll failed for %s: %s", self.device_id, exc)
            return [self._offline_reading(str(exc))]

        units = self.options.get("units")
        if units:
            packs = packs[: int(units)]

        self._merge(packs)
        return self._emit_readings(units)

    def _merge(self, packs: List[Tuple[List[int], Dict[str, float]]]) -> None:
        """Positional carry-forward: the i-th pack of the (deterministically ordered) set
        keeps slot i across polls; slots not present this poll are held, not dropped."""
        for i, (cells, fields) in enumerate(packs):
            if i < len(self._tracks):
                tr = self._tracks[i]
                tr.cells, tr.fields, tr.misses = cells, fields, 0
            else:
                self._tracks.append(_Track(cells, fields))
        for i in range(len(packs), len(self._tracks)):
            self._tracks[i].misses += 1
        # Forget trailing slots that have been gone a long time (e.g. a pack removed).
        while self._tracks and self._tracks[-1].misses > DROP_AFTER:
            self._tracks.pop()

    def _emit_readings(self, units) -> List[Reading]:
        tracks = self._tracks[: int(units)] if units else self._tracks
        if not tracks:
            return [self._offline_reading("no packs decoded")]

        readings: List[Reading] = []
        for idx, tr in enumerate(tracks):
            # First slot keeps this device's id; the rest get a stable positional suffix.
            dev_id = self.device_id if idx == 0 else f"{self.device_id}:{idx}"
            name = self.name if len(tracks) == 1 else f"{self.name} #{idx + 1}"
            reading = Reading(
                device_id=dev_id, device_name=name, kind=self.kind,
                online=tr.misses <= HOLD_MISSES,
                raw={"pack": idx, "cells_mv": tr.cells, "misses": tr.misses},
            )
            for key, metric in jk.to_metrics(tr.cells, tr.fields).items():
                reading.metrics[key] = Metric(
                    value=metric["value"], unit=metric["unit"], label=metric["label"]
                )
            readings.append(reading)
        return readings
