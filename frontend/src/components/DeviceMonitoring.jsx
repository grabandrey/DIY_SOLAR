import React from "react";
import { chargePower, usedPower, capacity } from "../metrics.js";

export default function DeviceMonitoring({ readings, onManage, onSelect }) {
  return (
    <section className="card monitor">
      <div className="card-head-row">
        <h2 className="card-title">Device Monitoring</h2>
        <button className="pill" onClick={onManage}>⚙ Manage</button>
      </div>

      {readings.length === 0 && (
        <p className="muted small">No devices yet — open Manage to scan and attach one.</p>
      )}

      <ul className="monitor-list">
        {readings.map((r) => (
          <li
            className="monitor-row clickable"
            key={r.device_id}
            onClick={() => onSelect?.(r.device_id)}
          >
            <div className={`mon-icon ${r.online ? "" : r.pending ? "pending" : "alert"}`}>
              {r.kind === "bms" ? "▭" : "▦"}
              {!r.online && !r.pending && <span className="mon-badge">!</span>}
            </div>
            <div className="mon-name">
              <strong>{r.device_name}</strong>
              <span className="muted small">
                {r.pending ? "connecting…" : `Capacity ${capacity(r)}`}
              </span>
            </div>
            <div className="mon-metric">
              <span className="muted small">Charged</span>
              <div><b>{Math.round(chargePower(r))}</b> <span className="unit">W</span></div>
            </div>
            <div className="mon-metric">
              <span className="muted small">Used</span>
              <div><b>{Math.round(usedPower(r))}</b> <span className="unit">W</span></div>
            </div>
            <button
              className="mon-more"
              title="Details"
              onClick={(e) => { e.stopPropagation(); onSelect?.(r.device_id); }}
            >
              ⋮
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
