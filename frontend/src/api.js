// Live data hook: opens a WebSocket to the backend and keeps a map of the latest
// reading per device. Auto-reconnects so the dashboard recovers from drops.
import { useEffect, useRef, useState } from "react";

// --- REST helpers (device discovery & configuration) ---
async function req(path, options) {
  const res = await fetch(`/api${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    throw new Error(detail.detail || `${res.status} ${res.statusText}`);
  }
  return res.status === 204 ? null : res.json();
}

export const api = {
  scanPorts: () => req("/ports").then((d) => d.ports),
  getBridges: () => req("/bridge").then((d) => d.bridges),
  getDrivers: () => req("/drivers").then((d) => d.drivers),
  getDevices: () => req("/devices").then((d) => d.devices),
  addDevice: (cfg) => req("/devices", { method: "POST", body: JSON.stringify(cfg) }),
  updateDevice: (id, patch) =>
    req(`/devices/${id}`, { method: "PUT", body: JSON.stringify(patch) }),
  removeDevice: (id) => req(`/devices/${id}`, { method: "DELETE" }),
};

function wsUrl() {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}/ws`;
}

export function useReadings() {
  const [readings, setReadings] = useState({});
  const [connected, setConnected] = useState(false);
  const wsRef = useRef(null);

  useEffect(() => {
    let closed = false;
    let retry;

    function connect() {
      const ws = new WebSocket(wsUrl());
      wsRef.current = ws;

      ws.onopen = () => setConnected(true);
      ws.onmessage = (event) => {
        const reading = JSON.parse(event.data);
        setReadings((prev) => ({ ...prev, [reading.device_id]: reading }));
      };
      ws.onclose = () => {
        setConnected(false);
        if (!closed) retry = setTimeout(connect, 2000);
      };
      ws.onerror = () => ws.close();
    }

    connect();
    return () => {
      closed = true;
      clearTimeout(retry);
      wsRef.current?.close();
    };
  }, []);

  return { readings: Object.values(readings), connected };
}
