import React from "react";
import { chargePower, usedPower, sumBy } from "../metrics.js";

const kw = (w) => (w / 1000).toFixed(2);

const CX = 130, CY = 120, R = 96;
const pt = (deg) => {
  const a = (deg * Math.PI) / 180;
  return [CX + R * Math.cos(a), CY - R * Math.sin(a)];
};
const arc = (from, to) => {
  const [x1, y1] = pt(from);
  const [x2, y2] = pt(to);
  return `M ${x1} ${y1} A ${R} ${R} 0 0 1 ${x2} ${y2}`;
};

// "Energy Balance Today" — a semicircle split between received (charged) and
// costs (used) power.
export default function EnergyBalance({ readings }) {
  const received = sumBy(readings, chargePower);
  const costs = sumBy(readings, usedPower);
  const total = received + costs || 1;
  const split = 180 - (received / total) * 180; // angle where received hands off to costs

  return (
    <section className="card">
      <div className="card-top">
        <h2 className="card-h">Energy Balance Today</h2>
        <button className="go-btn">↗</button>
      </div>

      <div className="eb-legend">
        <span><i className="dot orange" /> Received</span>
        <span><i className="dot yellow" /> Costs</span>
      </div>

      <div className="eb-gauge">
        <svg viewBox="0 0 260 150">
          <path d={arc(180, 0)} fill="none" stroke="#e7e2d6" strokeWidth="14" strokeLinecap="round" />
          <path d={arc(180, split)} fill="none" stroke="var(--orange)" strokeWidth="14" strokeLinecap="round" />
          <path d={arc(split, 0)} fill="none" stroke="var(--yellow)" strokeWidth="14" strokeLinecap="round" />
        </svg>
        <div className="eb-vals">
          <span><i className="dot orange" /> {kw(received)} kW</span>
          <span><i className="dot yellow" /> {kw(costs)} kW</span>
        </div>
      </div>
    </section>
  );
}
