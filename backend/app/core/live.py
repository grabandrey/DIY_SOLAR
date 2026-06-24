"""Live aggregate stats across all currently-online devices.

Sums the per-device values that :mod:`app.core.metrics` already precomputed into each
reading payload, so the clients fetch one ready-to-render totals object instead of
re-deriving anything from raw readings. Inverter quantities (solar/load/grid) sum over
online inverters; battery quantities sum over online BMS units; SOC is averaged.
"""

from __future__ import annotations

from typing import Any, Dict, List


def aggregate(readings: List[Dict[str, Any]]) -> Dict[str, Any]:
    online = [r for r in readings if r.get("online")]

    solar_w = load_w = grid_w = 0.0
    battery_w = battery_a = 0.0
    soc_total = 0.0
    inverter_count = 0
    battery_count = 0

    for reading in online:
        d = reading.get("derived") or {}
        if d.get("is_bms"):
            battery_count += 1
            battery_w += float(d.get("battery_w", 0.0))
            battery_a += float(d.get("battery_a", 0.0))
            soc_total += float(d.get("battery_soc", 0.0))
        else:
            inverter_count += 1
            solar_w += float(d.get("solar_w", 0.0))
            load_w += float(d.get("load_w", 0.0))
            grid_w += float(d.get("grid_w", 0.0))

    return {
        "solar_w": round(solar_w, 1),
        "load_w": round(load_w, 1),
        "grid_w": round(grid_w, 1),
        "battery_w": round(battery_w, 1),
        "battery_a": round(battery_a, 2),
        "battery_soc": round(soc_total / battery_count, 1) if battery_count else 0.0,
        "inverter_count": inverter_count,
        "battery_count": battery_count,
    }
