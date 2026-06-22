#!/usr/bin/env python3
"""Solar Assistant USB bridge (run on the HOST, e.g. your Mac).

Docker Desktop on macOS/Windows runs in a Linux VM that cannot see host USB devices, so
a container can never open the inverter directly. This bridge runs natively on the host
where the USB *is* visible and:

  * auto-detects USB inverters as either a **serial port** (CDC-ACM) OR a **USB HID**
    device, and keeps detecting as you plug/unplug (multiple devices supported);
  * republishes each one as a raw TCP socket the container reaches via
    ``host.docker.internal`` (HID report chunking is handled here, so the backend just
    sees a clean command/response byte stream);
  * serves a discovery feed at ``http://<host>:5510/ports`` that the backend reads, so
    detected devices show up in the UI for you to pick a driver per device.

IMPORTANT: Axpert King / Phocos inverters most often present as a **USB HID** device,
not a serial port — so they won't show up as ``/dev/cu.*``. HID support needs hidapi:

    pip3 install pyserial hidapi
    # macOS: brew install hidapi      Linux: apt install libhidapi-hidraw0

The backend machine's address is baked in below as ``SERVER_IP`` (the Solar Assistant
backend, e.g. your Mac). The bridge uses it to auto-detect which of its own LAN addresses
that server can reach it on, so on a Raspberry Pi you just run the bridge with no flags and
the backend connects back to the right host. Edit ``SERVER_IP`` if the backend moves.

Usage:
    python3 tools/usb_bridge.py              # auto-detect + bridge (serial + HID)
    python3 tools/usb_bridge.py --list-usb   # DIAGNOSTIC: list every USB/HID device
    python3 tools/usb_bridge.py --all-hid     # bridge every HID device (not just likely)
    python3 tools/usb_bridge.py --hid-vid 0665 --hid-pid 5161   # target a specific HID
    python3 tools/usb_bridge.py --baud 2400  # serial baud (also selectable per-device)
    python3 tools/usb_bridge.py --test-serial /dev/ttyUSB0 --protocol growatt --baud 9600

Then in the UI: ⚙ Devices -> Scan -> your device appears (source "host USB") ->
pick the driver (axpert/phocos) -> Attach.
"""

from __future__ import annotations

import argparse
import glob
import json
import platform
import socket
import subprocess
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

try:
    import serial
    from serial.tools import list_ports
except ImportError:
    sys.exit("pyserial is required on the host:  pip3 install pyserial")

# hidapi is optional but required for HID inverters (the common Axpert/Phocos case).
try:
    import hid as _hid
    HID_OK = True
except Exception:  # noqa: BLE001
    _hid = None
    HID_OK = False

# Address of the machine running the Solar Assistant backend (e.g. your Mac). The bridge
# advertises whichever of its own LAN IPs this server reaches it on, so the backend connects
# back to the right host. Set to None to advertise host.docker.internal (bridge + backend on
# the same machine). Edit this if the backend moves to a different IP.
SERVER_IP = "192.168.0.79"

# Port the Solar Assistant backend API listens on (docker-compose maps 8000). The bridge
# POSTs its discovery URL to http://SERVER_IP:SERVER_API_PORT/api/bridge/register so the
# backend auto-learns this bridge — no SA_BRIDGE_URL / manual IP needed on the server.
SERVER_API_PORT = 8000

# USB ids / descriptions commonly seen on Voltronic-family (Axpert/Phocos) cables.
_INVERTER_HINTS = ("0665:5161", "voltronic", "axpert", "phocos", "growatt", "cp210", "ch340", "ftdi")
# Voltronic HID inverters very commonly use this vendor id. Growatt SPF USB also seen as 1a86 (CH340).
_INVERTER_VIDS = {0x0665}

# Known USB-to-serial converter chips (used by RS232<->USB cables) and the macOS driver
# situation for each. If one of these is present but no /dev/cu.* appears, the driver is
# the problem. Key is (vid, pid); pid None matches any product for that vendor.
KNOWN_SERIAL_CHIPS = {
    (0x0403, None): ("FTDI FT232",
                     "Built into macOS — should appear as /dev/cu.usbserial-*. If not, install the FTDI VCP driver."),
    (0x10C4, 0xEA60): ("Silicon Labs CP210x",
                       "Built into recent macOS (shows as /dev/cu.usbserial-* or /dev/cu.SLAB_USBtoUART). "
                       "Otherwise install the 'Silicon Labs CP210x VCP' driver."),
    (0x1A86, 0x7523): ("WCH CH340/CH341",
                       "Usually needs the WCH CH34x driver on macOS (then shows as /dev/cu.wchusbserial*). "
                       "Install from wch.cn (CH34x macOS VCP driver)."),
    (0x1A86, 0x5523): ("WCH CH341", "Install the WCH CH34x macOS driver."),
    (0x067B, 0x2303): ("Prolific PL2303",
                       "Needs the Prolific PL2303 driver; many clone chips are NOT supported on modern macOS."),
    (0x04E2, None): ("Exar / MaxLinear XR21V", "Install the MaxLinear/Exar USB-UART driver."),
}


