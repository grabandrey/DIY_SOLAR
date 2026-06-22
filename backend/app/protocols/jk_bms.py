"""JK-BMS "JK02_32S" protocol (modern Jikong BMS over RS485/UART, header 0x55 0xAA 0xEB 0x90).

Newer JK BMS stream fixed 300-byte frames; the realtime one is record type 0x02 (cell info).
A poll sends the read-cell-info command (header 0xAA 0x55 0x90 0xEB, command 0x96, 1-byte sum
checksum) and then syncs to a 0x02 frame in the stream. All multi-byte values are
little-endian. Offsets below are for the 32-cell (JK02_32S) layout and were verified against
live frames.
"""

from __future__ import annotations

from typing import Dict, List, Tuple

RESP_HEADER = b"\x55\xaa\xeb\x90"
CMD_HEADER = b"\xaa\x55\x90\xeb"
TYPE_CELL_INFO = 0x02
FRAME_LEN = 300          # JK02_32S frame size
CELL_BASE = 6            # 32 * uint16 LE cell millivolts
MIN_PARSE = 192          # we only need offsets up to ~190; tolerate a truncated tail


class ProtocolError(Exception):
    pass


def build_read_all(address: int = 0) -> bytes:
    """Command frame requesting the cell-info (realtime) record. 20 bytes, 1-byte sum CRC."""
    frame = bytearray(CMD_HEADER)
    frame += bytes([0x96, 0x00])              # command 0x96 = read cell info
    frame += int(address).to_bytes(4, "little")
    frame += bytes(19 - len(frame))           # pad to 19 bytes
    frame.append(sum(frame) & 0xFF)           # checksum
    return bytes(frame)


def _u16(b, o): return int.from_bytes(b[o:o + 2], "little")
def _i16(b, o): return int.from_bytes(b[o:o + 2], "little", signed=True)
def _u32(b, o): return int.from_bytes(b[o:o + 4], "little")
def _i32(b, o): return int.from_bytes(b[o:o + 4], "little", signed=True)


def find_cell_frame(buf: bytes) -> bytes:
    """Locate a record-type 0x02 (cell info) frame within a streamed buffer."""
    i = buf.find(RESP_HEADER)
    while i != -1:
        if i + 5 <= len(buf) and buf[i + 4] == TYPE_CELL_INFO:
            return buf[i : i + FRAME_LEN]
        i = buf.find(RESP_HEADER, i + 1)
    raise ProtocolError("no JK02 cell-info (0x02) frame in stream")


def parse(buf: bytes) -> Tuple[List[int], Dict[str, float]]:
    """Find and decode the first cell-info frame. Returns (cell_millivolts, fields)."""
    return _decode_frame(find_cell_frame(buf))


def iter_cell_frames(buf: bytes):
    """Yield (cells, fields) for every decodable cell-info (0x02) frame in a stream buffer."""
    i = buf.find(RESP_HEADER)
    while i != -1:
        if i + 5 <= len(buf) and buf[i + 4] == TYPE_CELL_INFO and i + MIN_PARSE <= len(buf):
            try:
                yield _decode_frame(buf[i : i + FRAME_LEN])
            except ProtocolError:
                pass
        i = buf.find(RESP_HEADER, i + 4)


def _cells_close(a: List[int], b: List[int], tol_mv: int = 8) -> bool:
    # Tight tolerance: the same pack's back-to-back frames differ by <5 mV, while different
    # packs almost always differ by more on at least one cell.
    return len(a) == len(b) and all(abs(x - y) <= tol_mv for x, y in zip(a, b))


def cycle_complete(buf: bytes) -> bool:
    """True once the first pack's cell-info frame recurs — i.e. a full broadcast cycle has
    been captured, so every pack has been seen and we can stop reading early."""
    frames = list(iter_cell_frames(buf))
    if len(frames) < 2:
        return False
    base = frames[0][0]
    return any(_cells_close(frames[i][0], base) for i in range(1, len(frames)))


