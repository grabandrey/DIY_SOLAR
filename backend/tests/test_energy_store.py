from datetime import datetime, timedelta, timezone

import pytest

from app.core.energy_store import EnergyStore
from app.devices.base import DeviceKind, Metric, Reading


def reading(device_id, timestamp, solar_w, load_w, hardware_kwh=None):
    metrics = {
        "pv_input_power": Metric(solar_w, "W"),
        "ac_output_active_power": Metric(load_w, "W"),
    }
    if hardware_kwh is not None:
        metrics["pv_energy_today"] = Metric(hardware_kwh, "kWh")
    return Reading(
        device_id=device_id,
        device_name=device_id,
        kind=DeviceKind.INVERTER,
        ts=timestamp.isoformat(),
        metrics=metrics,
    )


def bms_reading(device_id, timestamp, power_w):
    return Reading(
        device_id=device_id,
        device_name=device_id,
        kind=DeviceKind.BMS,
        ts=timestamp.isoformat(),
        metrics={"power": Metric(power_w, "W")},
    )


def test_integrates_daily_energy_and_persists(tmp_path):
    path = tmp_path / "energy.sqlite3"
    store = EnergyStore(path, "UTC")
    start = datetime(2026, 6, 23, 10, 0, tzinfo=timezone.utc)
    store.record(reading("inv-1", start, 1000, 500))
    store.record(reading("inv-1", start + timedelta(seconds=60), 1000, 500))
    store.flush()

    summary = store.summary("2026-06-23")
    assert summary["solar_kwh"] == pytest.approx(1 / 60, abs=0.001)
    assert summary["consumption_kwh"] == pytest.approx(0.5 / 60, abs=0.001)
    store.close()

    reopened = EnergyStore(path, "UTC")
    assert reopened.summary("2026-06-23") == summary
    reopened.close()


def test_hardware_solar_counter_overrides_integrated_value(tmp_path):
    store = EnergyStore(tmp_path / "energy.sqlite3", "UTC")
    now = datetime(2026, 6, 23, 12, 0, tzinfo=timezone.utc)
    store.record(reading("inv-1", now, 500, 250, hardware_kwh=4.2))
    store.record(reading("inv-1", now + timedelta(seconds=60), 500, 250, hardware_kwh=4.3))
    store.flush()

    summary = store.summary("2026-06-23")
    assert summary["solar_kwh"] == pytest.approx(0.5 / 60, abs=0.001)
    store.close()


def test_ignores_duplicate_and_long_gap_samples(tmp_path):
    store = EnergyStore(tmp_path / "energy.sqlite3", "UTC")
    now = datetime(2026, 6, 23, 12, 0, tzinfo=timezone.utc)
    sample = reading("inv-1", now, 1000, 1000)
    store.record(sample)
    store.record(sample)
    store.record(reading("inv-1", now + timedelta(minutes=10), 1000, 1000))
    store.flush()

    summary = store.summary("2026-06-23")
    assert summary["solar_kwh"] == 0
    assert summary["consumption_kwh"] == 0
    store.close()


def test_summary_reads_only_flushed_table_data_and_flush_is_batched(tmp_path):
    store = EnergyStore(tmp_path / "energy.sqlite3", "UTC")
    now = datetime(2026, 6, 23, 12, 0, tzinfo=timezone.utc)
    store.record(reading("inv-1", now, 1000, 500))
    store.record(reading("inv-1", now + timedelta(seconds=60), 1000, 500))

    assert store.summary("2026-06-23")["solar_kwh"] == 0
    assert store.flush() == 4  # aggregate row + latest-state row + two minute samples
    assert store.summary("2026-06-23")["solar_kwh"] > 0
    assert store.flush() == 0
    store.close()


def test_bms_power_is_not_counted_as_consumption(tmp_path):
    store = EnergyStore(tmp_path / "energy.sqlite3", "UTC")
    now = datetime(2026, 6, 23, 12, 0, tzinfo=timezone.utc)
    store.record(bms_reading("bat-1", now, -1200))
    store.record(bms_reading("bat-1", now + timedelta(seconds=60), -1200))
    store.flush()

    summary = store.summary("2026-06-23")
    assert summary["solar_kwh"] == 0
    assert summary["consumption_kwh"] == 0
    assert summary["devices"] == []
    store.close()


def test_series_persists_minute_samples(tmp_path):
    path = tmp_path / "energy.sqlite3"
    store = EnergyStore(path, "UTC")
    now = datetime(2026, 6, 23, 12, 0, 20, tzinfo=timezone.utc)
    store.record(reading("inv-1", now, 1000, 500))
    store.record(reading("inv-2", now + timedelta(seconds=8), 300, 200))
    store.flush()

    series = store.series("2026-06-23")
    assert series["points"] == [
        {
            "t": int(now.timestamp() // 60) * 60 * 1000,
            "solar_w": 1300.0,
            "load_w": 700.0,
        }
    ]
    store.close()

    reopened = EnergyStore(path, "UTC")
    assert reopened.series("2026-06-23") == series
    reopened.close()
