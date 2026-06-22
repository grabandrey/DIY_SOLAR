"""Battery BMS abstraction (future expansion).

Battery management systems plug into the exact same :class:`Device` contract as
inverters. When you add a real BMS (e.g. JBD/Daly/Pylontech/Seplos) create a subclass
here, parse its protocol into the common ``metrics`` shape, and register it in
``config/devices.yaml`` - the poller, API and frontend pick it up automatically.
"""

from __future__ import annotations

from ..base import Device, DeviceKind, Metric, Reading


class BMSDevice(Device):
    kind = DeviceKind.BMS


class ExampleBMS(BMSDevice):
    """Stub showing the expected metric shape for a battery pack.

    Replace :meth:`poll` with real protocol parsing (CAN/RS485/UART) when wiring up
    an actual BMS. Kept as a worked example so the BMS path is exercised end to end.
    """

    async def poll(self) -> Reading:
        try:
            # A real driver would do: raw = await self.transport.query(...)
            reading = Reading(
                device_id=self.device_id,
                device_name=self.name,
                kind=self.kind,
                online=True,
            )
            reading.metrics["pack_voltage"] = Metric(0.0, "V", "Pack voltage")
            reading.metrics["pack_current"] = Metric(0.0, "A", "Pack current")
            reading.metrics["soc"] = Metric(0.0, "%", "State of charge")
            reading.metrics["soh"] = Metric(0.0, "%", "State of health")
            reading.metrics["cell_temp"] = Metric(0.0, "°C", "Cell temperature")
            reading.metrics["cycles"] = Metric(0, "", "Charge cycles")
            return reading
        except Exception as exc:  # noqa: BLE001
            return self._offline_reading(str(exc))
