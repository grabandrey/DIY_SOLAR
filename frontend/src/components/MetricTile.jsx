import React from "react";

export default function MetricTile({ name, metric }) {
  const label = metric.label || name.replace(/_/g, " ");
  const value = metric.value;
  const display = typeof value === "number" ? value.toLocaleString() : value;

  return (
    <div className="tile">
      <div className="tile-value">
        {display}
        {metric.unit && <span className="tile-unit"> {metric.unit}</span>}
      </div>
      <div className="tile-label">{label}</div>
    </div>
  );
}
