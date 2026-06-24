// Per-device stat accessors. The backend precomputes every value into each reading's
// `derived` block (see backend app/core/metrics.py), so the app never derives stats
// from raw metrics — it just reads what the backend already calculated. Live totals
// across devices come precomputed too, via the `useLive()` hook in api.js.
const d = (r) => r?.derived || {};

export function chargePower(r) {
  return Number(d(r).solar_w) || 0;
}

export function usedPower(r) {
  return Number(d(r).load_w) || 0;
}

export function gridPower(r) {
  return Number(d(r).grid_w) || 0;
}

export function batteryVoltage(r) {
  return Number(d(r).battery_v) || 0;
}

export function batteryCurrent(r) {
  return Number(d(r).battery_a) || 0;
}

export function batteryPower(r) {
  return Number(d(r).battery_w) || 0;
}

// Display label for a battery: capacity in Ah, else SOC %, else the device kind.
// Pure formatting (not a stat), so it reads the raw metrics directly.
export function capacity(r, deviceLabel = "device") {
  const m = r.metrics || {};
  const ah = m.nominal_capacity?.value;
  if (ah != null) return `${Math.round(ah)} Ah`;
  const soc = r?.derived?.battery_soc ?? m.soc?.value ?? m.battery_capacity?.value;
  if (soc != null) return `${Math.round(soc)}% SOC`;
  return r.kind || deviceLabel;
}

export const kw = (w) => (w / 1000).toFixed(2);
