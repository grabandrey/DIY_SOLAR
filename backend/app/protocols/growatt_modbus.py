"""Growatt SPF off-grid (SPF 3000-5000 ES) Modbus-RTU protocol.

Many SPF 5000 ES units expose their USB/RS232 port as **Modbus-RTU** (function 0x04 input
registers) rather than the Voltronic ASCII protocol used by the Axpert-style driver. Only
framing/CRC and the input-register map live here; the transport (serial, or tcp via the
host bridge) is separate.

Input-register map verified against rany2/spf5000es-server and against live inverter data.
32-bit values span two consecutive registers, high word first.
"""

from __future__ import annotations

from typing import Dict, List

SLAVE = 1
FUNC_READ_INPUT = 0x04


class ProtocolError(Exception):
    pass


def crc16(data: bytes) -> bytes:
    """Modbus-RTU CRC-16 (poly 0xA001), low byte first (the on-the-wire order)."""
    crc = 0xFFFF
    for byte in data:
        crc ^= byte
        for _ in range(8):
            crc = (crc >> 1) ^ 0xA001 if crc & 1 else crc >> 1
    return bytes([crc & 0xFF, (crc >> 8) & 0xFF])


def build_read(start: int, count: int, slave: int = SLAVE) -> bytes:
    """Frame a 'read input registers' (func 0x04) request."""
    frame = bytes(
        [slave, FUNC_READ_INPUT, (start >> 8) & 0xFF, start & 0xFF, (count >> 8) & 0xFF, count & 0xFF]
    )
    return frame + crc16(frame)


def response_len(count: int) -> int:
    """Expected reply length: addr + func + bytecount + 2*count data + 2 CRC."""
    return 5 + 2 * count


def parse_registers(raw: bytes, count: int, slave: int = SLAVE) -> List[int]:
    """Validate a func-0x04 reply and return the register values as ints.

    Tolerates a few leading garbage/echo bytes by scanning for the real frame header
    (slave + func + byte-count) and verifying its CRC, rather than failing on raw[0].
    """
    nbytes = 2 * count
    total = 5 + nbytes
    # Try aligned first, then search a small window for the frame start.
    for off in range(0, max(1, len(raw) - total + 1)):
        if raw[off] == slave and raw[off + 1] == FUNC_READ_INPUT and raw[off + 2] == nbytes:
            frame = raw[off : off + total]
            if len(frame) == total and crc16(frame[: 3 + nbytes]) == frame[3 + nbytes :]:
                body = frame[3 : 3 + nbytes]
                return [int.from_bytes(body[i : i + 2], "big") for i in range(0, nbytes, 2)]

    if len(raw) < 5:
        raise ProtocolError(f"short modbus response: {raw.hex(' ')}")
    if raw[0] == slave and raw[1] & 0x80:
        raise ProtocolError(f"modbus exception code {raw[2] if len(raw) > 2 else '?'}")
    raise ProtocolError(f"no valid frame for slave {slave} in {raw[:8].hex(' ')}…")


def u32(regs: List[int], addr: int) -> int:
    """A 32-bit value stored high-word-first across regs[addr], regs[addr+1]."""
    return (regs[addr] << 16) | regs[addr + 1]


# SPF system-status codes (register 0).
STATUS_NAMES = {
    0: "Standby",
    1: "Standby",
    2: "Discharge",
    3: "Fault",
    4: "Flash/burn",
    5: "PV charging",
    6: "AC charging",
    7: "Combine charging",
    8: "Combine charge & bypass",
    9: "PV charge & bypass",
    10: "AC charge & bypass",
    11: "Bypass",
    12: "PV charge & discharge",
}


def status_name(code: int) -> str:
    return STATUS_NAMES.get(code, f"status {code}")


# key, register address, width (1=16-bit, 2=32-bit), scale, unit, label
INPUT_FIELDS = [
    ("pv_input_voltage", 1, 1, 0.1, "V", "PV1 voltage"),
    ("pv2_voltage", 2, 1, 0.1, "V", "PV2 voltage"),
    ("pv_input_power", 3, 2, 0.1, "W", "PV1 power"),
    ("pv2_power", 5, 2, 0.1, "W", "PV2 power"),
    ("ac_output_active_power", 9, 2, 0.1, "W", "Output power"),
    ("ac_output_apparent_power", 11, 2, 0.1, "VA", "Output apparent power"),
    ("battery_ac_charge_power", 13, 2, 0.1, "W", "AC charge power"),
    ("battery_voltage", 17, 1, 0.01, "V", "Battery voltage"),
    ("battery_capacity", 18, 1, 1.0, "%", "Battery capacity"),
    ("ac_output_voltage", 22, 1, 0.1, "V", "Output voltage"),
    ("ac_output_frequency", 23, 1, 0.01, "Hz", "Output frequency"),
    ("inverter_temperature", 25, 1, 0.1, "°C", "Inverter temperature"),
    ("pv_energy_today", 48, 2, 0.1, "kWh", "PV energy today"),
    ("pv_energy_total", 50, 2, 0.1, "kWh", "PV energy total"),
    ("battery_discharge_power", 73, 2, 0.1, "W", "Battery discharge power"),
    ("battery_power", 77, 2, 0.1, "W", "Battery power"),
]

# Highest register touched (battery_power spans 77-78) -> read 0..78 inclusive.
READ_START = 0
READ_COUNT = 79


def parse_input_block(regs: List[int]) -> Dict[str, Dict[str, object]]:
    """Map a read input-register block to {key: {value, unit, label}}."""
    out: Dict[str, Dict[str, object]] = {}
    for key, addr, width, scale, unit, label in INPUT_FIELDS:
        if addr + width > len(regs):
            continue
        raw = u32(regs, addr) if width == 2 else regs[addr]
        out[key] = {"value": round(raw * scale, 2), "unit": unit, "label": label}
    if regs:
        out["mode"] = {"value": status_name(regs[0]), "unit": "", "label": "Operating mode"}
    return out
