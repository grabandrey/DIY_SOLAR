import React from "react";
import { chargePower, usedPower, sumBy } from "../metrics.js";

const kw = (w) => (w / 1000).toFixed(2);

// "Current Power" card: live PV (Sun), net return, and load (Electrics), over a
// faint bar sparkline built from the session series.
export default function CurrentPower({ readings, series, onOpen }) {
  const charged = sumBy(readings, chargePower);
  const used = sumBy(readings, usedPower);
  const net = Math.max(charged - used, 0);

  const W = 280, H = 80;
  const max = Math.max(100, ...series.map((p) => Math.max(p.charged, p.used)));
  const n = Math.max(series.length, 1);
  const step = W / Math.max(n, 12);
  const barW = Math.min(7, step * 0.5);

  return (
    <section className="card">
      <div className="card-top">
        <h2 className="card-h">Current Power</h2>
        <button className="go-btn" onClick={onOpen}>↗</button>
      </div>

      <div className="cp-stats">
        <div className="cp-stat">
          <div className="cp-val">{kw(charged)}<span className="u">kW</span></div>
          <div className="cp-lab">Sun</div>
        </div>
        <div className="cp-stat">
          <div className="cp-val">{kw(net)}<span className="u">kW</span></div>
          <div className="cp-lab">Returns</div>
        </div>
        <div className="cp-stat">
          <div className="cp-val">{kw(used)}<span className="u">kW</span></div>
          <div className="cp-lab">Electrics</div>
        </div>
      </div>

      <svg className="cp-chart" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
        {series.map((p, i) => {
          const h = (p.charged / max) * (H - 6);
          const x = i * step + step / 2;
          const accent = i === series.length - 1;
          return (
            <rect
              key={p.t}
              x={x - barW / 2}
              y={H - h}
              width={barW}
              height={h}
              rx={barW / 2}
              fill={accent ? "var(--orange)" : "#d8d3c6"}
            />
          );
        })}
      </svg>
    </section>
  );
}
