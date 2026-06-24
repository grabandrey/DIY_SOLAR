// Selectable device photos, discovered automatically from assets/devices at bundle
// time. React Native needs static asset references, so we use Metro's require.context
// (enabled by default in Expo) to enumerate the folder instead of hand-listing files —
// drop a new image into assets/devices and it shows up in the picker with no code change.
//
// Each image is referenced by a stable key (its filename without extension), which is
// what gets stored on the device config (cfg.image) and resolved here for display.
const context = require.context("../assets/devices", false, /\.(png|jpe?g|webp)$/);

const keyFromPath = (path) =>
  path.replace(/^.*[\\/]/, "").replace(/\.(png|jpe?g|webp)$/i, "");

const labelFromKey = (key) =>
  key.charAt(0).toUpperCase() + key.slice(1).replace(/[-_]+/g, " ");

export const DEVICE_IMAGES = {};
export const DEVICE_IMAGE_OPTIONS = [];

for (const path of context.keys().sort()) {
  const key = keyFromPath(path);
  DEVICE_IMAGES[key] = context(path);
  DEVICE_IMAGE_OPTIONS.push({ key, label: labelFromKey(key) });
}

export function deviceImageSource(key) {
  return key ? DEVICE_IMAGES[key] : undefined;
}
