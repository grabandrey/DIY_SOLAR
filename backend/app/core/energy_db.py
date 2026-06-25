"""Persistence backends for :class:`~app.core.energy_store.EnergyStore`.

The energy store keeps all aggregation in memory and only touches the database at startup,
during batched write-behind flushes, for the daily summary/series endpoints, and at shutdown.
That database can be either SQLite (the zero-config local default) or PostgreSQL (used in
production so history survives restarts — a container's local disk is ephemeral, so the
SQLite file there is wiped on every redeploy).

Both backends expose the same small API; the store holds no SQL of its own. Rows are returned
as mapping-style objects (``row["col"]`` works for both ``sqlite3.Row`` and psycopg dict rows).
"""

from __future__ import annotations

import sqlite3
from abc import ABC, abstractmethod
from pathlib import Path
from typing import Any, List, Mapping, Sequence, Tuple

DailyRow = Tuple[str, str, float, float, float, float]
StateRow = Tuple[str, str, float, float, float]
SampleRow = Tuple[str, str, int, float, float]


class EnergyDB(ABC):
    """Minimal persistence interface used by the energy store."""

    @abstractmethod
    def init_schema(self) -> None: ...

    @abstractmethod
    def purge_before(self, cutoff: str) -> None:
        """Delete daily aggregates and minute samples older than ``cutoff`` (ISO date)."""

    @abstractmethod
    def load_daily(self, cutoff: str) -> List[Any]:
        """Rows of (day, device_id, solar_wh, consumption_wh, hardware_solar_wh, updated_at)
        on/after ``cutoff``."""

    @abstractmethod
    def load_state(self) -> List[Any]:
        """All rows from ``energy_state``."""

    @abstractmethod
    def fetch_summary(self, day: str) -> List[Any]:
        """Rows of (device_id, solar_wh, consumption_wh) for ``day``."""

    @abstractmethod
    def fetch_series(self, day: str) -> List[Any]:
        """Rows of (device_id, sample_ts, solar_power_w, load_power_w) for ``day``."""

    @abstractmethod
    def write(
        self,
        daily_rows: Sequence[DailyRow],
        state_rows: Sequence[StateRow],
        sample_rows: Sequence[SampleRow],
    ) -> None:
        """Upsert all three batches atomically (one transaction)."""

    @abstractmethod
    def close(self) -> None: ...


