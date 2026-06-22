"""Voltronic / Axpert (a.k.a. AxpertKing, Phocos) inverter protocol.

These inverters speak an ASCII command protocol framed with an XMODEM CRC-16 and a
trailing carriage return. Commands used here:

* ``QPIGS`` - general status (live power/voltage/battery values)
* ``QPIRI`` - rated information (nameplate / configured ratings)
* ``QMOD``  - device operating mode
* ``QPIWS`` - warning status bits

Only framing/CRC and parsing live here; transport (serial vs HID) is separate.
"""

from __future__ import annotations

from typing import Dict, List


def crc16(data: bytes) -> bytes:
    """XMODEM CRC-16 as used by Voltronic, with their byte-escaping quirk.

    The two CRC bytes are nudged up by one if they collide with ``\\n``/``\\r``/``(``
    because those are reserved framing characters on the wire.
    """

    crc = 0
    for byte in data:
        crc ^= byte << 8
        for _ in range(8):
            if crc & 0x8000:
                crc = (crc << 1) ^ 0x1021
            else:
                crc <<= 1
            crc &= 0xFFFF

    high = (crc >> 8) & 0xFF
    low = crc & 0xFF
    if high in (0x28, 0x0D, 0x0A):
        high += 1
    if low in (0x28, 0x0D, 0x0A):
        low += 1
    return bytes([high, low])


def frame_command(command: str) -> bytes:
    """Turn ``"QPIGS"`` into the on-the-wire bytes ``QPIGS<crc><cr>``."""

    payload = command.encode("ascii")
    return payload + crc16(payload) + b"\r"


def frame_response(body: str) -> bytes:
    """Build a full inverter-style response ``(<body><crc><cr>`` (used by the mock)."""

    payload = b"(" + body.encode("ascii")
    return payload + crc16(payload) + b"\r"


def parse_response(raw: bytes) -> str:
    """Strip the framing from a response and return the ASCII body.

    Raises ``ProtocolError`` on missing data, bad framing, an invalid CRC, or a NAK.
    """

    if not raw:
        raise ProtocolError("empty response")
    data = raw.strip(b"\x00").rstrip(b"\r")
    if not data.startswith(b"("):
        raise ProtocolError(f"bad frame start: {raw!r}")
    if len(data) < 3:
        raise ProtocolError(f"short response: {raw!r}")

    payload, received_crc = data[:-2], data[-2:]
    if crc16(payload) != received_crc:
        raise ProtocolError(f"CRC mismatch on {raw!r}")

    body = payload[1:].decode("ascii", errors="replace").strip()
    if body == "NAK":
        raise ProtocolError("device returned NAK")
    return body


def parse_qpigs(body: str) -> Dict[str, float]:
    """Parse a ``QPIGS`` body into named float fields (Voltronic field order)."""

    parts: List[str] = body.split()
    fields = [
        "grid_voltage",
        "grid_frequency",
        "ac_output_voltage",
        "ac_output_frequency",
        "ac_output_apparent_power",
        "ac_output_active_power",
        "output_load_percent",
        "bus_voltage",
        "battery_voltage",
        "battery_charge_current",
        "battery_capacity",
        "inverter_temperature",
        "pv_input_current",
        "pv_input_voltage",
        "battery_voltage_scc",
        "battery_discharge_current",
    ]
    out: Dict[str, float] = {}
    for name, value in zip(fields, parts):
        try:
            out[name] = float(value)
        except ValueError:
            continue

    # Derived: PV input power isn't a direct QPIGS field on all firmwares.
    if "pv_input_current" in out and "pv_input_voltage" in out:
        out["pv_input_power"] = round(out["pv_input_current"] * out["pv_input_voltage"], 1)
    return out


MODE_NAMES = {
    "P": "Power on",
    "S": "Standby",
    "L": "Line / grid",
    "B": "Battery / inverter",
    "F": "Fault",
    "H": "Power saving",
}


def parse_qmod(body: str) -> str:
    code = body.strip()[:1]
    return MODE_NAMES.get(code, code or "unknown")


# QPGS<n> (parallel device general status). Field index -> metric key, per the Axpert
# protocol. Field 0 = "parallel instance valid" flag, field 2 = work mode.
QPGS_FIELDS = [
    (4, "grid_voltage"),
    (5, "grid_frequency"),
    (6, "ac_output_voltage"),
    (7, "ac_output_frequency"),
    (8, "ac_output_apparent_power"),
    (9, "ac_output_active_power"),
    (10, "output_load_percent"),
    (11, "battery_voltage"),
    (12, "battery_charge_current"),
    (13, "battery_capacity"),
    (14, "pv_input_voltage"),
    (15, "total_charge_current"),
    (16, "total_ac_output_apparent_power"),
    (17, "total_ac_output_active_power"),
    (18, "total_output_load_percent"),
    (25, "pv_input_current"),
    (26, "battery_discharge_current"),
]


def valid_serial(serial: str) -> bool:
    """A real parallel unit reports a non-empty, non-all-zero serial (field 1).

    A queried index beyond the actual unit count returns an all-zero/blank serial (or
    echoes another unit's), so the serial is what reliably distinguishes present units —
    the field-0 'parallel valid' flag does not (it can read 1 for phantom indices).
    """
    serial = (serial or "").strip()
    return len(serial) >= 4 and set(serial) != {"0"}


def parse_qpgs(body: str):
    """Parse a ``QPGS<n>`` body. Returns ``(serial, mode, metrics)``.

    ``serial`` is the unit serial (field 1, used to tell real units apart). ``mode`` is the
    unit's work mode (field 2). ``metrics`` are the named float fields.
    """
    parts: List[str] = body.split()
    serial = parts[1] if len(parts) > 1 else ""
    mode = parse_qmod(parts[2]) if len(parts) > 2 else "unknown"
    out: Dict[str, float] = {}
    for idx, key in QPGS_FIELDS:
        if idx < len(parts):
            try:
                out[key] = float(parts[idx])
            except ValueError:
                continue
    if "pv_input_current" in out and "pv_input_voltage" in out:
        out["pv_input_power"] = round(out["pv_input_current"] * out["pv_input_voltage"], 1)
    return serial, mode, out


class ProtocolError(Exception):
    pass
