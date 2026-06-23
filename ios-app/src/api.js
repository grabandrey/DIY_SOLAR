// Backend connection layer for the mobile app: a configurable base URL (persisted to
// device storage) plus REST helpers and live WebSocket hooks mirroring the web frontend.
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

// Sensible default for development — the Mac's LAN IP. Editable in Settings.
export const DEFAULT_BASE_URL = "http://192.168.0.13:8000";
const STORE_KEY = "sa.baseUrl";

const BackendCtx = createContext(null);

export function BackendProvider({ children }) {
  const [baseUrl, setBaseUrlState] = useState(DEFAULT_BASE_URL);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(STORE_KEY)
      .then((v) => v && setBaseUrlState(v))
      .finally(() => setLoaded(true));
  }, []);

  const setBaseUrl = useCallback((url) => {
    const clean = (url || "").trim().replace(/\/+$/, "");
    setBaseUrlState(clean);
    AsyncStorage.setItem(STORE_KEY, clean).catch(() => {});
  }, []);

  return (
    <BackendCtx.Provider value={{ baseUrl, setBaseUrl, loaded }}>
      {children}
    </BackendCtx.Provider>
  );
}

export function useBackend() {
  const ctx = useContext(BackendCtx);
  if (!ctx) throw new Error("useBackend must be used within BackendProvider");
  return ctx;
}

// --- REST helpers ---------------------------------------------------------
async function req(base, path, options) {
  const res = await fetch(`${base}/api${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    throw new Error(detail.detail || `${res.status} ${res.statusText}`);
  }
  return res.status === 204 ? null : res.json();
}

export function useApi() {
  const { baseUrl } = useBackend();
  return {
    health: () => req(baseUrl, "/health"),
    scanPorts: () => req(baseUrl, "/ports").then((d) => d.ports),
    getBridges: () => req(baseUrl, "/bridge").then((d) => d.bridges),
    getDrivers: () => req(baseUrl, "/drivers").then((d) => d.drivers),
    getDevices: () => req(baseUrl, "/devices").then((d) => d.devices),
    getDailyEnergy: (date) =>
      req(baseUrl, `/energy/daily${date ? `?date=${encodeURIComponent(date)}` : ""}`),
    addDevice: (cfg) =>
      req(baseUrl, "/devices", { method: "POST", body: JSON.stringify(cfg) }),
    updateDevice: (id, patch) =>
      req(baseUrl, `/devices/${id}`, { method: "PUT", body: JSON.stringify(patch) }),
    removeDevice: (id) => req(baseUrl, `/devices/${id}`, { method: "DELETE" }),
  };
}

// http(s)://host:port  ->  ws(s)://host:port/path
function wsUrl(base, path) {
  return base.replace(/^http/, "ws") + path;
}

// Live readings: one WebSocket, latest snapshot per device, auto-reconnecting.
export function useReadings() {
  const { baseUrl } = useBackend();
  const [map, setMap] = useState({});
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    setMap({});
    let closed = false;
    let retry;
    let ws;

    function connect() {
      try {
        ws = new WebSocket(wsUrl(baseUrl, "/ws"));
      } catch {
        retry = setTimeout(connect, 2500);
        return;
      }
      ws.onopen = () => setConnected(true);
      ws.onmessage = (e) => {
        const r = JSON.parse(e.data);
        setMap((prev) => ({ ...prev, [r.device_id]: r }));
      };
      ws.onclose = () => {
        setConnected(false);
        if (!closed) retry = setTimeout(connect, 2500);
      };
      // React Native follows a socket failure with a close event and native cleanup.
      // Closing again here can produce a second `websocketClosed` event during reload.
      ws.onerror = () => {};
    }

    connect();
    return () => {
      closed = true;
      clearTimeout(retry);
      ws?.close();
    };
  }, [baseUrl]);

  return { readings: Object.values(map), connected };
}

// Live discovery feed: ports + configured devices + bridges.
export function useDiscovery(active = true) {
  const { baseUrl } = useBackend();
  const [data, setData] = useState({ ports: [], devices: [], bridges: [] });
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (!active) return undefined;
    let closed = false;
    let retry;
    let ws;

    function connect() {
      try {
        ws = new WebSocket(wsUrl(baseUrl, "/ws/discovery"));
      } catch {
        retry = setTimeout(connect, 2500);
        return;
      }
      ws.onopen = () => setConnected(true);
      ws.onmessage = (e) => setData(JSON.parse(e.data));
      ws.onclose = () => {
        setConnected(false);
        if (!closed) retry = setTimeout(connect, 2500);
      };
      // React Native follows a socket failure with a close event and native cleanup.
      // Closing again here can produce a second `websocketClosed` event during reload.
      ws.onerror = () => {};
    }

    connect();
    return () => {
      closed = true;
      clearTimeout(retry);
      ws?.close();
    };
  }, [baseUrl, active]);

  return { ...data, connected };
}

// Accumulate a rolling in-session time-series by sampling on an interval.
export function useTimeSeries(sample, { intervalMs = 2000, maxPoints = 24 } = {}) {
  const [series, setSeries] = useState([]);
  const ref = useRef(sample);
  ref.current = sample;
  useEffect(() => {
    const tick = () => {
      const v = ref.current?.();
      if (!v) return;
      setSeries((s) => [...s, { t: Date.now(), ...v }].slice(-maxPoints));
    };
    tick();
    const id = setInterval(tick, intervalMs);
    return () => clearInterval(id);
  }, [intervalMs, maxPoints]);
  return series;
}

export function useDailyEnergy(intervalMs = 10000) {
  const { baseUrl } = useBackend();
  const [daily, setDaily] = useState({
    date: null,
    solar_kwh: 0,
    consumption_kwh: 0,
    devices: [],
  });

  useEffect(() => {
    let active = true;

    const load = () => {
      req(baseUrl, "/energy/daily")
        .then((value) => active && setDaily(value))
        .catch(() => {});
    };

    load();
    const id = setInterval(load, intervalMs);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, [baseUrl, intervalMs]);

  return daily;
}
