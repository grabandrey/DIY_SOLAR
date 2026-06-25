"""Configuration loading.

Device topology comes from a YAML file (``config/devices.yaml`` by default, overridable
with ``SA_CONFIG``). Runtime knobs come from environment variables. Keeping device
definitions in YAML is what makes adding inverters/BMS units a config edit, not a code
change.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any, Dict, List

import yaml

DEFAULT_CONFIG_PATH = Path(__file__).resolve().parent.parent / "config" / "devices.yaml"


class Settings:
    def __init__(self) -> None:
        self.poll_interval: float = float(os.getenv("SA_POLL_INTERVAL", "2.0"))
        self.config_path: Path = Path(os.getenv("SA_CONFIG", str(DEFAULT_CONFIG_PATH)))
        # Writable runtime store (devices added/edited from the frontend).
        self.store_path: Path = Path(
            os.getenv("SA_STORE", str(DEFAULT_CONFIG_PATH.parent / "devices.json"))
        )
        self.energy_db_path: Path = Path(
            os.getenv("SA_ENERGY_DB", str(DEFAULT_CONFIG_PATH.parent / "energy.sqlite3"))
        )
        # When set, energy history is stored in PostgreSQL (survives restarts/redeploys) instead
        # of the local SQLite file. Either give a full URL (Railway provisions DATABASE_URL
        # automatically) or the individual pieces below — host/port/name/user/password.
        self.database_url: str | None = (
            os.getenv("DATABASE_URL") or os.getenv("SA_DATABASE_URL") or None
        )
        # Individual connection parts (used when no full URL is given). Fall back to the
        # standard libpq PG* variables that Railway/Postgres images already set.
        self.db_host: str | None = (
            os.getenv("SA_DB_HOST")
            or os.getenv("POSTGRES_HOST")
            or os.getenv("PGHOST")
            or None
        )
        self.db_port: str | None = (
            os.getenv("SA_DB_PORT")
            or os.getenv("POSTGRES_PORT")
            or os.getenv("PGPORT")
            or None
        )
        self.db_name: str | None = (
            os.getenv("SA_DB_NAME")
            or os.getenv("POSTGRES_DB")
            or os.getenv("PGDATABASE")
            or None
        )
        self.db_user: str | None = (
            os.getenv("SA_DB_USER")
            or os.getenv("POSTGRES_USER")
            or os.getenv("POSTGRES_USERNAME")
            or os.getenv("PGUSER")
            or None
        )
        self.db_password: str | None = (
            os.getenv("SA_DB_PASSWORD")
            or os.getenv("POSTGRES_PASSWORD")
            or os.getenv("PGPASSWORD")
            or None
        )
        self.timezone: str = os.getenv("SA_TIMEZONE", "Europe/Bucharest")
        self.energy_flush_interval: float = float(
            os.getenv("SA_ENERGY_FLUSH_INTERVAL", "30")
        )
        self.energy_retention_days: int = int(
            os.getenv("SA_ENERGY_RETENTION_DAYS", "400")
        )
        self.cors_origins: List[str] = os.getenv("SA_CORS_ORIGINS", "*").split(",")
        self.log_level: str = os.getenv("SA_LOG_LEVEL", "INFO").upper()

    def postgres_conninfo(self) -> str | Dict[str, Any] | None:
        """Resolve the PostgreSQL connection target for the energy store, or None for SQLite.

        A full URL wins. Otherwise build connection keyword args from the individual parts
        (passed as kwargs so a password with special characters needs no URL-encoding). A host
        must be present for the component form to be considered configured; user and password
        are included when set.
        """
        if self.database_url:
            return self.database_url
        if not self.db_host:
            return None
        params: Dict[str, Any] = {"host": self.db_host}
        if self.db_port:
            params["port"] = self.db_port
        if self.db_name:
            params["dbname"] = self.db_name
        if self.db_user:
            params["user"] = self.db_user
        if self.db_password:
            params["password"] = self.db_password
        return params

    def load_devices(self) -> List[Dict[str, Any]]:
        if not self.config_path.exists():
            return []
        with self.config_path.open("r", encoding="utf-8") as fh:
            data = yaml.safe_load(fh) or {}
        devices = data.get("devices", [])
        return self._expand_env(devices)

    @staticmethod
    def _expand_env(obj: Any) -> Any:
        """Expand ``${VAR}`` references in string values from config."""
        if isinstance(obj, dict):
            return {k: Settings._expand_env(v) for k, v in obj.items()}
        if isinstance(obj, list):
            return [Settings._expand_env(v) for v in obj]
        if isinstance(obj, str):
            return os.path.expandvars(obj)
        return obj


settings = Settings()