def _serial_chip_hint(vid: int, pid: int):
    return KNOWN_SERIAL_CHIPS.get((vid, pid)) or KNOWN_SERIAL_CHIPS.get((vid, None))


def _local_ip_toward(server_ip: str) -> str:
    """Return this machine's LAN IP that the given server would reach it on.

    Opens a UDP socket "toward" the server (no packets are actually sent) and reads back
    the local address the OS picked for that route. This is how we turn a known server IP
    into the right advertise-host without the user looking up the bridge box's own IP.
    """
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect((server_ip, 9))  # discard port; UDP connect sends nothing
        return s.getsockname()[0]
    finally:
        s.close()


def _register_loop(feed_url: str, interval: float = 10.0) -> None:
    """Heartbeat: tell the backend our discovery URL so it auto-finds us (no manual IP).

    POSTs to http://SERVER_IP:SERVER_API_PORT/api/bridge/register every `interval` seconds.
    The backend expires bridges that stop posting, so this doubles as a liveness signal.
    """
    import urllib.error
    import urllib.request

    target = f"http://{SERVER_IP}:{SERVER_API_PORT}/api/bridge/register"
    body = json.dumps({"url": feed_url}).encode()
    announced = False
    while True:
        try:
            req = urllib.request.Request(
                target, data=body, headers={"Content-Type": "application/json"}, method="POST"
            )
            urllib.request.urlopen(req, timeout=3).read()
            if not announced:
                print(f"[i] registered with backend at {target}")
                announced = True
        except Exception as exc:  # noqa: BLE001
            if announced:
                print(f"[!] backend registration lost ({exc}); retrying")
            announced = False
        time.sleep(interval)


def _looks_like_inverter(*fields) -> bool:
    blob = " ".join(str(x).lower() for x in fields if x)
    return any(h in blob for h in _INVERTER_HINTS)


# ---------------------------------------------------------------------------
# HID device wrapper (smooths over the two common `hid`/`hidapi` PyPI packages)
# ---------------------------------------------------------------------------
class HidDev:
    def __init__(self, path: bytes):
        if hasattr(_hid, "Device"):  # 'hidapi' package (Trezor)
            self._d = _hid.Device(path=path)
            self._flavor = "device"
        else:  # 'hid' package (apmorton)
            self._d = _hid.device()
            self._d.open_path(path)
            self._flavor = "legacy"

    def write(self, data: bytes) -> None:
        # hidapi expects a leading report-id byte (0 for unnumbered reports).
        payload = b"\x00" + bytes(data)
        if self._flavor == "device":
            self._d.write(payload)
        else:
            self._d.write(list(payload))

    def read(self, size: int, timeout_ms: int) -> bytes:
        if self._flavor == "device":
            return bytes(self._d.read(size, timeout_ms))
        return bytes(self._d.read(size, timeout_ms))

    def close(self) -> None:
        try:
            self._d.close()
        except Exception:  # noqa: BLE001
            pass


def _enumerate_hid(include_all: bool, vid_filter, pid_filter) -> list[dict]:
    """Return HID devices, de-duped per (vid,pid), filtered to likely inverters."""
    if not HID_OK:
        return []
    out, seen = [], set()
    for d in _hid.enumerate():
        vid, pid = d.get("vendor_id", 0), d.get("product_id", 0)
        if vid_filter is not None and vid != vid_filter:
            continue
        if pid_filter is not None and pid != pid_filter:
            continue
        product = d.get("product_string") or ""
        manuf = d.get("manufacturer_string") or ""
        usage_page = d.get("usage_page", 0)
        likely = (
            vid in _INVERTER_VIDS
            or _looks_like_inverter(product, manuf, f"{vid:04x}:{pid:04x}")
            or usage_page >= 0xFF00  # vendor-specific usage page
        )
        if not (include_all or likely or (vid_filter is not None)):
            continue
        key = (vid, pid)
        if key in seen:
            continue
        seen.add(key)
        out.append(
            {
                "path": d["path"],  # bytes
                "vid": f"{vid:04x}",
                "pid": f"{pid:04x}",
                "description": product or "USB HID device",
                "manufacturer": manuf or None,
                "likely_inverter": likely,
            }
        )
    return out


