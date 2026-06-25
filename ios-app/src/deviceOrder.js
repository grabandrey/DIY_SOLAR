import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

// User-defined device ordering, stored ONLY on this device (AsyncStorage) — never sent to
// the backend. A single flat list of device_ids in the user's preferred order; each
// category (inverters / batteries) is sorted by each device's position in this list.
const KEY = "sa.deviceOrder";
const Ctx = createContext(null);

export function DeviceOrderProvider({ children }) {
  const [order, setOrderState] = useState([]);

  useEffect(() => {
    AsyncStorage.getItem(KEY)
      .then((raw) => {
        if (!raw) return;
        try {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) setOrderState(parsed);
        } catch {}
      })
      .catch(() => {});
  }, []);

  // Save the new order for one category's ids while preserving every other id's relative
  // order, so reordering inverters never disturbs the batteries (and vice versa).
  const setOrder = useCallback((categoryIds) => {
    setOrderState((prev) => {
      const others = prev.filter((id) => !categoryIds.includes(id));
      const next = [...categoryIds, ...others];
      AsyncStorage.setItem(KEY, JSON.stringify(next)).catch(() => {});
      return next;
    });
  }, []);

  const value = useMemo(() => ({ order, setOrder }), [order, setOrder]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useDeviceOrder() {
  const value = useContext(Ctx);
  if (!value) throw new Error("useDeviceOrder must be used within DeviceOrderProvider");
  return value;
}

// Sort readings by the user's order (unordered devices fall back to alphabetical by name).
export function orderReadings(order, readings) {
  const rank = (id) => {
    const i = order.indexOf(id);
    return i < 0 ? Number.POSITIVE_INFINITY : i;
  };
  return [...readings].sort((a, b) => {
    const ra = rank(a.device_id);
    const rb = rank(b.device_id);
    if (ra !== rb) return ra - rb; // both-unranked are equal here, so fall through
    return (a.device_name || a.device_id).localeCompare(b.device_name || b.device_id);
  });
}
