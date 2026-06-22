import React from "react";
import MetricTile from "./MetricTile.jsx";
import { chargePower, usedPower, capacity } from "../metrics.js";

// Priority ordering so the headline metrics show first per device kind.
const PRIORITY = {
  inverter: [
    "mode", "pv_input_power", "ac_output_active_power", "battery_voltage",
    "battery_capacity", "output_load_percent", "grid_voltage", "inverter_temperature",
  ],
  bms: [
    "soc", "soh", "pack_voltage", "pack_current", "power", "cell_min", "cell_max",
    "cell_delta", "cell_temp", "cycles",
  ],
};

function Cells({ cells }) {
  if (!cells || !cells.length) return null;
  const lo = Math.min(...cells);
  const hi = Math.max(...cells);
  return (
    <div className="cells">
      <div className="cells-head">
        <h3 className="card-title" style={{ fontSize: 16, margin: 0 }}>Cells ({cells.length})</h3>
        <span className="muted small">{(lo / 1000).toFixed(3)}–{(hi / 1000).toFixed(3)} V</span>
      </div>
      <div className="cell-grid">
        {cells.map((mv, i) => {
          const frac = hi === lo ? 1 : (mv - lo) / (hi - lo);
          const color = mv === lo ? "#f5c518" : mv === hi ? "#22c55e" : "#3b82f6";
          return (
            <div className="cell" key={i} title={`Cell ${i + 1}: ${(mv / 1000).toFixed(3)} V`}>
              <div className="cell-bar"><div style={{ height: `${20 + frac * 80}%`, background: color }} /></div>
              <div className="cell-v">{(mv / 1000).toFixed(2)}</div>
              <div className="cell-n">{i + 1}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function DeviceDetail({ reading, onBack }) {
  if (!reading) {
    return (
      <div className="card">
        <button className="pill" onClick={onBack}>← Back</button>
        <p className="muted" style={{ marginTop: 16 }}>Device not found or no data yet.</p>
      </div>
    );
  }

  const { device_name, kind, online, metrics = {}, error, ts, raw } = reading;
  const keys = Object.keys(metrics);
  const prio = PRIORITY[kind] || [];
  const ordered = [
    ...prio.filter((k) => keys.includes(k)),
    ...keys.filter((k) => !prio.includes(k)),
  ];
  const cells = raw?.cells_mv;

  return (
    <div className="detail">
      <div className="detail-bar">
        <button className="pill" onClick={onBack}>← Back to dashboard</button>
        <div className="detail-bar-right">
          {ts && <span className="muted small">Updated {new Date(ts).toLocaleTimeString()}</span>}
          <span className={`status ${online ? "online" : "offline"}`}>{online ? "online" : "offline"}</span>
        </div>
      </div>

      <div className="card">
        <div className="detail-head">
          <div>
            <h2 className="card-title" style={{ marginBottom: 4 }}>{device_name}</h2>
            <span className="muted small">{kind} · Capacity {capacity(reading)}</span>
          </div>
          <div className="detail-kpis">
            <div><div className="muted small">Charged</div><div className="kpi">{Math.round(chargePower(reading))} <span className="unit">W</span></div></div>
            <div><div className="muted small">Used</div><div className="kpi">{Math.round(usedPower(reading))} <span className="unit">W</span></div></div>
          </div>
        </div>

        {error && <div className="error">{error}</div>}

        <div className="metrics">
          {ordered.map((k) => (
            <MetricTile key={k} name={k} metric={metrics[k]} />
          ))}
        </div>

        <Cells cells={cells} />
      </div>
    </div>
  );
}