def _open_serial(path: str, baud: int, timeout: float = 0.2):
    """Open a serial port, retrying with flow control cleared (macOS driver quirks)."""
    errors = []
    for clear_flow in (False, True):
        ser = serial.Serial()
        ser.port = path
        ser.baudrate = int(baud)
        ser.timeout = timeout
        ser.bytesize = serial.EIGHTBITS
        ser.parity = serial.PARITY_NONE
        ser.stopbits = serial.STOPBITS_ONE
        if clear_flow:
            ser.rtscts = False
            ser.dsrdtr = False
            ser.xonxoff = False
        try:
            ser.open()
            return ser
        except Exception as exc:  # noqa: BLE001
            errors.append(str(exc))
            try:
                ser.close()
            except Exception:  # noqa: BLE001
                pass
    raise OSError("; ".join(dict.fromkeys(errors)))


def _serial_open_help(path: str, exc: Exception) -> None:
    """Print targeted guidance when a serial open fails (usually a driver problem)."""
    is_einval = "Invalid argument" in str(exc) or getattr(exc, "errno", None) == 22
    print("    -> The device was found but macOS refused to CONFIGURE the serial port.")
    if is_einval:
        print("       errno 22 here = the bound serial DRIVER can't apply settings (tcsetattr fails).")
        print("       This is a macOS USB-serial DRIVER issue — not the inverter, cable wiring, or baud.")

    # Name the actual converter chip(s) present and give chip-specific driver advice.
    chips = []
    for vid, pid, name in _scan_usb_vidpids():
        hint = _serial_chip_hint(vid, pid)
        if hint:
            chips.append((vid, pid, name, hint))
    for vid, pid, name, (chip, advice) in chips:
        print(f"       Detected converter: {chip} ({vid:04x}:{pid:04x}) — {name or ''}")
        if vid == 0x10C4:  # Silicon Labs CP210x / CP2102N
            print("         FIX: install the Silicon Labs CP210x VCP driver, then approve it under")
            print("         System Settings ▸ General ▸ Login Items & Extensions ▸ Driver Extensions,")
            print("         and replug. macOS App Store: search \"Silicon Labs VCP\". Or silabs.com VCP drivers.")
            print("         (macOS's built-in driver can't configure some CP2102N units — the SiLabs")
            print("          driver creates a working /dev/cu.* node, e.g. cu.SLAB_USBtoUART.)")
        else:
            print(f"         FIX: {advice}")

    others = [p for p in glob.glob("/dev/cu.*") if p != path]
    preferred = [p for p in others if "wch" in p.lower() or "slab" in p.lower() or "usbmodem" in p.lower()]
    if preferred:
        print(f"       • Or try this other node: {', '.join(preferred)}")
    print("       • Make sure no other app holds the port (Growatt ShinePhone/ShineBus, a `screen`")
    print("         session, another bridge instance). Close them and replug.")
    print("       • Reliable fallback: use an FTDI (FT232) cable, or run this bridge on a Raspberry")
    print("         Pi / Linux box (CP210x works there out of the box) and point SA_BRIDGE_URL at it.")
    print(f"       • Re-test after fixing:  python3 tools/usb_bridge.py --test-serial {path}")


def _modbus_crc(data: bytes) -> bytes:
    """Modbus-RTU CRC-16 (poly 0xA001), returned low-byte-first as it goes on the wire."""
    crc = 0xFFFF
    for byte in data:
        crc ^= byte
        for _ in range(8):
            crc = (crc >> 1) ^ 0xA001 if crc & 1 else crc >> 1
    return bytes([crc & 0xFF, (crc >> 8) & 0xFF])


def _read_for(ser, deadline_s: float, stop_on=None) -> bytes:
    """Read until `stop_on` byte(s) appear or the deadline passes."""
    deadline = time.time() + deadline_s
    buf = b""
    while time.time() < deadline:
        chunk = ser.read(128)
        if chunk:
            buf += chunk
        if stop_on and stop_on in buf:
            break
    return buf


def _probe_voltronic(ser) -> bytes:
    """Send QPIGS (Axpert/Phocos/Growatt-SPF ASCII) and return the raw reply (or b'')."""
    ser.write(b"QPIGS\xb7\xa9\r")  # QPIGS + its fixed CRC (0xB7A9) + CR
    ser.flush()
    return _read_for(ser, 2.5, stop_on=b"\r")


def _probe_modbus(ser) -> bytes:
    """Send a Growatt-SPF Modbus-RTU read (input regs 0..9, slave 1) and return the reply."""
    frame = bytes([0x01, 0x04, 0x00, 0x00, 0x00, 0x0A])  # addr, func 0x04, start 0, count 10
    ser.write(frame + _modbus_crc(frame))
    ser.flush()
    return _read_for(ser, 2.0)