def distinct_packs(buf: bytes) -> List[Tuple[List[int], Dict[str, float]]]:
    """Return one (cells, fields) per physical pack from a multi-pack broadcast window.

    Packs broadcast in a fixed repeating order; we read >1 cycle and detect the period by
    finding when the first pack's frame recurs, which yields the full set regardless of where
    in the cycle the capture started.
    """
    frames = list(iter_cell_frames(buf))
    if not frames:
        raise ProtocolError("no JK02 cell-info frames in stream")
    base = frames[0][0]
    packs = frames
    for period in range(1, len(frames)):
        if _cells_close(frames[period][0], base):
            packs = frames[:period]
            break
    # Deterministic order so a pack keeps the same card across polls regardless of where in
    # the broadcast the capture started (more cells first, then highest total voltage).
    return sorted(packs, key=lambda p: (-len(p[0]), -sum(p[0])))


def _decode_frame(frame: bytes) -> Tuple[List[int], Dict[str, float]]:
    if len(frame) < MIN_PARSE:
        raise ProtocolError(f"short JK02 frame: {len(frame)} bytes")
    # Validate the trailing sum checksum only when the whole 300-byte frame is present.
    if len(frame) >= FRAME_LEN and (sum(frame[: FRAME_LEN - 1]) & 0xFF) != frame[FRAME_LEN - 1]:
        raise ProtocolError("JK02 checksum mismatch")

    mask = _u16(frame, 70)
    all_cells = [_u16(frame, CELL_BASE + 2 * i) for i in range(32)]
    cells = [all_cells[i] for i in range(32) if mask & (1 << i)] or [c for c in all_cells if c]

    f: Dict[str, float] = {
        "temp_mosfet": _i16(frame, 144) * 0.1,
        "pack_voltage": _u32(frame, 150) * 0.001,
        "power": _u32(frame, 154) * 0.001,
        "pack_current": _i32(frame, 158) * 0.001,
        "temp1": _i16(frame, 162) * 0.1,
        "temp2": _i16(frame, 164) * 0.1,
        "soc": frame[173],
        "remaining_capacity": _u32(frame, 174) * 0.001,
        "nominal_capacity": _u32(frame, 178) * 0.001,
        "cycles": _u32(frame, 182),
        "cycle_capacity": _u32(frame, 186) * 0.001,
    }
    if len(frame) > 190:
        f["soh"] = frame[190]
    return cells, f


def to_metrics(cells: List[int], f: Dict[str, float]) -> Dict[str, Dict[str, object]]:
    """Map a parsed frame to normalized {key: {value, unit, label}} BMS metrics."""
    out: Dict[str, Dict[str, object]] = {}

    def add(key, value, unit, label):
        out[key] = {"value": value, "unit": unit, "label": label}

    add("pack_voltage", round(f["pack_voltage"], 2), "V", "Pack voltage")
    add("pack_current", round(f["pack_current"], 2), "A", "Pack current")
    add("power", round(f["power"] if f["pack_current"] >= 0 else -f["power"], 1), "W", "Pack power")
    add("soc", int(f["soc"]), "%", "State of charge")
    if "soh" in f:
        add("soh", int(f["soh"]), "%", "State of health")
    add("remaining_capacity", round(f["remaining_capacity"], 1), "Ah", "Remaining capacity")
    add("nominal_capacity", round(f["nominal_capacity"], 1), "Ah", "Nominal capacity")
    add("cycles", int(f["cycles"]), "", "Charge cycles")
    add("cell_temp", round(f["temp1"], 1), "°C", "Battery temperature 1")
    add("temp_battery2", round(f["temp2"], 1), "°C", "Battery temperature 2")
    add("temp_mosfet", round(f["temp_mosfet"], 1), "°C", "MOSFET temperature")

    if cells:
        lo, hi = min(cells), max(cells)
        add("cell_count", len(cells), "", "Cells")
        add("cell_min", round(lo / 1000, 3), "V", "Min cell voltage")
        add("cell_max", round(hi / 1000, 3), "V", "Max cell voltage")
        add("cell_avg", round(sum(cells) / len(cells) / 1000, 3), "V", "Avg cell voltage")
        add("cell_delta", round((hi - lo) / 1000, 3), "V", "Cell voltage delta")
    return out
