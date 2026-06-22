import React from "react";

// Live dual-axis bar chart: charged (green, up) vs used (yellow, down). Built from the
// session's sampled series (no server-side history).
export default function WeeklyPerformance({ series }) {
  const W = 640;
  const H = 300;
  const mid = H / 2;
  const max = Math.max(100, ...series.map((p) => Math.max(p.charged, p.used)));
  const n = Math.max(series.length, 1);
  const step = W / Math.max(n, 8);
  const barW = Math.min(12, step * 0.4);
  const scale = (v) => (v / max) * (mid - 24);

  const latest = series[series.length - 1] || { charged: 0, used: 0 };
  const fmtTime = (t) =>
    new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  return (
    <section className="card perf">
      <div className="card-head-row">
        <h2 className="card-title">Live Performance</h2>
        <span className="pill muted-pill">⟳ this session</span>
      </div>

      <div className="perf-legend">
        <div>
          <span className="dot green" /> Power Charged
          <div className="perf-num">{Math.round(latest.charged).toLocaleString()}</div>
        </div>
        <div className="perf-sep" />
        <div>
          <span className="dot yellow" /> Power Used
          <div className="perf-num">{Math.round(latest.used).toLocaleString()}</div>
        </div>
      </div>

      {series.length === 0 ? (
        <div className="perf-empty">Collecting live data…</div>
      ) : (
        <svg viewBox={`0 0 ${W} ${H}`} className="perf-chart" preserveAspectRatio="none">
          <line x1="0" y1={mid} x2={W} y2={mid} stroke="#e2e8f0" strokeWidth="1" />
          {series.map((p, i) => {
            const x = i * step + step / 2;
            return (
              <g key={p.t}>
                <rect
                  x={x - barW / 2}
                  y={mid - scale(p.charged)}
                  width={barW}
                  height={scale(p.charged)}
                  rx={barW / 2}
                  fill="#22c55e"
                />
                <rect
                  x={x - barW / 2}
                  y={mid}
                  width={barW}
                  height={scale(p.used)}
                  rx={barW / 2}
                  fill="#facc15"
                />
              </g>
            );
          })}
        </svg>
      )}

      {series.length > 0 && (
        <div className="perf-axis">
          {series.map((p) => (
            <span key={p.t}>{fmtTime(p.t)}</span>
          ))}
        </div>
      )}
    </section>
  );
}
