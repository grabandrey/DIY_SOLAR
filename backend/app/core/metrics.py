"""Canonical derivation of per-device stat values.

This is the single source of truth for every "what does this reading mean" number the
UI shows (live solar / load / grid power, battery voltage / current / power / SOC).
The energy integrator and the live API both derive from here, and the values are
precomputed into each reading payload (see :mod:`app.core.bus`) so the mobile/web
clients never re-derive anything — they only render what the backend already computed.
"""

from __future__ import annotations

from typing import Any, Dict

from ..devices.base import Reading


def metric_value(reading: Reading, *keys: str) -> float:
    """First parsable metric among ``keys`` as a float, else ``0.0``."""
    for key in keys:
        metric = reading.metrics.get(key)
        if metric is not None:
            try:
                return float(metric.value)
            except (TypeError, ValueError):
                continue
    return 0.0


def _is_bms(reading: Reading) -> bool:
    return reading.kind.value == "bms"


def solar_power(reading: Reading) -> float:
    """Inverter PV production in watts (sum of all PV inputs). Zero for a BMS."""
    if _is_bms(reading):
        return 0.0
    solar = metric_value(reading, "pv_input_power") + metric_value(reading, "pv2_power")
    return max(solar, 0.0)


def load_power(reading: Reading) -> float:
    """Inverter AC output (consumption) in watts. Zero for a BMS."""
    if _is_bms(reading):
        return 0.0
    load = metric_value(reading, "ac_output_active_power", "total_ac_output_active_power")
    return max(load, 0.0)


def grid_power(reading: Reading) -> float:
    if _is_bms(reading):
        return 0.0
    return metric_value(reading, "grid_power", "ac_input_active_power")


def battery_voltage(reading: Reading) -> float:
    return metric_value(reading, "pack_voltage", "battery_voltage")


def battery_current(reading: Reading) -> float:
    """Battery current (+ charging, - discharging)."""
    direct = metric_value(reading, "pack_current", "battery_current")
    if direct:
        return direct
    charge = metric_value(reading, "battery_charge_current")
    discharge = metric_value(reading, "battery_discharge_current")
    return charge - discharge


def battery_power(reading: Reading) -> float:
    """Battery power in watts (+ charging, - discharging)."""
    direct = metric_value(reading, "power", "battery_power")
    if direct:
        return direct
    return battery_voltage(reading) * battery_current(reading)


def battery_soc(reading: Reading) -> float:
    return metric_value(reading, "soc", "battery_capacity")


def derived(reading: Reading) -> Dict[str, Any]:
    """Precomputed per-device values rendered directly by the clients."""
    bms = _is_bms(reading)
    return {
        "is_bms": bms,
        "solar_w": round(solar_power(reading), 1),
        "load_w": round(load_power(reading), 1),
        "grid_w": round(grid_power(reading), 1),
        "battery_v": round(battery_voltage(reading), 2),
        "battery_a": round(battery_current(reading), 2),
        "battery_w": round(battery_power(reading), 1),
        "battery_soc": round(battery_soc(reading), 1),
    }
