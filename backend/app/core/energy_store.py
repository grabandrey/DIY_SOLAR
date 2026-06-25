"""High-throughput daily energy aggregation with batched write-behind persistence.

Aggregation runs entirely in memory; the database (SQLite locally, PostgreSQL in production —
see :mod:`app.core.energy_db`) is only touched at startup, during batched flushes, for the
daily summary/series endpoints, and at shutdown.
"""

from __future__ import annotations

import threading
from datetime import datetime, timedelta
from typing import Any, Dict
from zoneinfo import ZoneInfo

from ..devices.base import Reading
from .energy_db import EnergyDB, PostgresBackend, SqliteBackend
from .metrics import load_power, metric_value, solar_power


def build_energy_store(settings) -> "EnergyStore":
    """Build a PostgreSQL store when connection settings exist, otherwise use SQLite."""
    conninfo = settings.postgres_conninfo()
    backend: EnergyDB = (
        PostgresBackend(conninfo) if conninfo else SqliteBackend(settings.energy_db_path)
    )
    return EnergyStore(backend, settings.timezone, settings.energy_retention_days)


class EnergyStore:
    """Integrate in memory and periodically persist changed rows in one transaction.

    The high-frequency poll path never queries the database. The database is used at startup,
    during batched write-behind flushes, for the low-frequency daily summary endpoint,
    and at shutdown.
    """

    MAX_SAMPLE_GAP_SECONDS = 300

    def __init__(self, backend, timezone: str = "UTC", retention_days: int = 400):
        # Accept a ready EnergyDB backend, or a path-like for the SQLite default (keeps the
        # simple ``EnergyStore(path, tz)`` form used by tests and local setups working).
        self.db: EnergyDB = backend if isinstance(backend, EnergyDB) else SqliteBackend(backend)
        self.timezone = ZoneInfo(timezone)
        self.retention_days = max(retention_days, 1)
        self._lock = threading.Lock()

        # (day, device_id) -> mutable aggregate values.
        self._daily: Dict[tuple[str, str], Dict[str, float]] = {}
        # device_id -> latest integration sample.
        self._state: Dict[str, Dict[str, float | str]] = {}
        # (device_id, minute_ts) -> latest sample for that minute.
        self._samples: Dict[tuple[str, int], Dict[str, float | str]] = {}
        self._dirty_daily: set[tuple[str, str]] = set()
        self._dirty_state: set[str] = set()
        self._dirty_samples: set[tuple[str, int]] = set()

        self.db.init_schema()
        self._load_cache()

    def _load_cache(self) -> None:
        cutoff = (
            datetime.now(self.timezone).date() - timedelta(days=self.retention_days - 1)
        ).isoformat()
        with self._lock:
            self.db.purge_before(cutoff)
            rows = self.db.load_daily(cutoff)
            states = self.db.load_state()

        self._daily = {
            (row["day"], row["device_id"]): {
                "solar_wh": row["solar_wh"],
                "consumption_wh": row["consumption_wh"],
                "hardware_solar_wh": row["hardware_solar_wh"],
                "updated_at": row["updated_at"],
            }
            for row in rows
        }
        self._state = {
            row["device_id"]: {
                "day": row["day"],
                "sample_ts": row["sample_ts"],
                "solar_power_w": row["solar_power_w"],
                "load_power_w": row["load_power_w"],
            }
            for row in states
        }

    def record(self, reading: Reading) -> None:
        """Record a reading using only in-memory operations."""
        if not reading.online or reading.kind.value == "bms":
            return

        timestamp = datetime.fromisoformat(reading.ts.replace("Z", "+00:00"))
        day = timestamp.astimezone(self.timezone).date().isoformat()
        sample_ts = timestamp.timestamp()
        solar_w = solar_power(reading)
        load_w = load_power(reading)
        hardware_solar_wh = metric_value(reading, "pv_energy_today") * 1000
        key = (day, reading.device_id)
        minute_ts = int(sample_ts // 60) * 60

        with self._lock:
            previous = self._state.get(reading.device_id)
            # Re-published last-good readings carry the same timestamp. Ignore them
            # completely so retries do not generate writes or duplicate integration.
            if previous and sample_ts <= float(previous["sample_ts"]):
                return

            aggregate = self._daily.setdefault(
                key,
                {
                    "solar_wh": 0.0,
                    "consumption_wh": 0.0,
                    "hardware_solar_wh": 0.0,
                    "updated_at": sample_ts,
                },
            )

            if previous and previous["day"] == day:
                elapsed = sample_ts - float(previous["sample_ts"])
                if elapsed <= self.MAX_SAMPLE_GAP_SECONDS:
                    aggregate["solar_wh"] += (
                        (float(previous["solar_power_w"]) + solar_w) / 2
                    ) * elapsed / 3600
                    aggregate["consumption_wh"] += (
                        (float(previous["load_power_w"]) + load_w) / 2
                    ) * elapsed / 3600

            aggregate["hardware_solar_wh"] = max(
                aggregate["hardware_solar_wh"], hardware_solar_wh
            )
            aggregate["updated_at"] = sample_ts
            self._state[reading.device_id] = {
                "day": day,
                "sample_ts": sample_ts,
                "solar_power_w": solar_w,
                "load_power_w": load_w,
            }
            sample_key = (reading.device_id, minute_ts)
            self._samples[sample_key] = {
                "day": day,
                "sample_ts": minute_ts,
                "solar_power_w": solar_w,
                "load_power_w": load_w,
            }
            self._dirty_daily.add(key)
            self._dirty_state.add(reading.device_id)
            self._dirty_samples.add(sample_key)

    def summary(self, day: str | None = None) -> Dict[str, Any]:
        """Return only values that have been persisted in ``daily_energy``.

        Solar production intentionally uses ``solar_wh`` rather than the inverter's
        optional hardware counter so the API exactly matches the registered table data.
        """
        selected_day = day or datetime.now(self.timezone).date().isoformat()
        with self._lock:
            rows = self.db.fetch_summary(selected_day)
            devices = [
                {
                    "device_id": row["device_id"],
                    "solar_kwh": round(row["solar_wh"] / 1000, 3),
                    "consumption_kwh": round(row["consumption_wh"] / 1000, 3),
                }
                for row in rows
            ]

        return {
            "date": selected_day,
            "solar_kwh": round(sum(item["solar_kwh"] for item in devices), 3),
            "consumption_kwh": round(
                sum(item["consumption_kwh"] for item in devices), 3
            ),
            "devices": devices,
        }

    def series(self, day: str | None = None) -> Dict[str, Any]:
        """Return minute-level solar/load power points for one local day."""
        selected_day = day or datetime.now(self.timezone).date().isoformat()
        with self._lock:
            rows = self.db.fetch_series(selected_day)
            by_device_sample = {
                (row["device_id"], int(row["sample_ts"])): {
                    "sample_ts": int(row["sample_ts"]),
                    "solar_power_w": float(row["solar_power_w"]),
                    "load_power_w": float(row["load_power_w"]),
                }
                for row in rows
            }
            for (device_id, sample_ts), sample in self._samples.items():
                if sample["day"] != selected_day:
                    continue
                by_device_sample[(device_id, sample_ts)] = {
                    "sample_ts": int(sample["sample_ts"]),
                    "solar_power_w": float(sample["solar_power_w"]),
                    "load_power_w": float(sample["load_power_w"]),
                }

        buckets: Dict[int, Dict[str, float]] = {}
        for sample in by_device_sample.values():
            bucket = buckets.setdefault(
                int(sample["sample_ts"]),
                {"solar_power_w": 0.0, "load_power_w": 0.0},
            )
            bucket["solar_power_w"] += float(sample["solar_power_w"])
            bucket["load_power_w"] += float(sample["load_power_w"])

        points = [
            {
                "t": sample_ts * 1000,
                "solar_w": round(values["solar_power_w"], 1),
                "load_w": round(values["load_power_w"], 1),
            }
            for sample_ts, values in sorted(buckets.items())
        ]
        return {"date": selected_day, "points": points}

    def flush(self) -> int:
        """Persist all changed aggregates and states in one database transaction."""
        with self._lock:
            if not self._dirty_daily and not self._dirty_state and not self._dirty_samples:
                return 0

            daily_rows = [
                (
                    day,
                    device_id,
                    self._daily[(day, device_id)]["solar_wh"],
                    self._daily[(day, device_id)]["consumption_wh"],
                    self._daily[(day, device_id)]["hardware_solar_wh"],
                    self._daily[(day, device_id)]["updated_at"],
                )
                for day, device_id in self._dirty_daily
            ]
            state_rows = [
                (
                    device_id,
                    self._state[device_id]["day"],
                    self._state[device_id]["sample_ts"],
                    self._state[device_id]["solar_power_w"],
                    self._state[device_id]["load_power_w"],
                )
                for device_id in self._dirty_state
            ]
            sample_rows = [
                (
                    self._samples[(device_id, sample_ts)]["day"],
                    device_id,
                    self._samples[(device_id, sample_ts)]["sample_ts"],
                    self._samples[(device_id, sample_ts)]["solar_power_w"],
                    self._samples[(device_id, sample_ts)]["load_power_w"],
                )
                for device_id, sample_ts in self._dirty_samples
            ]

            self.db.write(daily_rows, state_rows, sample_rows)

            flushed_samples = set(self._dirty_samples)
            self._dirty_daily.clear()
            self._dirty_state.clear()
            self._dirty_samples.clear()
            for key in flushed_samples:
                self._samples.pop(key, None)
            return len(daily_rows) + len(state_rows) + len(sample_rows)

    def close(self) -> None:
        self.flush()
        with self._lock:
            self.db.close()