def _looks_like_modbus_reply(buf: bytes) -> bool:
    # Echoed slave addr 0x01 + a read/exception function code for func 0x03/0x04.
    return len(buf) >= 5 and buf[0] == 0x01 and buf[1] in (0x03, 0x04, 0x83, 0x84)


def _jk_read_all_frame(address: int = 0) -> bytes:
    """JK-BMS 0x4E 0x57 'read all' request (4-byte sum checksum)."""
    body = bytes([(address >> 24) & 0xFF, (address >> 16) & 0xFF, (address >> 8) & 0xFF,
                  address & 0xFF, 0x06, 0x03, 0x00, 0x00, 0, 0, 0, 0, 0x68])
    frame = bytearray(b"\x4e\x57")
    frame += (2 + len(body) + 4).to_bytes(2, "big")
    frame += body
    frame += (sum(frame) & 0xFFFFFFFF).to_bytes(4, "big")
    return bytes(frame)


def _probe_jk(ser) -> bytes:
    """Send a JK-BMS 'read all' and return the raw reply (a JK frame starts 0x4E 0x57)."""
    ser.write(_jk_read_all_frame(0))
    ser.flush()
    return _read_for(ser, 2.0, stop_on=None)


def _test_serial(path: str, baud: int, protocol: str = "phocos") -> None:
    """Open a serial port and probe it with the protocol for the chosen inverter family.

    phocos/axpert  -> Voltronic ASCII (QPIGS).
    growatt        -> try Voltronic ASCII first, then Growatt-SPF Modbus-RTU, and report
                      which one the inverter actually answers (SPF 5000 ES units vary).
    jk             -> JK-BMS 0x4E 0x57 'read all'; also tries Modbus-RTU as a fallback.
    """
    print(f"Opening {path} @ {baud}  (protocol: {protocol}) ...")
    try:
        ser = _open_serial(path, baud, timeout=1.0)
    except Exception as exc:  # noqa: BLE001
        print(f"[FAIL] cannot open: {exc}")
        _serial_open_help(path, exc)
        return
    try:
        try:
            ser.reset_input_buffer()
        except Exception:  # noqa: BLE001
            pass

        if protocol == "jk":
            print("[*] sending JK-BMS read-all (0x4E 0x57)...")
            buf = _probe_jk(ser)
            if buf.startswith(b"\x4e\x57"):
                print(f"[OK] JK reply ({len(buf)} bytes): {buf[:32].hex(' ')}...")
                print(f"     Valid JK frame — attach with the 'jk' driver at baud {baud}.")
                return
            if buf:
                print(f"[?] got {len(buf)} bytes, not a JK frame: {buf[:32].hex(' ')}")
                print("     If this repeats at every baud, the BMS may be in Modbus mode.")
            # fall through to a Modbus probe in case the RS485 port is Modbus, not 0x4E57
            try:
                ser.reset_input_buffer()
            except Exception:  # noqa: BLE001
                pass
            print("[*] trying Modbus-RTU read as a fallback...")
            mb = _probe_modbus(ser)
            if _looks_like_modbus_reply(mb):
                print(f"[OK] Modbus reply ({len(mb)} bytes): {mb.hex(' ')}")
                print("     This JK speaks Modbus-RTU on RS485, not 0x4E57 — needs a JK-Modbus driver.")
                return
            print("[!] no usable reply. Sweep bauds (JK is usually 115200): "
                  "--baud 115200 / 9600. Check RS485 A/B wiring and that only one master is on the bus.")
            return

        # 1) Voltronic ASCII (the protocol the backend's axpert/phocos/growatt drivers speak).
        print("[*] sending QPIGS (Voltronic ASCII)...")
        buf = _probe_voltronic(ser)
        if buf.startswith(b"("):
            print(f"[OK] Voltronic reply ({len(buf)} bytes): {buf[:160]!r}")
            print("     Valid Voltronic response — attach with the axpert/phocos/growatt driver.")
            return
        if buf:
            print(f"[?] got {len(buf)} bytes but not a Voltronic frame: {buf[:160]!r}")

        # 2) For Growatt, also try Modbus-RTU — many SPF 5000 ES units speak this, not ASCII.
        if protocol == "growatt":
            try:
                ser.reset_input_buffer()
            except Exception:  # noqa: BLE001
                pass
            print("[*] sending Growatt-SPF Modbus-RTU read (func 0x04, regs 0-9)...")
            mb = _probe_modbus(ser)
            if _looks_like_modbus_reply(mb):
                print(f"[OK] Modbus-RTU reply ({len(mb)} bytes): {mb.hex(' ')}")
                print("     Your SPF 5000 ES speaks Modbus-RTU, NOT Voltronic ASCII.")
                print(f"     => Use baud {baud}. The current growatt driver is ASCII-only, so it")
                print("        needs a Modbus driver/transport to read this inverter (see notes).")
                return
            if mb:
                print(f"[?] got {len(mb)} bytes, not a clean Modbus frame: {mb.hex(' ')}")

        print("[!] no usable reply. Try other bauds (--baud 9600/2400/115200), and make sure no")
        print("    other master (ShineWiFi/ShineLAN dongle, ShinePhone/ShineBus app) is connected —")
        print("    only one device can poll the inverter at a time.")
    finally:
        ser.close()


