import React from "react";
import { chargePower, usedPower, sumBy } from "../metrics.js";

function PanelArt() {
  // Decorative solar-panel illustration (SVG) standing in for the design's render.
  return (
    <svg viewBox="0 0 220 170" className="panel-art" aria-hidden="true">
      <g transform="rotate(-12 110 80)">
        {[0, 1, 2].map((r) =>
          [0, 1, 2].map((c) => (
            <rect
              key={`${r}-${c}`}
              x={30 + c * 52}
              y={20 + r * 38}
              width="48"
              height="34"
              rx="3"
              fill="#3b82f6"
              stroke="#bfdbfe"
              strokeWidth="2"
            />
          ))
        )}
      </g>
      <rect x="104" y="120" width="10" height="34" rx="2" fill="#93c5fd" />
    </svg>
  );
}

export default function Overview({ readings, series }) {
  const charged = sumBy(readings, chargePower);
  const used = sumBy(readings, usedPower);
  const avg = (key) =>
    series.length ? Math.round(series.reduce((a, p) => a + p[key], 0) / series.length) : 0;

  return (
    <section className="card overview">
      <h2 className="card-title light">Overview</h2>
      <div className="overview-body">
        <div className="overview-stats">
          <div className="ov-stat">
            <div className="ov-label">Site Installed</div>
            <div className="ov-value">{readings.length.toLocaleString()}</div>
          </div>
          <div className="ov-stat">
            <div className="ov-label">Total Charging</div>
            <div className="ov-value">
              {Math.round(charged).toLocaleString()} <span className="ov-unit">W</span>
            </div>
          </div>
          <div className="ov-stat">
            <div className="ov-label">Power Used</div>
            <div className="ov-value">
              {Math.round(used).toLocaleString()} <span className="ov-unit">W</span>
            </div>
          </div>
        </div>

        <div className="overview-right">
          <PanelArt />
          <div className="overview-avgs">
            <div>
              <span className="dot green" /> <span className="avg-label">Avg Used</span>
              <div className="avg-value">
                {avg("used")} <span className="ov-unit">W</span>
              </div>
            </div>
            <div>
              <span className="dot yellow" /> <span className="avg-label">Avg Charged</span>
              <div className="avg-value">
                {avg("charged")} <span className="ov-unit">W</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
