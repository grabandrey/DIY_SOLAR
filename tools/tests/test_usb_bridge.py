import importlib.util
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock

spec = importlib.util.spec_from_file_location("usb_bridge", Path(__file__).parents[1] / "usb_bridge.py")
bridge_module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bridge_module)


def test_identical_hid_controllers_have_separate_targets_and_ports(monkeypatch, tmp_path):
    devices = [dict(path=path, vendor_id=0x0665, product_id=0x5161,
                    product_string="Phocos", serial_number="same")
               for path in (b"controller-a", b"controller-b", b"controller-a")]
    monkeypatch.setattr(bridge_module, "HID_OK", True)
    monkeypatch.setattr(bridge_module, "_hid", SimpleNamespace(enumerate=lambda: devices))
    monkeypatch.setattr(bridge_module.list_ports, "comports", lambda: [])
    monkeypatch.setattr(bridge_module.Bridge, "_PORT_MAP_FILE", str(tmp_path / "ports.json"))
    monkeypatch.setattr(bridge_module.Bridge, "_start_listener", Mock())
    bridge = bridge_module.Bridge(2400, 5500, "localhost", False, None, None)
    bridge.scan()
    original = {key: (entry["target"], entry["tcp_port"]) for key, entry in bridge.devices.items()}
    assert len(original) == 2
    assert {target for target, port in original.values()} == {b"controller-a", b"controller-b"}
    assert len({port for target, port in original.values()}) == 2
    devices.reverse()
    restarted = bridge_module.Bridge(2400, 5500, "localhost", False, None, None)
    restarted.scan()
    assert {key: (entry["target"], entry["tcp_port"]) for key, entry in restarted.devices.items()} == original


def test_serial_controllers_with_duplicate_serial_numbers_stay_separate(monkeypatch, tmp_path):
    ports = [SimpleNamespace(device=path, vid=0x0403, pid=0x6001, serial_number="same",
                             description="Phocos", hwid="FTDI")
             for path in ("/dev/ttyUSB0", "/dev/ttyUSB1")]
    monkeypatch.setattr(bridge_module.list_ports, "comports", lambda: ports)
    monkeypatch.setattr(bridge_module, "_stable_serial_path", lambda path: path)
    monkeypatch.setattr(bridge_module, "_enumerate_hid", lambda *args: [])
    monkeypatch.setattr(bridge_module.Bridge, "_PORT_MAP_FILE", str(tmp_path / "ports.json"))
    monkeypatch.setattr(bridge_module.Bridge, "_start_listener", Mock())
    bridge = bridge_module.Bridge(2400, 5500, "localhost", False, None, None)
    bridge.scan()
    assert len(bridge.snapshot()) == 2
    assert {e["target"] for e in bridge.devices.values()} == {p.device for p in ports}
    assert len({e["tcp_port"] for e in bridge.devices.values()}) == 2