class Bridge:
    """Tracks detected devices (serial + HID) and runs a TCP relay for each."""

    def __init__(self, baud, base_port, advertise_host, all_hid, vid_filter, pid_filter):
        self.baud = baud
        self.advertise_host = advertise_host
        self.all_hid = all_hid
        self.vid_filter = vid_filter
        self.pid_filter = pid_filter
        self.lock = threading.Lock()
        self.devices: dict[str, dict] = {}  # id -> {kind, tcp_port, info, present, target}
        self._next_port = base_port

    # --- detection -------------------------------------------------------
    def scan(self) -> None:
        found: dict[str, dict] = {}

        for p in list_ports.comports():
            found[f"serial:{p.device}"] = {
                "kind": "serial",
                "target": p.device,
                "info": {
                    "path": p.device,
                    "description": p.description or "",
                    "manufacturer": getattr(p, "manufacturer", None),
                    "vid": f"{p.vid:04x}" if p.vid else None,
                    "pid": f"{p.pid:04x}" if p.pid else None,
                    "likely_inverter": _looks_like_inverter(
                        p.description, getattr(p, "manufacturer", ""), p.hwid
                    ),
                },
            }

        for h in _enumerate_hid(self.all_hid, self.vid_filter, self.pid_filter):
            found[f"hid:{h['vid']}:{h['pid']}"] = {
                "kind": "hid",
                "target": h["path"],
                "info": {
                    "path": f"HID {h['vid']}:{h['pid']} ({h['description']})",
                    "description": h["description"],
                    "manufacturer": h["manufacturer"],
                    "vid": h["vid"],
                    "pid": h["pid"],
                    "likely_inverter": h["likely_inverter"],
                },
            }

        with self.lock:
            for dev_id, d in found.items():
                if dev_id not in self.devices:
                    tcp_port = self._next_port
                    self._next_port += 1
                    self.devices[dev_id] = {**d, "tcp_port": tcp_port, "present": True}
                    self._start_listener(dev_id, tcp_port)
                    print(f"[+] detected {d['kind']} {d['info']['path']} -> tcp {tcp_port}")
                else:
                    self.devices[dev_id].update(info=d["info"], target=d["target"])
                    if not self.devices[dev_id]["present"]:
                        print(f"[+] re-detected {d['info']['path']}")
                    self.devices[dev_id]["present"] = True

            for dev_id, entry in self.devices.items():
                if dev_id not in found and entry["present"]:
                    entry["present"] = False
                    print(f"[-] unplugged {entry['info']['path']}")

    def snapshot(self) -> list[dict]:
        with self.lock:
            return [
                {
                    **e["info"],
                    "bridge_host": self.advertise_host,
                    "bridge_port": e["tcp_port"],
                    "baud": self.baud,
                    "kind": e["kind"],
                }
                for e in self.devices.values()
                if e["present"]
            ]

    # --- relay -----------------------------------------------------------
    def _start_listener(self, dev_id: str, tcp_port: int) -> None:
        def serve():
            srv = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            srv.bind(("0.0.0.0", tcp_port))
            srv.listen(1)
            while True:
                conn, _ = srv.accept()
                threading.Thread(target=self._dispatch, args=(conn, dev_id), daemon=True).start()

        threading.Thread(target=serve, daemon=True).start()

    def _dispatch(self, conn: socket.socket, dev_id: str) -> None:
        entry = self.devices.get(dev_id, {})
        if entry.get("kind") == "hid":
            self._relay_hid(conn, entry["target"])
        else:
            self._relay_serial(conn, entry.get("target"))

    @staticmethod
    def _read_handshake(conn: socket.socket):
        """Consume the optional '\\x00SACONF baud=N' control line. Returns (baud, leftover)."""
        baud = None
        conn.settimeout(0.6)
        try:
            first = conn.recv(64)
        except (socket.timeout, OSError):
            first = b""
        conn.settimeout(None)
        if first.startswith(b"\x00SACONF"):
            line, _, rest = first.partition(b"\n")
            for tok in line.decode("ascii", "ignore").split():
                if tok.startswith("baud="):
                    try:
                        baud = int(tok.split("=", 1)[1])
                    except ValueError:
                        pass
            return baud, rest
        return baud, first

    def _relay_serial(self, conn: socket.socket, path) -> None:
        baud_override, leftover = self._read_handshake(conn)
        baud = baud_override or self.baud
        try:
            ser = _open_serial(path, baud)
        except Exception as exc:  # noqa: BLE001
            print(f"[!] cannot open {path} @ {baud}: {exc}")
            _serial_open_help(path, exc)
            conn.close()
            return
        if leftover:
            ser.write(leftover)

        stop = threading.Event()

        def serial_to_tcp():
            while not stop.is_set():
                try:
                    data = ser.read(256)
                except Exception:  # noqa: BLE001
                    break
                if data:
                    try:
                        conn.sendall(data)
                    except OSError:
                        break
            stop.set()

        def tcp_to_serial():
            while not stop.is_set():
                try:
                    data = conn.recv(256)
                except OSError:
                    break
                if not data:
                    break
                try:
                    ser.write(data)
                except Exception:  # noqa: BLE001
                    break
            stop.set()

        threading.Thread(target=serial_to_tcp, daemon=True).start()
        threading.Thread(target=tcp_to_serial, daemon=True).start()
        while not stop.is_set():
            time.sleep(0.1)
        try:
            ser.close()
        except Exception:  # noqa: BLE001
            pass
        conn.close()

    def _relay_hid(self, conn: socket.socket, hid_path) -> None:
        try:
            dev = HidDev(hid_path)
        except Exception as exc:  # noqa: BLE001
            print(f"[!] cannot open HID device: {exc}")
            conn.close()
            return

        _, buf = self._read_handshake(conn)  # baud irrelevant for HID
        try:
            while True:
                while b"\r" not in buf:
                    data = conn.recv(64)
                    if not data:
                        return
                    buf += data
                cmd, _, buf = buf.partition(b"\r")
                resp = self._hid_exchange(dev, cmd + b"\r")
                if resp:
                    conn.sendall(resp)
        except OSError:
            pass
        finally:
            dev.close()
            conn.close()

    @staticmethod
    def _hid_exchange(dev: HidDev, command: bytes, timeout: float = 3.0) -> bytes:
        # Voltronic over HID: write the framed command in 8-byte output reports,
        # then read 8-byte input reports until a carriage return is seen.
        for i in range(0, len(command), 8):
            dev.write(command[i : i + 8])
        deadline = time.time() + timeout
        out = b""
        while time.time() < deadline:
            chunk = dev.read(8, 500)
            if chunk:
                out += chunk
                if b"\r" in out:
                    break
        return out[: out.index(b"\r") + 1] if b"\r" in out else out


