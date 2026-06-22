import React, { useState } from "react";
import { useReadings } from "./api.js";
import DeviceCard from "./components/DeviceCard.jsx";
import SummaryBar from "./components/SummaryBar.jsx";
import SettingsPanel from "./components/SettingsPanel.jsx";

export default function App() {
  const { readings, connected } = useReadings();
  const [showSettings, setShowSettings] = useState(false);
  const sorted = [...readings].sort((a, b) => a.device_id.localeCompare(b.device_id));

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo">☀</span>
          <h1>Solar Assistant</h1>
        </div>
        <div className="topbar-right">
          <span className={`conn ${connected ? "up" : "down"}`}>
            {connected ? "Live" : "Reconnecting…"}
          </span>
          <button className="settings-btn" onClick={() => setShowSettings(true)}>
            ⚙ Devices
          </button>
        </div>
      </header>

      {showSettings && <SettingsPanel onClose={() => setShowSettings(false)} />}

      <SummaryBar readings={sorted} />

      <main className="grid">
        {sorted.length === 0 && (
          <div className="empty">
            No device data yet. Click <strong>⚙ Devices</strong> to scan for a USB
            inverter and attach it.
          </div>
        )}
        {sorted.map((reading) => (
          <DeviceCard key={reading.device_id} reading={reading} />
        ))}
      </main>
    </div>
  );
}
