import React from "react";

const TABS = [
  { key: "dashboard", label: "Overview" },
  { key: "devices", label: "Monitoring" },
  { key: "analytics", label: "Analytics" },
  { key: "energy", label: "Energy" },
];

export default function TopNav({ active = "dashboard", onNavigate, onSettings, connected }) {
  return (
    <header className="topnav">
      <div className="brand">
        <span className="brand-mark">☀</span>
        SUN<span className="brand-x">X</span>SOLAR
      </div>

      <nav className="nav-tabs">
        {TABS.map((t) => (
          <button
            key={t.key}
            className={`nav-tab ${t.key === active ? "active" : ""}`}
            onClick={() => onNavigate?.(t.key)}
          >
            {t.label}
          </button>
        ))}
      </nav>

      <div className="nav-actions">
        <button className="icon-circle" title="Notifications">
          🔔<span className="dot-badge" />
        </button>
        <button className="icon-circle" title="Settings / Devices" onClick={onSettings}>
          ⚙
        </button>
        <span
          className={`conn-dot ${connected ? "up" : "down"}`}
          title={connected ? "Live" : "Reconnecting…"}
        />
        <div className="avatar" title="Account" />
      </div>
    </header>
  );
}
