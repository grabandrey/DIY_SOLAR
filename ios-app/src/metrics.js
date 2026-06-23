// Derive "charged" / "used" / capacity figures from a device reading, across both
// inverter and BMS metric shapes. Ported from the web frontend so the numbers match.
export function chargePower(r) {
  const m = r.metrics || {};
  if (r.kind === "bms") {
    const p = Number(m.power?.value) || 0; // BMS power: + = charging
    return p > 0 ? p : 0;
  }
  return (
    Number(m.pv_input_power?.value) ||
    Number(m.battery_ac_charge_power?.value) ||
    0
  );
}

export function usedPower(r) {
  const m = r.metrics || {};
  if (r.kind === "bms") return 0;
  return Number(m.ac_output_active_power?.value) || 0;
}

export function gridPower(r) {
  const m = r.metrics || {};
  return (
    Number(m.grid_power?.value) ||
    Number(m.ac_input_active_power?.value) ||
    0
  );
}

export function capacity(r, deviceLabel = "device") {
  const m = r.metrics || {};
  const ah = m.nominal_capacity?.value;
  if (ah != null) return `${Math.round(ah)} Ah`;
  const soc = m.soc?.value ?? m.battery_capacity?.value;
  if (soc != null) return `${Math.round(soc)}% SOC`;
  return r.kind || deviceLabel;
}

export function batteryVoltage(r) {
  const m = r.metrics || {};
  return Number(m.pack_voltage?.value ?? m.battery_voltage?.value) || 0;
}

export function batteryPower(r) {
  const m = r.metrics || {};
  const direct = m.power?.value ?? m.battery_power?.value;
  if (direct != null) return Number(direct) || 0;
  return batteryVoltage(r) * batteryCurrent(r);
}

export function batteryCurrent(r) {
  const m = r.metrics || {};
  const direct = m.pack_current?.value ?? m.battery_current?.value;
  if (direct != null) return Number(direct) || 0;
  const charge = Number(m.battery_charge_current?.value) || 0;
  const discharge = Number(m.battery_discharge_current?.value) || 0;
  return charge - discharge;
}

export function sumBy(readings, fn) {
  return readings.filter((r) => r.online).reduce((a, r) => a + fn(r), 0);
}

export function avgSoc(readings) {
  const socs = readings
    .filter((r) => r.online)
    .map((r) => r.metrics?.soc?.value ?? r.metrics?.battery_capacity?.value)
    .filter((v) => v != null)
    .map(Number);
  if (!socs.length) return 0;
  return Math.round(socs.reduce((a, b) => a + b, 0) / socs.length);
}

export const kw = (w) => (w / 1000).toFixed(2);