# ---------------------------------------------------------------------------
# SQLite (local default)
# ---------------------------------------------------------------------------
class SqliteBackend(EnergyDB):
    def __init__(self, path: Path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._db = sqlite3.connect(self.path, check_same_thread=False, timeout=10)
        self._db.row_factory = sqlite3.Row
        self._db.execute("PRAGMA journal_mode=WAL")
        self._db.execute("PRAGMA synchronous=NORMAL")
        self._db.execute("PRAGMA temp_store=MEMORY")
        self._db.execute("PRAGMA busy_timeout=5000")

    def init_schema(self) -> None:
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

                CREATE TABLE IF NOT EXISTS energy_samples (
                    day TEXT NOT NULL,
                    device_id TEXT NOT NULL,
                    sample_ts INTEGER NOT NULL,
                    solar_power_w REAL NOT NULL,
                    load_power_w REAL NOT NULL,
                    PRIMARY KEY (day, device_id, sample_ts)
                ) WITHOUT ROWID;
                """
            )

    def purge_before(self, cutoff: str) -> None:
        with self._db:
            self._db.execute("DELETE FROM daily_energy WHERE day < ?", (cutoff,))
            self._db.execute("DELETE FROM energy_samples WHERE day < ?", (cutoff,))

    def load_daily(self, cutoff: str) -> List[Any]:
        return self._db.execute(
            """
            SELECT day, device_id, solar_wh, consumption_wh,
                   hardware_solar_wh, updated_at
            FROM daily_energy
            WHERE day >= ?
            """,
            (cutoff,),
        ).fetchall()

    def load_state(self) -> List[Any]:
        return self._db.execute("SELECT * FROM energy_state").fetchall()

    def fetch_summary(self, day: str) -> List[Any]:
        return self._db.execute(
            """
            SELECT device_id, solar_wh, consumption_wh
            FROM daily_energy
            WHERE day = ?
            ORDER BY device_id
            """,
            (day,),
        ).fetchall()

    def fetch_series(self, day: str) -> List[Any]:
        return self._db.execute(
            """
            SELECT device_id, sample_ts, solar_power_w, load_power_w
            FROM energy_samples
            WHERE day = ?
            """,
            (day,),
        ).fetchall()

    def write(self, daily_rows, state_rows, sample_rows) -> None:
        with self._db:
            if daily_rows:
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
            if state_rows:
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
            if sample_rows:
                self._db.executemany(
                    """
                    INSERT INTO energy_samples (
                        day, device_id, sample_ts, solar_power_w, load_power_w
                    ) VALUES (?, ?, ?, ?, ?)
                    ON CONFLICT(day, device_id, sample_ts) DO UPDATE SET
                        solar_power_w = excluded.solar_power_w,
                        load_power_w = excluded.load_power_w
                    """,
                    sample_rows,
                )

    def close(self) -> None:
        self._db.close()


# ---------------------------------------------------------------------------
# PostgreSQL (production — persistent across restarts)
# ---------------------------------------------------------------------------
class PostgresBackend(EnergyDB):
    """psycopg3-backed store. A single connection guarded by the store's lock (all DB access
    is already serialized there), with autocommit on and explicit transactions for batch
    writes."""

    def __init__(self, conninfo: str | Mapping[str, Any]):
        try:
            import psycopg
            from psycopg.rows import dict_row
        except ModuleNotFoundError as exc:  # pragma: no cover - depends on install
            raise RuntimeError(
                "DATABASE_URL is set but psycopg is not installed. "
                "Add 'psycopg[binary]' to requirements."
            ) from exc

        # SQLAlchemy/Railway sometimes hand out the legacy 'postgres://' scheme; libpq wants
        # 'postgresql://'.
        if isinstance(conninfo, str):
            if conninfo.startswith("postgres://"):
                conninfo = "postgresql://" + conninfo[len("postgres://"):]
            self._conn = psycopg.connect(
                conninfo,
                autocommit=True,
                row_factory=dict_row,
            )
        else:
            self._conn = psycopg.connect(
                **conninfo,
                autocommit=True,
                row_factory=dict_row,
            )

    def init_schema(self) -> None:
        self._conn.execute(
            """
            CREATE TABLE IF NOT EXISTS daily_energy (
                day TEXT NOT NULL,
                device_id TEXT NOT NULL,
                solar_wh DOUBLE PRECISION NOT NULL DEFAULT 0,
                consumption_wh DOUBLE PRECISION NOT NULL DEFAULT 0,
                hardware_solar_wh DOUBLE PRECISION NOT NULL DEFAULT 0,
                updated_at DOUBLE PRECISION NOT NULL,
                PRIMARY KEY (day, device_id)
            )
            """
        )
        self._conn.execute(
            """
            CREATE TABLE IF NOT EXISTS energy_state (
                device_id TEXT PRIMARY KEY,
                day TEXT NOT NULL,
                sample_ts DOUBLE PRECISION NOT NULL,
                solar_power_w DOUBLE PRECISION NOT NULL,
                load_power_w DOUBLE PRECISION NOT NULL
            )
            """
        )
        self._conn.execute(
            """
            CREATE TABLE IF NOT EXISTS energy_samples (
                day TEXT NOT NULL,
                device_id TEXT NOT NULL,
                sample_ts BIGINT NOT NULL,
                solar_power_w DOUBLE PRECISION NOT NULL,
                load_power_w DOUBLE PRECISION NOT NULL,
                PRIMARY KEY (day, device_id, sample_ts)
            )
            """
        )

    def purge_before(self, cutoff: str) -> None:
        self._conn.execute("DELETE FROM daily_energy WHERE day < %s", (cutoff,))
        self._conn.execute("DELETE FROM energy_samples WHERE day < %s", (cutoff,))

    def load_daily(self, cutoff: str) -> List[Any]:
        return self._conn.execute(
            """
            SELECT day, device_id, solar_wh, consumption_wh,
                   hardware_solar_wh, updated_at
            FROM daily_energy
            WHERE day >= %s
            """,
            (cutoff,),
        ).fetchall()

    def load_state(self) -> List[Any]:
        return self._conn.execute("SELECT * FROM energy_state").fetchall()

    def fetch_summary(self, day: str) -> List[Any]:
        return self._conn.execute(
            """
            SELECT device_id, solar_wh, consumption_wh
            FROM daily_energy
            WHERE day = %s
            ORDER BY device_id
            """,
            (day,),
        ).fetchall()

    def fetch_series(self, day: str) -> List[Any]:
        return self._conn.execute(
            """
            SELECT device_id, sample_ts, solar_power_w, load_power_w
            FROM energy_samples
            WHERE day = %s
            """,
            (day,),
        ).fetchall()

    def write(self, daily_rows, state_rows, sample_rows) -> None:
        with self._conn.transaction(), self._conn.cursor() as cur:
            if daily_rows:
                cur.executemany(
                    """
                    INSERT INTO daily_energy (
                        day, device_id, solar_wh, consumption_wh,
                        hardware_solar_wh, updated_at
                    ) VALUES (%s, %s, %s, %s, %s, %s)
                    ON CONFLICT (day, device_id) DO UPDATE SET
                        solar_wh = EXCLUDED.solar_wh,
                        consumption_wh = EXCLUDED.consumption_wh,
                        hardware_solar_wh = EXCLUDED.hardware_solar_wh,
                        updated_at = EXCLUDED.updated_at
                    """,
                    daily_rows,
                )
            if state_rows:
                cur.executemany(
                    """
                    INSERT INTO energy_state (
                        device_id, day, sample_ts, solar_power_w, load_power_w
                    ) VALUES (%s, %s, %s, %s, %s)
                    ON CONFLICT (device_id) DO UPDATE SET
                        day = EXCLUDED.day,
                        sample_ts = EXCLUDED.sample_ts,
                        solar_power_w = EXCLUDED.solar_power_w,
                        load_power_w = EXCLUDED.load_power_w
                    """,
                    state_rows,
                )
            if sample_rows:
                cur.executemany(
                    """
                    INSERT INTO energy_samples (
                        day, device_id, sample_ts, solar_power_w, load_power_w
                    ) VALUES (%s, %s, %s, %s, %s)
                    ON CONFLICT (day, device_id, sample_ts) DO UPDATE SET
                        solar_power_w = EXCLUDED.solar_power_w,
                        load_power_w = EXCLUDED.load_power_w
                    """,
                    sample_rows,
                )

    def close(self) -> None:
        self._conn.close()
