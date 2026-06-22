"""Shared base for inverter drivers."""

from __future__ import annotations

from ..base import Device, DeviceKind


class InverterDevice(Device):
    kind = DeviceKind.INVERTER
