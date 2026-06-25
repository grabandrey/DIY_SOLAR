"""JK-BMS (Jikong) battery driver — modern JK02 protocol (header 0x55 0xAA 0xEB 0x90).

The BMS streams 300-byte frames at 115200. A poll reads a window of the stream and decodes
every pack's cell-info (0x02) frame, so multiple packs daisy-chained on one RS485 bus are
fetched automatically — no per-pack config.

Each pack is tracked across polls by a STABLE PER-PACK IDENTITY rather than by its position
in the capture. The DIP switches you set on each BMS only decide the order packs take turns
broadcasting on the bus — that address is NOT carried in the cell-info (0x02) frame, so it
can't be read back directly (verified by scanning every byte of a live 6-pack capture). What
*is* stable per physical pack is the combination of its cell count, rated (nominal) capacity
and lifetime cycle count, which is unique even across a balanced bank whose cell voltages sit
within a few mV of each other — so that tuple (see ``_pack_key``) is used as each battery's
identity. Keying on identity (instead of list position) means a pack that a short capture
window happens to skip keeps its own card with its last-known reading instead of every card
below it shifting up and data jumping between batteries.

Pack count auto-detects: every pack physically on the bus gets its own card, so plugging
another JK battery into the parallel/daisy-chain ports makes it appear on its own with no
config change — and an existing battery keeps the same card.
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


# A pack's cycle count creeps up by one every full charge/discharge (days apart). Since the
# count is part of a pack's identity, treat a never-before-seen pack as the *same* battery as
# a currently-missing one of identical cell count and capacity whose cycle count is just below
# it (monotonic, small step) — so the slow drift re-keys the existing card instead of spawning
# a duplicate.
CYCLE_DRIFT = 3


def _pack_key(cells: List[int], fields: Dict[str, float]) -> Tuple[int, int, int]:
    """Stable identity for a physical pack.

    The JK cell-info broadcast frame carries no DIP-switch address (the DIP setting only fixes
    the broadcast order), so a pack is identified by attributes fixed to the unit itself: cell
    count, rated capacity, and lifetime cycle count. This tuple was verified unique across a
    live 6-pack bank, including balanced packs whose cell voltages were within a few mV.
    """
    return (
        len(cells),
        int(round(fields.get("nominal_capacity", 0.0))),
        int(fields.get("cycles", 0)),
    )


class _Track:
    """A pack kept across polls, keyed by its stable identity so its card never shifts."""

    __slots__ = ("key", "cells", "fields", "misses")

    def __init__(self, key: Tuple[int, int, int], cells: List[int], fields: Dict[str, float]) -> None:
        self.key = key
        self.cells = cells
        self.fields = fields
        self.misses = 0


class JKBms(BMSDevice):
    def __init__(self, *args, **kwargs) -> None:
        super().__init__(*args, **kwargs)
        # identity -> track. ``_order`` is the insertion order, which is the stable card order
        # (an existing pack keeps its slot when another battery is added).
        self._tracks: Dict[Tuple[int, int, int], _Track] = {}
        self._order: List[Tuple[int, int, int]] = []

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

        self._merge(packs)
        return self._emit_readings(self.options.get("units"))

    def _merge(self, packs: List[Tuple[List[int], Dict[str, float]]]) -> None:
        """Identity carry-forward: each pack updates the track with its identity (creating a
        new card if unseen); tracks absent this poll are held, not dropped, so a skipped pack
        keeps its card instead of shifting every card below it."""
        # Pass 1: match packs whose identity we already track (the common case).
        seen = set()
        pending: List[Tuple[Tuple[int, int, int], List[int], Dict[str, float]]] = []
        for cells, fields in packs:
            key = _pack_key(cells, fields)
            tr = self._tracks.get(key)
            if tr is None:
                pending.append((key, cells, fields))
            else:
                tr.cells, tr.fields, tr.misses = cells, fields, 0
                seen.add(key)

        # Mark every unmatched track as missing this poll *before* adopting drifters, so
        # "currently missing" is accurate (a drifted pack's old identity is now absent).
        for key, tr in self._tracks.items():
            if key not in seen:
                tr.misses += 1

        # Pass 2: a genuinely new identity is either the same pack with a ticked-up cycle
        # count (re-key the existing card) or a battery that was just added (new card).
        for key, cells, fields in pending:
            tr = self._adopt_drifted(key)
            if tr is None:
                tr = _Track(key, cells, fields)
                self._tracks[key] = tr
                self._order.append(key)
            else:
                self._rekey(tr, key)
            tr.cells, tr.fields, tr.misses = cells, fields, 0
            seen.add(key)

        # Forget packs gone a long time (e.g. a battery physically removed from the chain).
        for key in [k for k, tr in self._tracks.items() if tr.misses > DROP_AFTER]:
            del self._tracks[key]
            self._order.remove(key)

    def _adopt_drifted(self, key: Tuple[int, int, int]):
        """Find a currently-missing track that is the same physical pack whose cycle count has
        just ticked up (same cells/capacity, cycles a small step below ``key``)."""
        cells_n, cap, cyc = key
        best = None
        for tr in self._tracks.values():
            if tr.misses == 0 or tr.key[0] != cells_n or tr.key[1] != cap:
                continue
            delta = cyc - tr.key[2]
            if 0 <= delta <= CYCLE_DRIFT and (best is None or delta < (cyc - best.key[2])):
                best = tr
        return best

    def _rekey(self, tr: _Track, key: Tuple[int, int, int]) -> None:
        self._tracks.pop(tr.key, None)
        self._order[self._order.index(tr.key)] = key
        tr.key = key
        self._tracks[key] = tr

    def _emit_readings(self, units) -> List[Reading]:
        order = [k for k in self._order if k in self._tracks]
        if units:
            order = order[: int(units)]
        if not order:
            return [self._offline_reading("no packs decoded")]

        readings: List[Reading] = []
        for idx, key in enumerate(order):
            tr = self._tracks[key]
            # First card keeps this device's id; the rest get a stable suffix tied to the
            # pack's slot, so each battery's id stays put across polls.
            dev_id = self.device_id if idx == 0 else f"{self.device_id}:{idx}"
            name = self.name if len(order) == 1 else f"{self.name} #{idx + 1}"
            reading = Reading(
                device_id=dev_id, device_name=name, kind=self.kind,
                online=tr.misses <= HOLD_MISSES,
                raw={"pack": idx, "cells_mv": tr.cells, "misses": tr.misses},
            )
            for key2, metric in jk.to_metrics(tr.cells, tr.fields).items():
                reading.metrics[key2] = Metric(
                    value=metric["value"], unit=metric["unit"], label=metric["label"]
                )
            readings.append(reading)
        return readings
