import React from "react";
import HouseArt from "./HouseArt.jsx";

// Hero banner: headline + house render, with the floating date range and battery
// ("Total Energy") cards overlapping the right edge.
export default function Hero({ soc, dateLabel }) {
  return (
    <section className="hero">
      <div className="hero-copy">
        <h1>
          <span className="accent">Here’s Your</span> Current<br />
          Energy Overview
        </h1>
        <p className="hero-sub">Your Current Sales Summary and Activity</p>
      </div>

      <div className="hero-art">
        <HouseArt />
      </div>

      <div className="hero-floats">
        <div className="date-pill">
          <span className="cal">🗓</span>
          {dateLabel}
          <span className="chev">⌄</span>
        </div>

        <div className="battery-card">
          <div className="battery-head">
            <h3>Total Energy</h3>
            <button className="go-btn">↗</button>
          </div>
          <div className="battery-sub">
            <span className="bolt">⚡</span> Charging · 4h 30m
          </div>
          <div className="battery-bar">
            <div className="battery-fill" style={{ width: `${Math.max(soc, 14)}%` }}>
              {soc}%
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