def _make_disco(bridge: Bridge):
    class Disco(BaseHTTPRequestHandler):
        def do_GET(self):
            if self.path.rstrip("/") == "/ports":
                body = json.dumps({"ports": bridge.snapshot()}).encode()
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
            else:
                self.send_response(404)
                self.end_headers()

        def log_message(self, *_):
            pass

    return Disco


def _scan_usb_vidpids() -> list:
    """Return (vid, pid, name) for every USB device on macOS.

    Uses ioreg (reliable across macOS versions; system_profiler returns nothing on some
    recent releases), falling back to system_profiler.
    """
    if platform.system() != "Darwin":
        return []
    return _scan_usb_ioreg() or _scan_usb_system_profiler()


def _scan_usb_ioreg() -> list:
    import re

    try:
        out = subprocess.run(
            ["ioreg", "-p", "IOUSB", "-l", "-w", "0"], capture_output=True, text=True, timeout=15
        ).stdout
    except Exception:  # noqa: BLE001
        return []

    devices, cur = [], None

    def flush():
        if cur and cur["pid"] is not None:
            devices.append((cur["vid"], cur["pid"], cur["name"]))

    for line in out.splitlines():
        if "+-o " in line:  # start of a device node
            flush()
            m = re.search(r"\+-o (.+?) <class", line)
            cur = {"name": m.group(1).strip() if m else None, "vid": None, "pid": None}
        if cur is None:
            continue
        m = re.search(r'"idVendor"\s*=\s*(\d+)', line)
        if m:
            cur["vid"] = int(m.group(1))
        m = re.search(r'"idProduct"\s*=\s*(\d+)', line)
        if m:
            cur["pid"] = int(m.group(1))
        m = re.search(r'"USB Product Name"\s*=\s*"([^"]*)"', line)
        if m:
            cur["name"] = m.group(1)
    flush()
    return devices


