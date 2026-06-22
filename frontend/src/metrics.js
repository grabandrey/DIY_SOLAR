// Derive the design's "charged" / "used" / "capacity" figures from a device reading,
// across both inverter and BMS metric shapes.
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
  if (r.kind === "bms") {
    const p = Number(m.power?.value) || 0;
    return p < 0 ? -p : 0;
  }
  return Number(m.ac_output_active_power?.value) || 0;
}

export function capacity(r) {
  const m = r.metrics || {};
  const ah = m.nominal_capacity?.value;
  if (ah != null) return `${Math.round(ah)} Ah`;
  const soc = m.soc?.value ?? m.battery_capacity?.value;
  if (soc != null) return `${Math.round(soc)}% SOC`;
  return r.kind;
}

export function sumBy(readings, fn) {
  return readings.filter((r) => r.online).reduce((a, r) => a + fn(r), 0);
}
