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
        self.timezone: str = os.getenv("SA_TIMEZONE", "Europe/Bucharest")
        self.energy_flush_interval: float = float(
            os.getenv("SA_ENERGY_FLUSH_INTERVAL", "30")
        )
        self.energy_retention_days: int = int(
            os.getenv("SA_ENERGY_RETENTION_DAYS", "400")
        )
        self.cors_origins: List[str] = os.getenv("SA_CORS_ORIGINS", "*").split(",")
        self.log_level: str = os.getenv("SA_LOG_LEVEL", "INFO").upper()

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