def _scan_usb_system_profiler() -> list:
    import re

    try:
        out = subprocess.run(
            ["system_profiler", "SPUSBDataType"], capture_output=True, text=True, timeout=15
        ).stdout
    except Exception:  # noqa: BLE001
        return []

    devices, cur = [], None

    def flush():
        if cur and cur["pid"] is not None:
            devices.append((cur["vid"], cur["pid"], cur["name"]))

    for raw in out.splitlines():
        s = raw.strip()
        if s.endswith(":") and "ID:" not in s:  # a device/section header
            flush()
            cur = {"name": s[:-1], "vid": None, "pid": None}
        if cur is None:
            continue
        m = re.search(r"Vendor ID:\s*0x([0-9a-fA-F]+)", s)
        if m:
            cur["vid"] = int(m.group(1), 16)
        m = re.search(r"Product ID:\s*0x([0-9a-fA-F]+)", s)
        if m:
            cur["pid"] = int(m.group(1), 16)
    flush()
    return devices


def _list_usb() -> None:
    print("== Serial ports (pyserial) ==")
    ports = list(list_ports.comports())
    if not ports:
        print("  (none)")
    for p in ports:
        flag = "  <-- likely inverter" if _looks_like_inverter(p.description, p.hwid) else ""
        print(f"  {p.device:32} {p.description} [{p.hwid}]{flag}")

    print("\n== HID devices (hidapi) ==")
    if not HID_OK:
        print("  hidapi not installed (only needed for HID inverters).")
    else:
        devs = _hid.enumerate()
        for d in devs:
            vid, pid = d.get("vendor_id", 0), d.get("product_id", 0)
            likely = vid in _INVERTER_VIDS or _looks_like_inverter(
                d.get("product_string"), d.get("manufacturer_string"), f"{vid:04x}:{pid:04x}"
            )
            if likely:
                print(f"  {vid:04x}:{pid:04x}  {d.get('product_string') or '?'}  <-- likely inverter")
        if not any(d.get("vendor_id") in _INVERTER_VIDS for d in devs):
            print("  (no likely-inverter HID devices)")

    # USB-serial converter detection — the key check for an RS232<->USB cable.
    usb = _scan_usb_vidpids()
    if usb:
        print("\n== USB-serial converter chips ==")
        found_chip = False
        have_serial = len(ports) > 0
        for vid, pid, name in usb:
            hint = _serial_chip_hint(vid, pid)
            if hint:
                found_chip = True
                chip, advice = hint
                print(f"  {vid:04x}:{pid:04x}  {name or chip}  ->  {chip}")
                if not have_serial:
                    print(f"     ⚠ no /dev/cu.* serial port present — driver likely missing.")
                    print(f"     {advice}")
                else:
                    print(f"     OK: a serial port is present; attach it in the UI.")
        if not found_chip:
            print("  No known USB-serial converter chip detected.")
            print("  Your RS232<->USB cable's chip isn't in the list — note its Vendor/Product")
            print("  ID from the full dump below and install that chip's macOS VCP driver.")

    if platform.system() == "Darwin":
        print("\n== All USB devices (system_profiler) ==")
        for vid, pid, name in usb:
            v = f"{vid:04x}" if vid is not None else "????"
            p = f"{pid:04x}" if pid is not None else "????"
            print(f"  {v}:{p}  {name or ''}")
        if not usb:
            print("  No USB peripherals enumerated at all.")
            print("  => The Mac isn't seeing ANY USB device, so this is a cable/port/power")
            print("     issue, not a driver issue. Checks:")
            print("       • Use a real DATA USB cable (many cables are charge-only).")
            print("       • Plug straight into the Mac, bypassing hubs/USB-C adapters; try another port.")
            print("       • A genuine USB-serial chip enumerates even with the inverter off.")
            print("     Confirm live with:   python3 tools/usb_bridge.py --watch")
            print("     Or raw:   system_profiler SPUSBDataType   |   ioreg -p IOUSB -l -w 0")


def _watch() -> None:
    """Live-diff serial ports and USB devices so you can SEE plug/unplug events."""
    import datetime

    print("Watching for USB changes. Plug/unplug the cable now. Ctrl-C to stop.\n")
    prev = None
    while True:
        ports = {p.device: f"{p.description} [{p.hwid}]" for p in list_ports.comports()}
        usb = _scan_usb_vidpids()
        sig = (tuple(sorted(ports)), tuple(sorted((v, p) for v, p, _ in usb)))
        if sig != prev:
            ts = datetime.datetime.now().strftime("%H:%M:%S")
            print(f"[{ts}] serial ports ({len(ports)}):")
            for dev, desc in ports.items():
                print(f"          {dev}  {desc}")
            ids = ", ".join(f"{v:04x}:{p:04x}" for v, p, _ in usb) or "(none)"
            print(f"[{ts}] usb devices  ({len(usb)}): {ids}")
            print()
            prev = sig
        time.sleep(1.0)


