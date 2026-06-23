import React from "react";

// Compact metric card (CO₂ Savings, Earning).
export default function MiniStat({ title, icon, iconClass = "", value, unit, date }) {
  return (
    <section className="card mini">
      <div className="card-top">
        <h2 className="card-h">{title}</h2>
        <button className="go-btn">↗</button>
      </div>
      <div className="mini-body">
        <div className={`mini-icon ${iconClass}`}>{icon}</div>
        <div>
          <div className="mini-num">{value}<span className="u">{unit}</span></div>
          <div className="mini-date">{date}</div>
        </div>
      </div>
    </section>
  );
}
