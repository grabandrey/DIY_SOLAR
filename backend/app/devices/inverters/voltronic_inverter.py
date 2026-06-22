"""Shared base for inverters that speak the Voltronic ASCII protocol.

Axpert King, Phocos and Growatt SPF (off-grid) all use the same QPIGS/QMOD command
set, so the polling + normalization lives here once. A concrete driver is usually just
a subclass with a docstring; override :attr:`COMMANDS` or :meth:`poll` only if a model
diverges.
"""

from __future__ import annotations

import logging

from ...protocols import voltronic
from ..base import Metric, Reading
from .base import InverterDevice

log = logging.getLogger(__name__)

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
