import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

// Per-device icon (the chosen device photo) AND its display style, stored ONLY on this
// device (AsyncStorage), keyed by the reading's device_id — never sent to the backend. The
// icon and style are picked from the device page (DeviceDetail); Settings just shows a
// generic placeholder. Mirrors the deviceNames store (local-only, keyed by device_id).
const ICONS_KEY = "sa.deviceIcons";
const STYLES_KEY = "sa.deviceIconStyles";
const Ctx = createContext(null);

// Battery icon display style. "vertical" renders the photo at the same size as an inverter's;
// "horizontal" renders it much smaller. Default is vertical.
export const DEFAULT_ICON_STYLE = "vertical";

function loadMap(key, apply) {
  AsyncStorage.getItem(key)
    .then((raw) => {
      if (!raw) return;
      try {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object") apply(parsed);
      } catch {}
    })
    .catch(() => {});
}

export function DeviceIconsProvider({ children }) {
  const [icons, setIcons] = useState({});
  const [iconStyles, setIconStyles] = useState({});

  useEffect(() => {
    loadMap(ICONS_KEY, setIcons);
    loadMap(STYLES_KEY, setIconStyles);
  }, []);

  const setIcon = useCallback((id, icon) => {
    if (!id) return;
    setIcons((prev) => {
      const next = { ...prev };
      if (icon) next[id] = icon;
      else delete next[id]; // clearing reverts to the generic / fallback icon
      AsyncStorage.setItem(ICONS_KEY, JSON.stringify(next)).catch(() => {});
      return next;
    });
  }, []);

  const setIconStyle = useCallback((id, style) => {
    if (!id) return;
    setIconStyles((prev) => {
      const next = { ...prev };
      // Persist the explicit choice — including "vertical". A daisy-chained unit (id
      // "<masterId>:<n>") otherwise inherits its master's style, so if we dropped the
      // default we could never set a sub-unit back to vertical once the master was set to
      // horizontal: deleting its key would just re-inherit the master. Storing the exact
      // value lets every unit be set independently. A falsy value clears the override.
      if (style) next[id] = style;
      else delete next[id];
      AsyncStorage.setItem(STYLES_KEY, JSON.stringify(next)).catch(() => {});
      return next;
    });
  }, []);

  const value = useMemo(
    () => ({ icons, setIcon, iconStyles, setIconStyle }),
    [icons, setIcon, iconStyles, setIconStyle]
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useDeviceIcons() {
  const value = useContext(Ctx);
  if (!value) throw new Error("useDeviceIcons must be used within DeviceIconsProvider");
  return value;
}

// Resolve a device's icon key: the local override for the exact unit first, then its master
// (daisy-chained units like "<masterId>:<n>" share the master's icon), then the optional
// fallback (e.g. a legacy backend-configured image).
export function resolveDeviceIcon(icons, id, fallback) {
  if (!id) return fallback;
  const masterId = String(id).split(":")[0];
  return icons?.[id] ?? icons?.[masterId] ?? fallback;
}

// Resolve a device's icon style ("vertical" | "horizontal"), exact unit first, then master,
// then the default. Daisy-chained units share the master's style.
export function resolveDeviceIconStyle(iconStyles, id) {
  if (!id) return DEFAULT_ICON_STYLE;
  const masterId = String(id).split(":")[0];
  return iconStyles?.[id] ?? iconStyles?.[masterId] ?? DEFAULT_ICON_STYLE;
}
