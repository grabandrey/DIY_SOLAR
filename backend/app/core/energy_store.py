"""High-throughput daily energy aggregation with batched SQLite persistence."""

from __future__ import annotations

import sqlite3
import threading
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Dict
from zoneinfo import ZoneInfo

from ..devices.base import Reading


def _metric(reading: Reading, *keys: str) -> float:
    for key in keys:
        metric = reading.metrics.get(key)
        if metric is not None:
            try:
                return float(metric.value)
            except (TypeError, ValueError):
                continue
    return 0.0


def _powers(reading: Reading) -> tuple[float, float]:
    if reading.kind.value == "bms":
        return 0.0, 0.0
    solar = _metric(reading, "pv_input_power") + _metric(reading, "pv2_power")
    load = _metric(reading, "ac_output_active_power", "total_ac_output_active_power")
    return max(solar, 0.0), max(load, 0.0)


class EnergyStore:
    """Integrate in memory and periodically persist changed rows in one transaction.

    The high-frequency poll path never queries SQLite. SQLite is used at startup,
    during batched write-behind flushes, for the low-frequency daily summary endpoint,
    and at shutdown.
    """

    MAX_SAMPLE_GAP_SECONDS = 300

    def __init__(self, path: Path, timezone: str = "UTC", retention_days: int = 400):
        self.path = path
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.timezone = ZoneInfo(timezone)
        self.retention_days = max(retention_days, 1)
        self._lock = threading.Lock()
        self._db = sqlite3.connect(path, check_same_thread=False, timeout=10)
        self._db.row_factory = sqlite3.Row

        # (day, device_id) -> mutable aggregate values.
        self._daily: Dict[tuple[str, str], Dict[str, float]] = {}
        # device_id -> latest integration sample.
        self._state: Dict[str, Dict[str, float | str]] = {}
        self._dirty_daily: set[tuple[str, str]] = set()
        self._dirty_state: set[str] = set()

        self._configure_database()
        self._create_schema()
        self._load_cache()

    def _configure_database(self) -> None:
        self._db.execute("PRAGMA journal_mode=WAL")
        self._db.execute("PRAGMA synchronous=NORMAL")
        self._db.execute("PRAGMA temp_store=MEMORY")
        self._db.execute("PRAGMA busy_timeout=5000")

    def _create_schema(self) -> None:
        with self._db:
            self._db.executescript(
                """
                CREATE TABLE IF NOT EXISTS daily_energy (
                    day TEXT NOT NULL,
                    device_id TEXT NOT NULL,
                    solar_wh REAL NOT NULL DEFAULT 0,
                    consumption_wh REAL NOT NULL DEFAULT 0,
                    hardware_solar_wh REAL NOT NULL DEFAULT 0,
                    updated_at REAL NOT NULL,
                    PRIMARY KEY (day, device_id)
                ) WITHOUT ROWID;

                CREATE TABLE IF NOT EXISTS energy_state (
                    device_id TEXT PRIMARY KEY,
                    day TEXT NOT NULL,
                    sample_ts REAL NOT NULL,
                    solar_power_w REAL NOT NULL,
                    load_power_w REAL NOT NULL
                ) WITHOUT ROWID;
                """
            )

    def _load_cache(self) -> None:
        cutoff = (
            datetime.now(self.timezone).date() - timedelta(days=self.retention_days - 1)
        ).isoformat()
        with self._db:
            self._db.execute("DELETE FROM daily_energy WHERE day < ?", (cutoff,))
            rows = self._db.execute(
                """
                SELECT day, device_id, solar_wh, consumption_wh,
                       hardware_solar_wh, updated_at
                FROM daily_energy
                WHERE day >= ?
                """,
                (cutoff,),
            ).fetchall()
            states = self._db.execute("SELECT * FROM energy_state").fetchall()

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
        solar_power, load_power = _powers(reading)
        hardware_solar_wh = _metric(reading, "pv_energy_today") * 1000
        key = (day, reading.device_id)

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
                        (float(previous["solar_power_w"]) + solar_power) / 2
                    ) * elapsed / 3600
                    aggregate["consumption_wh"] += (
                        (float(previous["load_power_w"]) + load_power) / 2
                    ) * elapsed / 3600

            aggregate["hardware_solar_wh"] = max(
                aggregate["hardware_solar_wh"], hardware_solar_wh
            )
            aggregate["updated_at"] = sample_ts
            self._state[reading.device_id] = {
                "day": day,
                "sample_ts": sample_ts,
                "solar_power_w": solar_power,
                "load_power_w": load_power,
            }
            self._dirty_daily.add(key)
            self._dirty_state.add(reading.device_id)

    def summary(self, day: str | None = None) -> Dict[str, Any]:
        """Return only values that have been persisted in ``daily_energy``.

        Solar production intentionally uses ``solar_wh`` rather than the inverter's
        optional hardware counter so the API exactly matches the registered table data.
        """
        selected_day = day or datetime.now(self.timezone).date().isoformat()
        with self._lock:
            rows = self._db.execute(
                """
                SELECT device_id, solar_wh, consumption_wh
                FROM daily_energy
                WHERE day = ?
                ORDER BY device_id
                """,
                (selected_day,),
            ).fetchall()
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

    def flush(self) -> int:
        """Persist all changed aggregates and states in one SQLite transaction."""
        with self._lock:
            if not self._dirty_daily and not self._dirty_state:
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

            with self._db:
                self._db.executemany(
                    """
                    INSERT INTO daily_energy (
                        day, device_id, solar_wh, consumption_wh,
                        hardware_solar_wh, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?)
                    ON CONFLICT(day, device_id) DO UPDATE SET
                        solar_wh = excluded.solar_wh,
                        consumption_wh = excluded.consumption_wh,
                        hardware_solar_wh = excluded.hardware_solar_wh,
                        updated_at = excluded.updated_at
                    """,
                    daily_rows,
                )
                self._db.executemany(
                    """
                    INSERT INTO energy_state (
                        device_id, day, sample_ts, solar_power_w, load_power_w
                    ) VALUES (?, ?, ?, ?, ?)
                    ON CONFLICT(device_id) DO UPDATE SET
                        day = excluded.day,
                        sample_ts = excluded.sample_ts,
                        solar_power_w = excluded.solar_power_w,
                        load_power_w = excluded.load_power_w
                    """,
                    state_rows,
                )

            self._dirty_daily.clear()
            self._dirty_state.clear()
            return len(daily_rows) + len(state_rows)

    def close(self) -> None:
        self.flush()
        with self._lock:
            self._db.close()
