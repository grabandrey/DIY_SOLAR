"""Protocol tests - run with `pytest` from the backend dir."""

import asyncio

from app.protocols import voltronic
from app.transports.mock_transport import MockTransport
from app.devices.inverters.axpert import AxpertInverter
from app.devices.inverters.growatt import GrowattSPF
from app.core.registry import DRIVERS, build_device


def test_crc_known_value():
    # QPIGS CRC is a well-known Voltronic reference value.
    assert voltronic.crc16(b"QPIGS") == b"\xb7\xa9"


def test_frame_and_parse_roundtrip():
    body = "230.0 50.0 230.0 50.0 1200 1200 024 420 51.20 012 078 0038 05.6 320.0 51.20 00000"
    framed = voltronic.frame_response(body)
    assert voltronic.parse_response(framed) == body


def test_parse_response_rejects_bad_crc():
    framed = voltronic.frame_response("ABC")[:-3] + b"\x00\x00\r"
    try:
        voltronic.parse_response(framed)
        assert False, "expected ProtocolError"
    except voltronic.ProtocolError:
        pass


def test_parse_qpigs_fields():
    body = "230.0 50.0 230.0 50.0 1200 1100 024 420 51.20 012 078 0038 05.6 320.0 51.20 00000"
    parsed = voltronic.parse_qpigs(body)
    assert parsed["grid_voltage"] == 230.0
    assert parsed["ac_output_active_power"] == 1100.0
    assert parsed["battery_voltage"] == 51.2
    assert parsed["pv_input_power"] == round(5.6 * 320.0, 1)


def test_axpert_poll_with_mock_transport():
    inv = AxpertInverter("inverter-mock", "Mock", MockTransport(jitter=False))
    reading = asyncio.run(inv.poll())
    assert reading.online is True
    assert reading.kind.value == "inverter"
    assert "battery_voltage" in reading.metrics
    assert reading.metrics["mode"].value == "Battery / inverter"


def test_growatt_spf_poll_with_mock_transport():
    inv = GrowattSPF("growatt-1", "Growatt SPF 5000 ES", MockTransport(jitter=False))
    reading = asyncio.run(inv.poll())
    assert reading.online is True
    assert reading.kind.value == "inverter"
    assert reading.metrics["pv_input_power"].unit == "W"
    assert "battery_capacity" in reading.metrics


def test_growatt_driver_registered_and_buildable():
    assert "growatt" in DRIVERS and "growatt_spf" in DRIVERS
    dev = build_device(
        {"id": "g1", "name": "SPF", "driver": "growatt", "transport": {"type": "mock", "params": {}}}
    )
    assert isinstance(dev, GrowattSPF)
