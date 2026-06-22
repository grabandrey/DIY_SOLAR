"""Shared base for inverters that speak the Voltronic ASCII protocol.

Axpert King, Phocos and Growatt SPF (off-grid) all use the same QPIGS/QMOD command
set, so the polling + normalization lives here once. A concrete driver is usually just
a subclass with a docstring; override :attr:`COMMANDS` or :meth:`poll` only if a model
diverges.
"""

from __future__ import annotations

import logging
from typing import List

from ...protocols import voltronic
from ..base import Metric, Reading
from .base import InverterDevice

log = logging.getLogger(__name__)

# Highest QPGS<n> index probed when auto-detecting parallel units.
MAX_PARALLEL = 6

# key -> (human label, unit)
METRIC_META = {
    "grid_voltage": ("Grid voltage", "V"),
    "grid_frequency": ("Grid frequency", "Hz"),
    "ac_output_voltage": ("Output voltage", "V"),
    "ac_output_frequency": ("Output frequency", "Hz"),
    "ac_output_apparent_power": ("Output apparent power", "VA"),
    "ac_output_active_power": ("Output power", "W"),
    "output_load_percent": ("Load", "%"),
    "bus_voltage": ("Bus voltage", "V"),
    "battery_voltage": ("Battery voltage", "V"),
    "battery_charge_current": ("Battery charge current", "A"),
    "battery_discharge_current": ("Battery discharge current", "A"),
    "battery_capacity": ("Battery capacity", "%"),
    "inverter_temperature": ("Inverter temperature", "°C"),
    "pv_input_current": ("PV input current", "A"),
    "pv_input_voltage": ("PV input voltage", "V"),
    "pv_input_power": ("PV input power", "W"),
    "battery_voltage_scc": ("Battery voltage (SCC)", "V"),
    "total_charge_current": ("Total charging current", "A"),
    "total_ac_output_apparent_power": ("Total output apparent power", "VA"),
    "total_ac_output_active_power": ("Total output power", "W"),
    "total_output_load_percent": ("Total load", "%"),
    "pv_input_current": ("PV input current", "A"),
}


class VoltronicInverter(InverterDevice):
    async def poll(self) -> Reading:
        try:
            status = await self._command("QPIGS")
            metrics = voltronic.parse_qpigs(status)

            mode_body = await self._command("QMOD")
            mode = voltronic.parse_qmod(mode_body)

            reading = Reading(
                device_id=self.device_id,
                device_name=self.name,
                kind=self.kind,
                online=True,
                raw={"QPIGS": status, "QMOD": mode_body},
            )
            for key, value in metrics.items():
                label, unit = METRIC_META.get(key, (key, ""))
                reading.metrics[key] = Metric(value=round(value, 2), unit=unit, label=label)
            reading.metrics["mode"] = Metric(value=mode, unit="", label="Operating mode")
            return reading
        except Exception as exc:  # noqa: BLE001 - report any failure as offline
            log.warning("Poll failed for %s: %s", self.device_id, exc)
            return self._offline_reading(str(exc))

    async def _command(self, command: str) -> str:
        payload = voltronic.frame_command(command)
        raw = await self.transport.query(payload)
        return voltronic.parse_response(raw)

    # --- parallel support ----------------------------------------------------
    async def poll_many(self) -> List[Reading]:
        """Report each parallel-connected inverter separately via QPGS<n>.

        Falls back to the single-unit QPIGS reading when the inverter isn't in a parallel
        stack (the common case), which carries more fields than QPGS.
        """
        units = await self._enumerate_parallel()
        if len(units) < 2:
            return [await self.poll()]

        readings: List[Reading] = []
        for i, (n, body) in enumerate(units):
            _serial, mode, metrics = voltronic.parse_qpgs(body)
            # First unit keeps this device's id so its configured entry shows online.
            dev_id = self.device_id if i == 0 else f"{self.device_id}:{n}"
            reading = Reading(
                device_id=dev_id,
                device_name=f"{self.name} #{n + 1}",
                kind=self.kind,
                online=True,
                raw={f"QPGS{n}": body},
            )
            for key, value in metrics.items():
                label, unit = METRIC_META.get(key, (key, ""))
                reading.metrics[key] = Metric(value=round(value, 2), unit=unit, label=label)
            reading.metrics["mode"] = Metric(value=mode, unit="", label="Operating mode")
            readings.append(reading)
        return readings

    async def _enumerate_parallel(self):
        """Probe QPGS0..N and return [(index, body), ...] for the real units.

        A unit counts only if it reports a valid, not-yet-seen serial number — the
        field-0 'parallel valid' flag can read 1 for indices beyond the actual unit count
        (phantom units), so it can't be trusted. The whole range is scanned (no early break
        on a NAK) so a transient miss doesn't hide a unit. An optional ``units`` config
        option forces the count and skips this detection.
        """
        forced = self.options.get("units")
        if forced:
            units = []
            for n in range(int(forced)):
                try:
                    units.append((n, await self._command(f"QPGS{n}")))
                except Exception:
                    pass
            return units

        units = []
        seen_serials = set()
        for n in range(MAX_PARALLEL):
            try:
                body = await self._command(f"QPGS{n}")
            except Exception:  # NAK / no such unit
                continue
            serial, _mode, _metrics = voltronic.parse_qpgs(body)
            if voltronic.valid_serial(serial) and serial not in seen_serials:
                seen_serials.add(serial)
                units.append((n, body))
        return units
