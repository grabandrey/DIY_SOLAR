"""Growatt SPF off-grid inverter driver (SPF 5000 ES and the SPF family).

The Growatt SPF off-grid inverters expose a USB port that speaks the Voltronic ASCII
protocol (QPIGS/QMOD/QPIRI), the same as Axpert — so the shared
:class:`~app.devices.inverters.voltronic_inverter.VoltronicInverter` handles it. The
USB port enumerates as a serial device on most hosts (default 2400 baud); via the host
bridge it is reached over TCP transparently.

Note: this is for the *off-grid SPF* line. Grid-tied Growatt models (MIN/MOD/MID/MAC)
speak Modbus instead and would need a separate Modbus transport + driver.
"""

from __future__ import annotations

from .voltronic_inverter import VoltronicInverter


class GrowattSPF(VoltronicInverter):
    """Growatt SPF 5000 ES / SPF off-grid (Voltronic ASCII protocol)."""
