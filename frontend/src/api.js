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

function wsUrl(path = "/ws") {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}${path}`;
}

// Live discovery feed: ports, configured devices, and connected bridges, pushed by the
// backend over a WebSocket so the Devices panel refreshes itself without polling.
export function useDiscovery(active = true) {
  const [data, setData] = useState({ ports: [], devices: [], bridges: [] });
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (!active) return undefined;
    let closed = false;
    let retry;
    let ws;

    function connect() {
      ws = new WebSocket(wsUrl("/ws/discovery"));
      ws.onopen = () => setConnected(true);
      ws.onmessage = (event) => setData(JSON.parse(event.data));
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
      ws?.close();
    };
  }, [active]);

  return { ...data, connected };
}

export function useReadings() {
  const [readings, setReadings] = useState({});
  const [connected, setConnected] = useState(false);
  const wsRef = useRef(null);

  useEffect(() => {
    let closed = false;
    let retry;

    function connect() {
      const ws = new WebSocket(wsUrl("/ws"));
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
