# Solar Assistant

A self-hosted dashboard for solar inverters — reads live data over a **USB serial /
HID** connection and streams it to a web UI in real time. Built like
[Solar Assistant](https://solar-assistant.io): a small backend talks to the hardware,
a frontend shows it.

Designed to be **modular**: inverters and battery BMS systems are pluggable drivers, so
adding new hardware is a config edit (and, for a new model, one driver file) — nothing
else changes.

Supported inverters: **Axpert King / Phocos** and **Growatt SPF 5000 ES** (SPF off-grid
family) — all Voltronic ASCII protocol. Pick the driver per device in the UI.

---

## Architecture

```
 USB (serial / hidraw)
        │
        ▼
 ┌──────────────┐   Transport    ┌───────────────┐   Reading   ┌──────────┐
 │  Inverter /  │ ─────────────▶ │    Driver     │ ──────────▶ │  Poller  │
 │   BMS HW     │                │ (Device subclass)           └────┬─────┘
 └──────────────┘                └───────────────┘                  │ publish
                                                                     ▼
                                                              ┌────────────┐
                                                              │  EventBus  │
                                                              └────┬───────┘
                                              REST /api      ┌─────┴──────┐  WS /ws
                                              snapshot ◀─────┤  FastAPI   ├────▶ live
                                                             └─────┬──────┘    stream
                                                                   ▼
                                                            React frontend
```

Key seams (this is what makes it modular):

| Layer | File | Add a new… |
|-------|------|------------|
| **Transport** | `backend/app/transports/` | wire type (serial, hidraw, tcp, CAN, …) |
| **Protocol** | `backend/app/protocols/` | inverter/BMS protocol parser |
| **Device driver** | `backend/app/devices/{inverters,bms}/` | inverter or battery model |
| **Registry** | `backend/app/core/registry.py` | register the driver name |
| **Topology** | `backend/config/devices.yaml` | a physical device instance |

The normalized `Reading` shape (`metrics: {key: {value, unit, label}}`) is identical for
every device kind, so the API and frontend never need device-specific code.

---

## Quick start (Docker)

```bash
cd solar-assistant
cp .env.example .env          # set SA_INVERTER_PORT to your device
docker compose up --build
```

- Frontend: <http://localhost:8080>
- Backend API: <http://localhost:8000/api/health>

Out of the box a **simulated inverter** (`inverter-mock`) streams live-looking data so
you can verify the whole stack with no hardware attached.

### Connect a real Axpert King / Phocos (all from the UI)

USB devices are **discovered dynamically** — there are no ports or env vars to set, and
the container starts fine with nothing plugged in.

1. Plug the inverter in (any time — even after the stack is running).
2. Open the dashboard → **⚙ Devices**.
3. Click **↻ Scan for devices**. Detected serial/HID ports are listed; ones that look
   like an inverter are flagged.
4. Pick the driver (`axpert` / `phocos` / `growatt`), name it, and click **Attach**. It
   starts streaming immediately and the config is persisted (`config/devices.json`).

You can enable/disable or remove devices from the same panel. If a port isn't
auto-detected you can add it manually (serial / hidraw / mock).

Ports auto-refresh in the panel, so plugging/unplugging is reflected live — you just
pick the driver for whichever port appears.

> **Linux host:** the backend container binds the host's `/dev`, so USB devices are
> detected directly (`source: local`). Nothing else to run.

### Use a USB device plugged into a Mac (or Windows)

Docker Desktop runs in a Linux VM that **cannot see host USB**, so the container can't
open `/dev/tty.usbserial-*` itself. Run the bundled bridge **on the Mac** — it
auto-detects every USB serial device (multiple at once), republishes each over TCP, and
publishes a discovery feed the backend reads. Detected ports then show up in the UI
tagged **host USB**.

> **Most Axpert King / Phocos inverters are USB *HID* devices, not serial ports** — so
> they never appear as `/dev/cu.*`. The bridge handles both serial **and** HID, but HID
> support needs `hidapi`:

```bash
pip3 install pyserial hidapi
# macOS also:  brew install hidapi
python3 tools/usb_bridge.py            # leave running; auto-detects plug/unplug (serial + HID)
python3 tools/usb_bridge.py --list-usb # DIAGNOSTIC: list every USB/HID device it can see
```

The mobile app is not part of data collection. Once devices are attached, the backend
restores them from `backend/config/devices.json`, polls their bridge TCP ports continuously,
and writes daily energy aggregates even when no web or mobile client is connected.

For unattended collection, run the bridge as an operating-system service. A systemd
template is provided at `tools/solar-usb-bridge.service.example`. Set its user, repository,
Python path, backend URL, and bridge host address, then install it:

```bash
sudo cp tools/solar-usb-bridge.service.example /etc/systemd/system/solar-usb-bridge.service
sudo systemctl daemon-reload
sudo systemctl enable --now solar-usb-bridge
```

The bridge backend URL can also be configured without editing source:

```bash
SA_BACKEND_URL=http://192.168.0.13:8000 \
python3 tools/usb_bridge.py --advertise-host 192.168.0.10
```

On macOS, use `tools/com.solar-assistant.usb-bridge.plist.example`: replace its
placeholders, copy it to `~/Library/LaunchAgents/com.solar-assistant.usb-bridge.plist`,
then load it with:

```bash
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.solar-assistant.usb-bridge.plist
```

Then (with `docker compose up` running): **⚙ Devices → Scan** → your inverter appears
as **host USB** → pick `axpert`/`phocos`/`growatt` → **Attach**. The backend reaches it over
`host.docker.internal` automatically (HID report chunking is done in the bridge).

- Serial defaults to **2400 baud** (Axpert/Phocos); selectable per-device in the UI or
  with `--baud`. (Baud is irrelevant for HID.)
- Discovery is served on `:5510`; each device gets a TCP port from `:5500`. The
  backend's `SA_BRIDGE_URL` (in `docker-compose.yml`) points at it.
- Multiple inverters/BMS units each get their own entry — attach a driver to each.

**Nothing detected when you plug in?** Run the diagnostic:

```bash
python3 tools/usb_bridge.py --list-usb
```

It reports four things: serial ports, HID inverters, **USB-serial converter chips**, and
the full USB device list.

- **RS232-to-USB cable (e.g. Phocos):** this is a *serial* device. It only appears as
  `/dev/cu.*` once macOS has the **driver for the cable's converter chip**. The
  diagnostic detects the chip (CP210x / CH340 / FTDI / PL2303 / …) and, if no serial
  port is present, tells you exactly which driver to install. After installing, replug —
  it shows under **Serial ports** and the bridge picks it up automatically. Attach it in
  the UI and set **2400 baud**.
- **HID inverter** (often `0665:5161`): bridged automatically. If an unusual HID isn't
  auto-flagged, target it: `--hid-vid 0665 --hid-pid 5161` (or `--all-hid`).
- **Chip not recognized:** note its Vendor/Product ID from the **All USB devices** dump
  and install that chip's macOS VCP driver.

> Common macOS driver notes: FTDI and recent CP210x are built in; **CH340/CH341** and
> **PL2303** usually need a driver install (and some PL2303 clones aren't supported on
> current macOS at all). A genuine CP210x/FTDI cable is the most trouble-free choice.

---

## Local development (no Docker)

Backend:
```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

Frontend:
```bash
cd frontend
npm install
npm run dev          # http://localhost:5173, proxies /api and /ws to :8000
```

Run the protocol tests:
```bash
cd backend && pytest
```

---

## API

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/health` | liveness |
| GET | `/api/ports` | scan host for USB serial / HID devices (live) |
| GET | `/api/drivers` | available device drivers |
| GET | `/api/devices` | configured devices + online state |
| POST | `/api/devices` | attach a device `{name, driver, transport:{type, params}}` |
| PUT | `/api/devices/{id}` | update a device (enable/disable, change port, …) |
| DELETE | `/api/devices/{id}` | remove a device |
| GET | `/api/readings` | latest reading for every device |
| GET | `/api/readings/{id}` | latest reading for one device |
| WS  | `/ws` | live stream of readings (snapshot on connect, then updates) |

---

## Adding a battery BMS (example)

1. Create `backend/app/devices/bms/my_bms.py` subclassing `BMSDevice`, implement
   `poll()` and parse your protocol into `metrics` (`soc`, `pack_voltage`, …).
2. Register it in `registry.py`: `"my_bms": MyBMS`.
3. Attach it from the UI (**⚙ Devices**) — pick the `my_bms` driver and its port.

That's it — the poller picks it up, it streams over the same WebSocket, and the
frontend renders it next to the inverters. See `bms/base.py` for the expected fields.
# DIY_SOLAR
