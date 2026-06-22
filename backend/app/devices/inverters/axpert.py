"""Axpert King / Phocos inverter driver (Voltronic protocol).

Talks to the inverter through whatever transport it is given (USB serial, raw HID, or
TCP via the host bridge) and normalizes the response into the common :class:`Reading`
shape. The protocol handling is shared — see :mod:`.voltronic_inverter`.
"""

from __future__ import annotations

from .voltronic_inverter import VoltronicInverter


class AxpertInverter(VoltronicInverter):
    """Axpert King / Phocos (Voltronic ASCII protocol)."""
