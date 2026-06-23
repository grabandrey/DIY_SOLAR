import React from "react";

// "Total Energy" card: a smoothed area line of charged power from the session
// series, with a tooltip pinned to the latest sample.
export default function TotalEnergyChart({ series, soc, dateLabel }) {
  const W = 300, H = 110;
  const pts = series.length ? series : [{ t: 0, charged: 0 }];
  const max = Math.max(100, ...pts.map((p) => p.charged));
  const n = Math.max(pts.length - 1, 1);
  const coords = pts.map((p, i) => [
    (i / n) * W,
    H - 8 - (p.charged / max) * (H - 20),
  ]);

  const line = coords.map(([x, y], i) => `${i ? "L" : "M"} ${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  const area = `${line} L ${W} ${H} L 0 ${H} Z`;
  const [lx, ly] = coords[coords.length - 1];
  const latest = Math.round(pts[pts.length - 1].charged);

  return (
    <section className="card">
      <div className="card-top">
        <h2 className="card-h">Total Energy</h2>
        <button className="go-btn">↗</button>
      </div>
      <div className="te-num">{soc}%</div>
      <div className="te-date">{dateLabel}</div>

      <div className="te-chart">
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
          <defs>
            <linearGradient id="teFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="var(--orange)" stopOpacity="0.25" />
              <stop offset="1" stopColor="var(--orange)" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={area} fill="url(#teFill)" />
          <path d={line} fill="none" stroke="var(--orange)" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
          <circle cx={lx} cy={ly} r="3.5" fill="var(--orange)" />
        </svg>
        <div className="te-tip" style={{ left: `${(lx / W) * 100}%`, top: `${(ly / H) * 100}%` }}>
          {latest} kW
        </div>
      </div>
    </section>
  );
}
