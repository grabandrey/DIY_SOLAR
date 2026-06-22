import React, { useState } from "react";
import { useReadings, useDiscovery, useTimeSeries } from "./api.js";
import { chargePower, usedPower, sumBy } from "./metrics.js";

// Merge live readings with the persistent configured-device list so attached devices always
// show (even before their first reading), instead of popping in/out on page refresh.
function mergeDevices(readings, configured) {
  const byId = new Map(readings.map((r) => [r.device_id, r]));
  const merged = [...readings];
  for (const d of configured) {
    if (d.enabled === false || byId.has(d.id)) continue;
    merged.push({
      device_id: d.id,
      device_name: d.name || d.id,
      kind: d.kind || (String(d.driver).startsWith("jk") ? "bms" : "inverter"),
      online: false,
      pending: true,
      metrics: {},
    });
  }
  return merged;
}
import Sidebar from "./components/Sidebar.jsx";
import Overview from "./components/Overview.jsx";
import ReportCard from "./components/ReportCard.jsx";
import WeeklyPerformance from "./components/WeeklyPerformance.jsx";
import DeviceMonitoring from "./components/DeviceMonitoring.jsx";
import DeviceDetail from "./components/DeviceDetail.jsx";
import SettingsPanel from "./components/SettingsPanel.jsx";

const FILTERS = {
  all: () => true,
  online: (r) => r.online,
  inverter: (r) => r.kind === "inverter",
  bms: (r) => r.kind === "bms",
};

export default function App() {
  const { readings, connected } = useReadings();
  const { devices: configured } = useDiscovery();
  const [showSettings, setShowSettings] = useState(false);
  const [nav, setNav] = useState("dashboard"); // dashboard | devices
  const [selectedId, setSelectedId] = useState(null);
  const [filter, setFilter] = useState("all");
  const [points, setPoints] = useState(16);

  const merged = mergeDevices(readings, configured);
  const sorted = merged.sort((a, b) => a.device_id.localeCompare(b.device_id));
  const filtered = sorted.filter(FILTERS[filter]);

  const series = useTimeSeries(
    () => ({
      charged: Math.round(sumBy(filtered, chargePower)),
      used: Math.round(sumBy(filtered, usedPower)),
    }),
    { maxPoints: points }
  );

  const openDevice = (id) => { setSelectedId(id); setNav("device"); };
  const backToDashboard = () => { setSelectedId(null); setNav("dashboard"); };

  return (
    <div className="layout">
      <Sidebar
        active={nav === "device" ? "devices" : nav}
        onNavigate={(k) => { setSelectedId(null); setNav(k); }}
        onSettings={() => setShowSettings(true)}
      />

      {showSettings && <SettingsPanel onClose={() => setShowSettings(false)} />}

      <div className="main">
        <header className="page-header">
          <h1 className="page-title">
            {nav === "device" ? "Device" : nav === "devices" ? "Devices" : "Dashboard"}
          </h1>
          <div className="search">
            <span className="search-icon">⌕</span>
            <input placeholder="Search…" />
          </div>
          <div className="header-actions">
            <select className="pill pill-select" value={points} onChange={(e) => setPoints(Number(e.target.value))} title="Chart window">
              <option value={12}>Live · 12</option>
              <option value={16}>Live · 16</option>
              <option value={24}>Live · 24</option>
            </select>
            <select className="pill pill-select" value={filter} onChange={(e) => setFilter(e.target.value)} title="Filter devices">
              <option value="all">All devices</option>
              <option value="online">Online only</option>
              <option value="inverter">Inverters</option>
              <option value="bms">Batteries</option>
            </select>
            <span className={`conn-dot ${connected ? "up" : "down"}`} title={connected ? "Live" : "Reconnecting…"} />
          </div>
        </header>

        <div className="content">
          {nav === "device" ? (
            <DeviceDetail
              reading={sorted.find((r) => r.device_id === selectedId)}
              onBack={backToDashboard}
            />
          ) : nav === "devices" ? (
            <DeviceMonitoring readings={filtered} onManage={() => setShowSettings(true)} onSelect={openDevice} />
          ) : (
            <>
              <div className="row row-top">
                <Overview readings={filtered} series={series} />
                <ReportCard readings={filtered} onOpen={() => setShowSettings(true)} />
              </div>
              <div className="row row-bottom">
                <WeeklyPerformance series={series} />
                <DeviceMonitoring readings={filtered} onManage={() => setShowSettings(true)} onSelect={openDevice} />
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
