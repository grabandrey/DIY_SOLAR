import React, { useState } from "react";
import { useReadings, useDiscovery, useTimeSeries } from "./api.js";
import { chargePower, usedPower, sumBy, avgSoc } from "./metrics.js";

import TopNav from "./components/TopNav.jsx";
import Hero from "./components/Hero.jsx";
import CurrentPower from "./components/CurrentPower.jsx";
import EnergyBalance from "./components/EnergyBalance.jsx";
import MiniStat from "./components/MiniStat.jsx";
import TotalEnergyChart from "./components/TotalEnergyChart.jsx";
import DeviceMonitoring from "./components/DeviceMonitoring.jsx";
import DeviceDetail from "./components/DeviceDetail.jsx";
import SettingsPanel from "./components/SettingsPanel.jsx";

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

// Rolling 5-day window ending today, e.g. "20 – 24 Mar 2026".
function rangeLabel() {
  const end = new Date();
  const start = new Date(end);
  start.setDate(end.getDate() - 4);
  const mon = end.toLocaleString("en", { month: "short" });
  return `${start.getDate()} – ${end.getDate()} ${mon} ${end.getFullYear()}`;
}
const dayLabel = () => {
  const d = new Date();
  const n = d.getDate();
  const suf = n % 10 === 1 && n !== 11 ? "st" : n % 10 === 2 && n !== 12 ? "nd" : n % 10 === 3 && n !== 13 ? "rd" : "th";
  return `${d.toLocaleString("en", { month: "long" })} ${n}${suf}`;
};

export default function App() {
  const { readings, connected } = useReadings();
  const { devices: configured } = useDiscovery();
  const [showSettings, setShowSettings] = useState(false);
  const [view, setView] = useState("dashboard"); // dashboard | devices | device
  const [tab, setTab] = useState("dashboard");
  const [selectedId, setSelectedId] = useState(null);

  const merged = mergeDevices(readings, configured);
  const sorted = merged.sort((a, b) => a.device_id.localeCompare(b.device_id));

  const series = useTimeSeries(
    () => ({
      charged: Math.round(sumBy(sorted, chargePower)),
      used: Math.round(sumBy(sorted, usedPower)),
    }),
    { maxPoints: 24 }
  );

  const soc = avgSoc(sorted);
  const chargedKwh = sumBy(sorted, chargePower) / 1000;
  const co2 = (chargedKwh * 1.16).toFixed(3);      // ~kg CO₂ per kWh, shown as "km" saved
  const earning = (chargedKwh * 7.8).toFixed(2);   // AUD feed-in estimate

  const navigate = (key) => {
    setSelectedId(null);
    setTab(key);
    setView(key === "devices" ? "devices" : "dashboard");
  };
  const openDevice = (id) => { setSelectedId(id); setView("device"); };
  const backToDashboard = () => { setSelectedId(null); setView("dashboard"); setTab("dashboard"); };

  return (
    <div className="app">
      <TopNav
        active={view === "device" ? "devices" : tab}
        onNavigate={navigate}
        onSettings={() => setShowSettings(true)}
        connected={connected}
      />

      {showSettings && <SettingsPanel onClose={() => setShowSettings(false)} />}

      {view === "device" ? (
        <div className="view-card">
          <DeviceDetail
            reading={sorted.find((r) => r.device_id === selectedId)}
            onBack={backToDashboard}
          />
        </div>
      ) : view === "devices" ? (
        <div className="view-card">
          <DeviceMonitoring
            readings={sorted}
            onManage={() => setShowSettings(true)}
            onSelect={openDevice}
          />
        </div>
      ) : (
        <>
          <Hero soc={soc} dateLabel={rangeLabel()} />
          <div className="grid">
            <CurrentPower readings={sorted} series={series} onOpen={() => navigate("devices")} />
            <EnergyBalance readings={sorted} />
            <div className="stack">
              <MiniStat
                title="CO₂ Savings Total"
                icon="🌿" iconClass=""
                value={co2} unit=" km" date={dayLabel()}
              />
              <MiniStat
                title="Earning"
                icon="⛽" iconClass="yellow"
                value={earning} unit=" AUD" date={dayLabel()}
              />
            </div>
            <TotalEnergyChart series={series} soc={soc} dateLabel={dayLabel()} />
          </div>
        </>
      )}
    </div>
  );
}