def main() -> None:
    ap = argparse.ArgumentParser(description="Bridge host USB inverters (serial + HID) to TCP.")
    ap.add_argument("--baud", type=int, default=2400, help="serial baud (Axpert/Phocos = 2400)")
    ap.add_argument("--disco-port", type=int, default=5510, help="discovery HTTP port")
    ap.add_argument("--base-port", type=int, default=5500, help="first TCP port assigned")
    ap.add_argument("--advertise-host", default=None,
                    help="hostname/IP the backend uses to reach this machine. By default it is "
                         "auto-detected from the baked-in SERVER_IP (or host.docker.internal if that "
                         "is None). Set explicitly to override.")
    ap.add_argument("--interval", type=float, default=2.0, help="re-scan interval (seconds)")
    ap.add_argument("--all-hid", action="store_true", help="bridge every HID device, not just likely inverters")
    ap.add_argument("--hid-vid", default=None, help="only bridge this HID vendor id (hex, e.g. 0665)")
    ap.add_argument("--hid-pid", default=None, help="only bridge this HID product id (hex, e.g. 5161)")
    ap.add_argument("--list-usb", action="store_true", help="DIAGNOSTIC: list all USB/HID devices and exit")
    ap.add_argument("--watch", action="store_true", help="DIAGNOSTIC: live-watch USB plug/unplug events")
    ap.add_argument("--test-serial", metavar="PATH", default=None,
                    help="DIAGNOSTIC: open a serial port, probe the inverter, then exit")
    ap.add_argument("--protocol", choices=("phocos", "axpert", "growatt", "jk"), default="phocos",
                    help="device family for --test-serial. phocos/axpert = Voltronic ASCII (QPIGS); "
                         "growatt also tries Growatt-SPF Modbus-RTU; jk = JK-BMS 0x4E57 (Modbus fallback).")
    ap.add_argument("--list", action="store_true", help=argparse.SUPPRESS)  # back-compat
    args = ap.parse_args()

    if args.list_usb or args.list:
        _list_usb()
        return

    if args.test_serial:
        _test_serial(args.test_serial, args.baud, args.protocol)
        return

    if args.watch:
        try:
            _watch()
        except KeyboardInterrupt:
            pass
        return

    vid_filter = int(args.hid_vid, 16) if args.hid_vid else None
    pid_filter = int(args.hid_pid, 16) if args.hid_pid else None

    # Resolve what address the backend should use to reach this bridge.
    # Explicit --advertise-host wins; otherwise derive it from the baked-in SERVER_IP;
    # otherwise fall back to host.docker.internal (bridge + backend on the same machine).
    advertise_host = args.advertise_host
    if advertise_host is None:
        if SERVER_IP:
            try:
                advertise_host = _local_ip_toward(SERVER_IP)
                print(f"[i] advertising {advertise_host} (route to server {SERVER_IP})")
            except OSError as exc:
                sys.exit(f"could not determine local IP toward server {SERVER_IP}: {exc}\n"
                         f"Pass --advertise-host <this-machine-ip> explicitly instead.")
        else:
            advertise_host = "host.docker.internal"

    if not HID_OK:
        print("[warn] hidapi not installed — only serial devices will be detected.")
        print("       Axpert/Phocos are usually HID: pip3 install hidapi (brew install hidapi on macOS)\n")

    bridge = Bridge(args.baud, args.base_port, advertise_host, args.all_hid, vid_filter, pid_filter)
    bridge.scan()

    def scanner():
        while True:
            time.sleep(args.interval)
            try:
                bridge.scan()
            except Exception as exc:  # noqa: BLE001
                print(f"[!] scan error: {exc}")

    threading.Thread(target=scanner, daemon=True).start()

    feed_url = f"http://{advertise_host}:{args.disco_port}"
    # Announce ourselves to the backend so it auto-discovers this bridge (no manual IP).
    if SERVER_IP:
        threading.Thread(target=_register_loop, args=(feed_url,), daemon=True).start()

    print(f"\nDiscovery feed:  {feed_url}/ports")
    print("Leave this running, then open the Solar Assistant UI -> Devices -> Scan.")
    print("If nothing is detected, run:  python3 tools/usb_bridge.py --list-usb\n")
    ThreadingHTTPServer(("0.0.0.0", args.disco_port), _make_disco(bridge)).serve_forever()


if __name__ == "__main__":
    main()
