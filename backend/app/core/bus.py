"""In-process pub/sub bus for readings.

The poller publishes every :class:`Reading` here; WebSocket clients subscribe to get a
live stream, and the latest reading per device is cached so REST and newly-connected
clients can get current state immediately. Decouples data producers from consumers.
"""

from __future__ import annotations

import asyncio
from typing import Any, Dict, List, Set

from ..devices.base import Reading
from .metrics import derived


class EventBus:
    def __init__(self) -> None:
        self._subscribers: Set["asyncio.Queue[Dict[str, Any]]"] = set()
        self._latest: Dict[str, Dict[str, Any]] = {}
        self._lock = asyncio.Lock()

    async def publish(self, reading: Reading) -> None:
        payload = reading.to_dict()
        # Precompute the per-device stat values once, here, so every consumer (REST
        # snapshot, WS stream, live aggregate) renders the same backend-derived numbers.
        payload["derived"] = derived(reading)
        async with self._lock:
            self._latest[reading.device_id] = payload
            subscribers = list(self._subscribers)
        for queue in subscribers:
            # Drop the oldest item for slow consumers rather than blocking the poller.
            if queue.full():
                try:
                    queue.get_nowait()
                except asyncio.QueueEmpty:
                    pass
            queue.put_nowait(payload)

    async def subscribe(self) -> "asyncio.Queue[Dict[str, Any]]":
        queue: "asyncio.Queue[Dict[str, Any]]" = asyncio.Queue(maxsize=100)
        async with self._lock:
            self._subscribers.add(queue)
        return queue

    async def unsubscribe(self, queue: "asyncio.Queue[Dict[str, Any]]") -> None:
        async with self._lock:
            self._subscribers.discard(queue)

    def remove(self, device_id: str) -> None:
        """Drop a device's cached reading (e.g. after it's removed at runtime)."""
        self._latest.pop(device_id, None)

    def latest(self) -> List[Dict[str, Any]]:
        return list(self._latest.values())

    def latest_for(self, device_id: str) -> Dict[str, Any] | None:
        return self._latest.get(device_id)


bus = EventBus()
