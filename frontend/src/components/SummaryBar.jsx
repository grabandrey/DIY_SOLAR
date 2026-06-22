import React from "react";

// Aggregates headline figures across all inverters for an at-a-glance system view.
function sumMetric(readings, key) {
  return readings
    .filter((r) => r.online && r.metrics?.[key])
    .reduce((acc, r) => acc + (Number(r.metrics[key].value) || 0), 0);
}

export default function SummaryBar({ readings }) {
  const inverters = readings.filter((r) => r.kind === "inverter");
  const pv = sumMetric(inverters, "pv_input_power");
  const load = sumMetric(inverters, "ac_output_active_power");
  const batteries = inverters.filter((r) => r.metrics?.battery_capacity);
  const soc =
    batteries.length > 0
      ? Math.round(sumMetric(batteries, "battery_capacity") / batteries.length)
      : null;

  const items = [
    { label: "Solar input", value: `${Math.round(pv)} W` },
    { label: "Load", value: `${Math.round(load)} W` },
    { label: "Battery", value: soc != null ? `${soc} %` : "—" },
    { label: "Devices online", value: `${readings.filter((r) => r.online).length}/${readings.length}` },
  ];

  return (
    <div className="summary">
      {items.map((it) => (
        <div className="summary-item" key={it.label}>
          <div className="summary-value">{it.value}</div>
          <div className="summary-label">{it.label}</div>
        </div>
      ))}
    </div>
  );
}
