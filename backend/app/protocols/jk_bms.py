"""JK-BMS (Jikong) serial protocol — start bytes ``0x4E 0x57``.

Frame: ``4E 57 <length:2> <terminal:4> <cmd:1> <source:1> <type:1> <data...> <checksum:4>``
where ``length`` counts everything after the two start bytes (i.e. total - 2) and the
checksum is a plain 4-byte sum of all preceding bytes. The "read all" request returns an
info frame whose data section is a sequence of identified registers (0x79 cell voltages
first, then 0x80.. fixed-width values).

Daisy-chained packs on one RS485 bus are addressed by the 4-byte ``terminal`` field — set
each pack a unique RS485 address in the JK app, then query each address from the one link.
"""

from __future__ import annotations

from typing import Dict, List, Tuple

START = b"\x4e\x57"
CMD_READ_ALL = 0x06
SOURCE_PC = 0x03


class ProtocolError(Exception):
    pass


def build_read_all(address: int = 0) -> bytes:
    """Frame a 'read all' request for the pack at the given RS485 ``address``."""
    body = bytes(
        [
            (address >> 24) & 0xFF, (address >> 16) & 0xFF, (address >> 8) & 0xFF, address & 0xFF,
            CMD_READ_ALL, SOURCE_PC, 0x00,  # terminal, command, frame source, transport type
            0x00,                            # frame info / register 0x00 = read all
            0x00, 0x00, 0x00, 0x00,          # record number
            0x68,                            # end identifier
        ]
    )
    frame = bytearray(START)
    length = 2 + len(body) + 4  # length field counts itself + body + the 4 checksum bytes
    frame += length.to_bytes(2, "big")
    frame += body
    frame += (sum(frame) & 0xFFFFFFFF).to_bytes(4, "big")
    return bytes(frame)


def frame_total_len(header: bytes) -> int:
    """Total frame length from the 4-byte header (start + length field)."""
    if len(header) >= 4 and header[:2] == START:
        return 2 + int.from_bytes(header[2:4], "big")
    return len(header)  # not a JK frame -> don't try to read more


# Fixed value sizes (bytes) for the data registers we read. 0x79 (cells) is handled
# specially (it is length-prefixed). Walking stops at the first unknown register id.
_SIZES = {
    0x80: 2, 0x81: 2, 0x82: 2, 0x83: 2, 0x84: 2, 0x85: 1, 0x86: 1,
    0x87: 2, 0x88: 2, 0x89: 4, 0x8A: 2, 0x8B: 2, 0x8C: 2,
}


def _temp(raw: int) -> int:
    """JK temperature encoding: 0-100 = °C; >100 = negative (100 - raw)."""
    return raw if raw <= 100 else 100 - raw


def _find_cells(frame: bytes) -> int:
    """Locate register 0x79 (cell voltages) — the first data register in the info frame."""
    for i in range(4, len(frame) - 2):
        if frame[i] == 0x79:
            n = frame[i + 1]
            if n and n % 3 == 0 and n <= 3 * 32 and i + 2 + n <= len(frame):
                return i
    raise ProtocolError("no cell-voltage register (0x79) found")


def parse(raw: bytes) -> Tuple[List[int], Dict[int, int]]:
    """Validate a 'read all' reply; return (cell_millivolts, {register_id: value})."""
    if len(raw) < 11 or raw[:2] != START:
        raise ProtocolError(f"bad start: {raw[:4].hex(' ')}")
    total = 2 + int.from_bytes(raw[2:4], "big")
    if len(raw) < total:
        raise ProtocolError(f"short frame: have {len(raw)}, need {total}")
    frame = raw[:total]
    if (sum(frame[:-4]) & 0xFFFFFFFF) != int.from_bytes(frame[-4:], "big"):
        raise ProtocolError("checksum mismatch")

    start = _find_cells(frame)
    ncell = frame[start + 1] // 3
    cells = [int.from_bytes(frame[start + 2 + 3 * i + 1 : start + 2 + 3 * i + 3], "big")
             for i in range(ncell)]

    off = start + 2 + 3 * ncell
    end = total - 4
    fields: Dict[int, int] = {}
    while off < end:
        rid = frame[off]
        size = _SIZES.get(rid)
        if size is None:
            break  # reached a register we don't model; we already have the key fields
        fields[rid] = int.from_bytes(frame[off + 1 : off + 1 + size], "big")
        off += 1 + size
    return cells, fields


def to_metrics(cells: List[int], fields: Dict[int, int]) -> Dict[str, Dict[str, object]]:
    """Map a parsed reply to normalized {key: {value, unit, label}} BMS metrics."""
    out: Dict[str, Dict[str, object]] = {}

    def add(key, value, unit, label):
        out[key] = {"value": value, "unit": unit, "label": label}

    if 0x83 in fields:
        add("pack_voltage", round(fields[0x83] * 0.01, 2), "V", "Pack voltage")
    if 0x84 in fields:
        raw = fields[0x84]
        mag = round((raw & 0x7FFF) * 0.01, 2)
        # Bit 15 set = charging (positive); else discharging (negative).
        current = mag if raw & 0x8000 else -mag
        add("pack_current", current, "A", "Pack current")
        if 0x83 in fields:
            add("power", round(fields[0x83] * 0.01 * current, 1), "W", "Pack power")
    if 0x85 in fields:
        add("soc", fields[0x85], "%", "State of charge")
    if 0x87 in fields:
        add("cycles", fields[0x87], "", "Charge cycles")
    if 0x80 in fields:
        add("temp_mosfet", _temp(fields[0x80]), "°C", "MOSFET temperature")
    if 0x81 in fields:
        add("cell_temp", _temp(fields[0x81]), "°C", "Battery temperature 1")
    if 0x82 in fields:
        add("temp_battery2", _temp(fields[0x82]), "°C", "Battery temperature 2")

    if cells:
        lo, hi = min(cells), max(cells)
        add("cell_count", len(cells), "", "Cells")
        add("cell_min", round(lo / 1000, 3), "V", "Min cell voltage")
        add("cell_max", round(hi / 1000, 3), "V", "Max cell voltage")
        add("cell_avg", round(sum(cells) / len(cells) / 1000, 3), "V", "Avg cell voltage")
        add("cell_delta", round((hi - lo) / 1000, 3), "V", "Cell voltage delta")
    return out
