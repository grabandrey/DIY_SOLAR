import React from "react";
import MetricTile from "./MetricTile.jsx";

// A few headline metrics get surfaced first per device kind; the rest follow.
const PRIORITY = {
  inverter: [
    "mode",
    "pv_input_power",
    "ac_output_active_power",
    "battery_voltage",
    "battery_capacity",
    "output_load_percent",
    "grid_voltage",
    "inverter_temperature",
  ],
  bms: ["soc", "pack_voltage", "pack_current", "soh", "cell_temp", "cycles"],
};

export default function DeviceCard({ reading }) {
  const { device_name, kind, online, metrics, error, ts } = reading;
  const keys = Object.keys(metrics || {});
  const priority = PRIORITY[kind] || [];
  const ordered = [
    ...priority.filter((k) => keys.includes(k)),
    ...keys.filter((k) => !priority.includes(k)),
  ];

  return (
    <section className={`card ${online ? "" : "offline"}`}>
      <div className="card-head">
        <div>
          <h2>{device_name}</h2>
          <span className="kind">{kind}</span>
        </div>
        <span className={`status ${online ? "online" : "offline"}`}>
          {online ? "online" : "offline"}
        </span>
      </div>

      {error && <div className="error">{error}</div>}

      <div className="metrics">
        {ordered.map((key) => (
          <MetricTile key={key} name={key} metric={metrics[key]} />
        ))}
      </div>

      {ts && <div className="ts">updated {new Date(ts).toLocaleTimeString()}</div>}
    </section>
  );
}
