import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

// Per-device display-name overrides, stored ONLY on this device (AsyncStorage). They are
// never sent to the backend — purely a local label, keyed by the reading's device_id.
const KEY = "sa.deviceNames";
const Ctx = createContext(null);

export function DeviceNamesProvider({ children }) {
  const [names, setNames] = useState({});

  useEffect(() => {
    AsyncStorage.getItem(KEY)
      .then((raw) => {
        if (!raw) return;
        try {
          const parsed = JSON.parse(raw);
          if (parsed && typeof parsed === "object") setNames(parsed);
        } catch {}
      })
      .catch(() => {});
  }, []);

  const setName = useCallback((id, name) => {
    if (!id) return;
    setNames((prev) => {
      const next = { ...prev };
      const trimmed = (name || "").trim();
      if (trimmed) next[id] = trimmed;
      else delete next[id]; // clearing reverts to the backend's name
      AsyncStorage.setItem(KEY, JSON.stringify(next)).catch(() => {});
      return next;
    });
  }, []);

  const value = useMemo(() => ({ names, setName }), [names, setName]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useDeviceNames() {
  const value = useContext(Ctx);
  if (!value) throw new Error("useDeviceNames must be used within DeviceNamesProvider");
  return value;
}

// Resolve a device's display name: local override first, then the backend-provided name.
export function resolveDeviceName(names, reading) {
  if (!reading) return "";
  return names?.[reading.device_id] || reading.device_name || reading.device_id;
}
