"""Polling engine.

Runs one independent loop per device so a slow or offline device never blocks the
others, connects (with retry) and polls on a fixed interval, and publishes each result
to the :data:`~app.core.bus.bus`.

Devices can be added or removed at runtime (e.g. when the user attaches one from the
frontend) without restarting the process.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Dict, Set

from ..devices.base import Device
from .bus import bus

log = logging.getLogger(__name__)


class Poller:
    def __init__(self, interval: float = 2.0):
        self.interval = interval
        self._tasks: Dict[str, asyncio.Task] = {}
        self._devices: Dict[str, Device] = {}
        # device_id -> every reading id it last published (a parallel master fans out to
        # several), so we can clear them all from the bus on removal / when a unit drops.
        self._reading_ids: Dict[str, Set[str]] = {}
        # Debounce: last good readings + consecutive failure count per device, so a single
        # transient read miss doesn't flap the UI offline. We keep showing the last-good
        # reading until GRACE consecutive failures.
        self._last_good: Dict[str, list] = {}
        self._fails: Dict[str, int] = {}

    GRACE_FAILURES = 5

    def add(self, device: Device) -> None:
        """Start polling a device. Replaces any existing device with the same id."""
        self.remove_sync(device.device_id)
        self._devices[device.device_id] = device
        self._tasks[device.device_id] = asyncio.create_task(self._run_device(device))
        log.info("Polling device %s", device.device_id)

    def remove_sync(self, device_id: str) -> None:
        task = self._tasks.pop(device_id, None)
        device = self._devices.pop(device_id, None)
        if task:
            task.cancel()
        if device:
            asyncio.create_task(self._safe_close(device))
        for rid in self._reading_ids.pop(device_id, {device_id}):
            bus.remove(rid)
        self._last_good.pop(device_id, None)
        self._fails.pop(device_id, None)

    async def stop(self) -> None:
        for task in self._tasks.values():
            task.cancel()
        await asyncio.gather(*self._tasks.values(), return_exceptions=True)
        for device in self._devices.values():
            await self._safe_close(device)
        self._tasks.clear()
        self._devices.clear()

    async def _safe_close(self, device: Device) -> None:
        try:
            await device.close()
        except Exception:  # noqa: BLE001
            pass

    async def _run_device(self, device: Device) -> None:
        while True:
            try:
                await device.connect()
            except asyncio.CancelledError:
                raise
            except Exception as exc:  # noqa: BLE001
                await self._on_failure(device, f"connect failed: {exc}")
                await asyncio.sleep(min(self.interval * 3, 15))
                continue

            try:
                readings = await device.poll_many()
            except asyncio.CancelledError:
                raise
            except Exception as exc:  # noqa: BLE001
                await self._on_failure(device, str(exc))
                await asyncio.sleep(self.interval)
                continue

            if any(r.online for r in readings):
                self._fails[device.device_id] = 0
                self._last_good[device.device_id] = readings
                await self._emit(device, readings)
            else:
                # Poll returned but the device reported itself offline/errored.
                err = next((r.error for r in readings if r.error), "no data")
                await self._on_failure(device, err)

            await asyncio.sleep(self.interval)

    async def _on_failure(self, device: Device, error: str) -> None:
        """Count a failure; keep showing the last-good reading until GRACE is exceeded."""
        did = device.device_id
        self._fails[did] = self._fails.get(did, 0) + 1
        last = self._last_good.get(did)
        if last and self._fails[did] <= self.GRACE_FAILURES:
            log.debug("transient failure %d for %s (%s); holding last-good",
                      self._fails[did], did, error)
            await self._emit(device, last)  # re-publish last-good, stays online
        else:
            log.warning("device %s offline after %d failures: %s", did, self._fails[did], error)
            await bus.publish(device._offline_reading(error))

    async def _emit(self, device: Device, readings: list) -> None:
        new_ids: Set[str] = set()
        for reading in readings:
            await bus.publish(reading)
            new_ids.add(reading.device_id)
        for stale in self._reading_ids.get(device.device_id, set()) - new_ids:
            bus.remove(stale)
        self._reading_ids[device.device_id] = new_ids
