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
from typing import Dict

from ..devices.base import Device
from .bus import bus

log = logging.getLogger(__name__)


class Poller:
    def __init__(self, interval: float = 2.0):
        self.interval = interval
        self._tasks: Dict[str, asyncio.Task] = {}
        self._devices: Dict[str, Device] = {}

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
        bus.remove(device_id)

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
                log.warning("Connect failed for %s: %s", device.device_id, exc)
                await bus.publish(device._offline_reading(f"connect failed: {exc}"))
                await asyncio.sleep(min(self.interval * 3, 15))
                continue

            try:
                reading = await device.poll()
                await bus.publish(reading)
            except asyncio.CancelledError:
                raise
            except Exception as exc:  # noqa: BLE001
                log.exception("Unexpected poll error for %s", device.device_id)
                await bus.publish(device._offline_reading(str(exc)))

            await asyncio.sleep(self.interval)
