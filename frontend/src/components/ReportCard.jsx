import React from "react";

// The design's "Report" card, repurposed as live system health from device online state.
export default function ReportCard({ readings, onOpen }) {
  const total = readings.length;
  const online = readings.filter((r) => r.online).length;
  const offline = total - online;

  return (
    <section className="card report">
      <div className="report-head">
        <h2 className="card-title">System</h2>
        {offline > 0 && (
          <span className="badge-alert">! {offline} offline</span>
        )}
      </div>
      <div className="report-body">
        <div className="report-stats">
          <div>
            <div className="ov-label">Devices</div>
            <div className="report-num">{total}</div>
          </div>
          <div>
            <div className="ov-label">Online</div>
            <div className="report-num">{online}</div>
          </div>
          <div>
            <div className="ov-label">Offline</div>
            <div className="report-num">{offline}</div>
          </div>
        </div>
        <div className="report-art" aria-hidden="true">
          <div className="report-glyph">⚡</div>
          <button className="round-btn" onClick={onOpen} title="Manage devices">↗</button>
        </div>
      </div>
    </section>
  );
}
