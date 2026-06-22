import React, { useEffect, useRef, useState } from "react";
import { api } from "../api.js";

const BAUDS = [1200, 2400, 4800, 9600, 19200, 38400, 57600, 115200];
const usesBaud = (type) => type === "serial" || type === "tcp";

// Add the chosen baud into a transport spec under the right key for its type.
function withBaud(attach, baud) {
  if (!baud || !usesBaud(attach.type)) return attach;
  const key = attach.type === "serial" ? "baudrate" : "baud";
  return { ...attach, params: { ...attach.params, [key]: Number(baud) } };
}

// Stable identity for a transport target, so we can tell which detected ports are
// already attached regardless of how they're reached (serial / hidraw / tcp bridge).
function portKey(attach) {
  const p = attach?.params || {};
  if (attach?.type === "tcp") return `tcp:${p.host}:${p.port}`;
  if (attach?.type === "serial") return `serial:${p.port}`;
  if (attach?.type === "hidraw") return `hidraw:${p.path}`;
  return JSON.stringify(attach || {});
}

// Modal for discovering USB devices and attaching / managing them at runtime.
export default function SettingsPanel({ onClose }) {
  const [devices, setDevices] = useState([]);
  const [ports, setPorts] = useState([]);
  const [bridges, setBridges] = useState([]);
  const [drivers, setDrivers] = useState([]);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const pollRef = useRef(null);

  async function refreshDevices() {
    try {
      setDevices(await api.getDevices());
    } catch (e) {
      setError(e.message);
    }
  }

  async function scan(silent = false) {
    if (!silent) setScanning(true);
    try {
      setPorts(await api.scanPorts());
      if (!silent) setError(null);
    } catch (e) {
      if (!silent) setError(e.message);
    } finally {
      if (!silent) setScanning(false);
    }
  }

  async function refreshBridges() {
    try {
      setBridges(await api.getBridges());
    } catch {
      /* bridges are optional; ignore transient errors */
    }
  }

  useEffect(() => {
    refreshDevices();
    api.getDrivers().then(setDrivers).catch((e) => setError(e.message));
    scan();
    refreshBridges();
    // Auto-detect: keep re-scanning + refreshing so plugged/unplugged devices
    // appear and online state stays current without clicking anything.
    pollRef.current = setInterval(() => {
      scan(true);
      refreshDevices();
      refreshBridges();
    }, 3000);
    return () => clearInterval(pollRef.current);
  }, []);

  async function attach(cfg) {
    setBusy(true);
    setError(null);
    try {
      await api.addDevice(cfg);
      await refreshDevices();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function toggle(d) {
    setBusy(true);
    try {
      await api.updateDevice(d.id, { enabled: !d.enabled });
      await refreshDevices();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(d) {
    if (!confirm(`Remove ${d.name}?`)) return;
    setBusy(true);
    try {
      await api.removeDevice(d.id);
      await refreshDevices();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  const attachedKeys = new Set(devices.map((d) => portKey(d.transport)));

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Devices</h2>
          <button className="icon-btn" onClick={onClose}>✕</button>
        </div>

        {error && <div className="error">{error}</div>}

        <h3>Configured</h3>
        {devices.length === 0 && <p className="muted">No devices yet. Detected ports appear below.</p>}
        <ul className="dev-list">
          {devices.map((d) => (
            <li key={d.id} className="dev-row">
              <div>
                <strong>{d.name}</strong>
                <span className="muted">
                  {" "}· {d.driver} ·{" "}
                  {d.transport?.params?.port ||
                    d.transport?.params?.path ||
                    (d.transport?.type === "tcp"
                      ? `${d.transport.params.host}:${d.transport.params.port}`
                      : d.transport?.type)}
                  {(d.transport?.params?.baudrate || d.transport?.params?.baud) &&
                    ` · ${d.transport.params.baudrate || d.transport.params.baud} baud`}
                </span>
                <div>
                  <span className={`dot ${d.online ? "on" : "off"}`} />
                  <span className="muted small">{d.online ? "online" : "offline"}</span>
                </div>
              </div>
              <div className="dev-actions">
                <button disabled={busy} onClick={() => toggle(d)}>
                  {d.enabled ? "Disable" : "Enable"}
                </button>
                <button disabled={busy} className="danger" onClick={() => remove(d)}>
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ul>

        <h3>USB bridges</h3>
        {bridges.length === 0 ? (
          <p className="muted small">
            No host bridge connected. On macOS/Windows or a remote Pi, run{" "}
            <code>python3 tools/usb_bridge.py</code> — it registers here automatically.
          </p>
        ) : (
          <ul className="bridge-list">
            {bridges.map((b) => (
              <li key={b.url} className="bridge-row">
                <span className="dot on" />
                <code>{b.url}</code>
                <span className="muted small">
                  {b.source === "pinned"
                    ? " · pinned"
                    : ` · last seen ${b.seconds_ago}s ago`}
                </span>
              </li>
            ))}
          </ul>
        )}

        <div className="scan-head">
          <h3>Detected ports <span className="muted small">(auto-refreshing)</span></h3>
          <button disabled={scanning} onClick={() => scan()}>
            {scanning ? "Scanning…" : "↻ Scan now"}
          </button>
        </div>
        {ports.length === 0 && (
          <p className="muted">
            Nothing detected yet. Plug in a device — it appears here automatically.
            On macOS/Windows, run the host bridge first:{" "}
            <code>python3 tools/usb_bridge.py</code>
          </p>
        )}
        <ul className="port-list">
          {ports.map((p) => (
            <PortRow
              key={`${p.source}:${p.path}`}
              port={p}
              drivers={drivers}
              busy={busy}
              attached={attachedKeys.has(portKey(p.attach))}
              onAttach={attach}
            />
          ))}
        </ul>

        <details className="manual">
          <summary>Add manually</summary>
          <ManualForm drivers={drivers} busy={busy} onAttach={attach} />
        </details>
      </div>
    </div>
  );
}

function PortRow({ port, drivers, busy, attached, onAttach }) {
  const [driver, setDriver] = useState(
    drivers.includes("axpert") ? "axpert" : drivers[0] || "axpert"
  );
  const [name, setName] = useState(port.description || port.path);
  const [baud, setBaud] = useState(port.baud || 2400);
  const showBaud = usesBaud(port.attach?.type);

  return (
    <li className="port-row">
      <div>
        <strong>{port.path}</strong>
        <span className={`badge ${port.source === "bridge" ? "host" : "local"}`}>
          {port.source === "bridge" ? "host USB" : "local"}
        </span>
        {port.likely_inverter && <span className="badge inv">likely inverter</span>}
        <div className="muted small">
          {port.transport} · {port.description}
          {port.vid && ` · ${port.vid}:${port.pid}`}
        </div>
      </div>
      <div className="port-attach">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" />
        <select value={driver} onChange={(e) => setDriver(e.target.value)}>
          {drivers.map((d) => (
            <option key={d} value={d}>{d}</option>
          ))}
        </select>
        {showBaud && (
          <select value={baud} onChange={(e) => setBaud(e.target.value)} title="Baud rate">
            {BAUDS.map((b) => (
              <option key={b} value={b}>{b} baud</option>
            ))}
          </select>
        )}
        <button
          disabled={busy || attached}
          onClick={() => onAttach({ name, driver, transport: withBaud(port.attach, baud) })}
        >
          {attached ? "Attached" : "Attach"}
        </button>
      </div>
    </li>
  );
}

function ManualForm({ drivers, busy, onAttach }) {
  const [type, setType] = useState("serial");
  const [path, setPath] = useState("/dev/ttyUSB0");
  const [host, setHost] = useState("host.docker.internal");
  const [tcpPort, setTcpPort] = useState(5500);
  const [baud, setBaud] = useState(2400);
  const [driver, setDriver] = useState("axpert");
  const [name, setName] = useState("My Inverter");

  function submit(e) {
    e.preventDefault();
    let params;
    if (type === "serial") params = { port: path };
    else if (type === "hidraw") params = { path };
    else if (type === "tcp") params = { host, port: Number(tcpPort) };
    else params = {};
    onAttach({ name, driver, transport: withBaud({ type, params }, baud) });
  }

  return (
    <form className="manual-form" onSubmit={submit}>
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" />
      <select value={driver} onChange={(e) => setDriver(e.target.value)}>
        {drivers.map((d) => (
          <option key={d} value={d}>{d}</option>
        ))}
      </select>
      <select value={type} onChange={(e) => setType(e.target.value)}>
        <option value="serial">serial</option>
        <option value="hidraw">hidraw</option>
        <option value="tcp">tcp (bridge)</option>
        <option value="mock">mock</option>
      </select>
      {type === "tcp" ? (
        <>
          <input value={host} onChange={(e) => setHost(e.target.value)} placeholder="host" />
          <input
            value={tcpPort}
            onChange={(e) => setTcpPort(e.target.value)}
            placeholder="5500"
            style={{ width: 80 }}
          />
        </>
      ) : type !== "mock" ? (
        <input value={path} onChange={(e) => setPath(e.target.value)} placeholder="/dev/ttyUSB0" />
      ) : null}
      {usesBaud(type) && (
        <select value={baud} onChange={(e) => setBaud(e.target.value)} title="Baud rate">
          {BAUDS.map((b) => (
            <option key={b} value={b}>{b} baud</option>
          ))}
        </select>
      )}
      <button disabled={busy} type="submit">Add</button>
    </form>
  );
}
