import io
from unittest.mock import patch
from test_usb_bridge import bridge_module as bridge


def event(phys, vid='0665', pid='5161'):
    return f'HID_ID=0003:0000{vid}:0000{pid}\nHID_PHYS={phys}\n'


def test_identity_survives_hidraw_renumbering():
    device = {'vid': '0665', 'pid': '5161', 'path': b'/dev/hidraw1'}
    with patch('builtins.open', side_effect=lambda *a: io.StringIO(event('usb-pci-3.2/input0'))):
        before = bridge._hid_identity(device)
        device['path'] = b'/dev/hidraw8'
        assert bridge._hid_identity(device) == before
    with patch('builtins.open', side_effect=lambda *a: io.StringIO(event('usb-pci-3.4/input0'))):
        assert bridge._hid_identity(device) != before


def test_reused_node_cannot_open_another_usb_model():
    import pytest
    with patch('builtins.open', return_value=io.StringIO(event('usb-pci-6/input3', '0d8c', '0014'))):
        with pytest.raises(OSError):
            bridge._hid_identity({'vid': '0665', 'pid': '5161', 'path': b'/dev/hidraw1'})


def test_missing_sysfs_does_not_create_volatile_identity():
    import pytest
    with patch('builtins.open', side_effect=FileNotFoundError):
        with pytest.raises(OSError):
            bridge._hid_identity({'vid': '0665', 'pid': '5161', 'path': b'/dev/hidraw9'})


def test_scan_keeps_target_and_port_across_reset(monkeypatch, tmp_path):
    from unittest.mock import Mock
    devices = [{'vid':'0665', 'pid':'5161', 'path': b'/dev/hidraw2',
                'description':'Phocos', 'manufacturer':None, 'likely_inverter':True}]
    monkeypatch.setattr(bridge, '_enumerate_hid', lambda *args: devices)
    monkeypatch.setattr(bridge.list_ports, 'comports', lambda: [])
    monkeypatch.setattr(bridge.Bridge, '_PORT_MAP_FILE', str(tmp_path/'ports.json'))
    monkeypatch.setattr(bridge.Bridge, '_start_listener', Mock())
    original_open = open
    def sysfs(path, *args, **kwargs):
        if str(path).startswith('/sys/'):
            return io.StringIO(event('usb-pci-3.2/input0'))
        return original_open(path, *args, **kwargs)
    with patch('builtins.open', side_effect=sysfs):
        instance = bridge.Bridge(2400,5500,'localhost',False,None,None)
        instance.scan()
        before = instance.snapshot()
        devices[0]['path'] = b'/dev/hidraw8'
        instance.scan()
        assert instance.snapshot() == before
        assert len(instance.devices) == 1
        assert next(iter(instance.devices.values()))['target'] == b'/dev/hidraw8'
        restarted = bridge.Bridge(2400,5500,'localhost',False,None,None)
        restarted.scan()
        assert restarted.snapshot() == before
