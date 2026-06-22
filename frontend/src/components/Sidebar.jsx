import React from "react";

const NAV = [
  { key: "dashboard", label: "Dashboard", icon: "▦" },
  { key: "devices", label: "Devices", icon: "☀" },
];

export default function Sidebar({ active = "dashboard", onNavigate, onSettings }) {
  return (
    <aside className="sidebar">
      <div className="sidebar-logo">◣◢</div>
      <nav className="sidebar-nav">
        {NAV.map((n) => (
          <button
            key={n.key}
            className={`nav-item ${n.key === active ? "active" : ""}`}
            title={n.label}
            onClick={() => onNavigate?.(n.key)}
          >
            <span className="nav-icon">{n.icon}</span>
          </button>
        ))}
      </nav>
      <div className="sidebar-bottom">
        <button className="nav-item" title="Settings / Devices" onClick={onSettings}>
          <span className="nav-icon">⚙</span>
        </button>
        <div className="avatar" title="Account">
          <span className="avatar-dot" />
        </div>
      </div>
    </aside>
  );
}
