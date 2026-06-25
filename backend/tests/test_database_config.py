from pathlib import Path

from app.config import Settings
from app.core import energy_store


POSTGRES_ENV_VARS = (
    "DATABASE_URL",
    "SA_DATABASE_URL",
    "SA_DB_HOST",
    "SA_DB_PORT",
    "SA_DB_NAME",
    "SA_DB_USER",
    "SA_DB_PASSWORD",
    "POSTGRES_HOST",
    "POSTGRES_PORT",
    "POSTGRES_DB",
    "POSTGRES_USER",
    "POSTGRES_USERNAME",
    "POSTGRES_PASSWORD",
    "PGHOST",
    "PGPORT",
    "PGDATABASE",
    "PGUSER",
    "PGPASSWORD",
)


def clear_postgres_env(monkeypatch):
    for name in POSTGRES_ENV_VARS:
        monkeypatch.delenv(name, raising=False)


def test_database_url_takes_precedence(monkeypatch):
    clear_postgres_env(monkeypatch)
    monkeypatch.setenv("DATABASE_URL", "postgresql://url-user:url-pass@db/url-db")
    monkeypatch.setenv("SA_DB_HOST", "ignored-host")
    monkeypatch.setenv("SA_DB_USER", "ignored-user")

    assert Settings().postgres_conninfo() == (
        "postgresql://url-user:url-pass@db/url-db"
    )


def test_postgres_components_include_username_and_password(monkeypatch):
    clear_postgres_env(monkeypatch)
    monkeypatch.setenv("SA_DB_HOST", "db.internal")
    monkeypatch.setenv("SA_DB_PORT", "5433")
    monkeypatch.setenv("SA_DB_NAME", "solar")
    monkeypatch.setenv("SA_DB_USER", "solar_user")
    monkeypatch.setenv("SA_DB_PASSWORD", "p@ss:/word")

    assert Settings().postgres_conninfo() == {
        "host": "db.internal",
        "port": "5433",
        "dbname": "solar",
        "user": "solar_user",
        "password": "p@ss:/word",
    }


def test_standard_postgres_username_and_password_aliases(monkeypatch):
    clear_postgres_env(monkeypatch)
    monkeypatch.setenv("POSTGRES_HOST", "postgres")
    monkeypatch.setenv("POSTGRES_DB", "solar")
    monkeypatch.setenv("POSTGRES_USERNAME", "solar_user")
    monkeypatch.setenv("POSTGRES_PASSWORD", "secret")

    assert Settings().postgres_conninfo() == {
        "host": "postgres",
        "dbname": "solar",
        "user": "solar_user",
        "password": "secret",
    }


def test_no_postgres_host_or_url_keeps_sqlite(monkeypatch):
    clear_postgres_env(monkeypatch)

    assert Settings().postgres_conninfo() is None


def test_build_energy_store_passes_component_conninfo(monkeypatch, tmp_path):
    conninfo = {
        "host": "db",
        "dbname": "solar",
        "user": "solar_user",
        "password": "secret",
    }
    captured = {}

    class FakePostgresBackend(energy_store.EnergyDB):
        def __init__(self, value):
            captured["conninfo"] = value

        def init_schema(self):
            pass

        def purge_before(self, cutoff):
            pass

        def load_daily(self, cutoff):
            return []

        def load_state(self):
            return []

        def fetch_summary(self, day):
            return []

        def fetch_series(self, day):
            return []

        def write(self, daily_rows, state_rows, sample_rows):
            pass

        def close(self):
            pass

    class FakeSettings:
        energy_db_path = Path(tmp_path / "energy.sqlite3")
        timezone = "UTC"
        energy_retention_days = 400

        @staticmethod
        def postgres_conninfo():
            return conninfo

    monkeypatch.setattr(energy_store, "PostgresBackend", FakePostgresBackend)
    store = energy_store.build_energy_store(FakeSettings())

    assert captured["conninfo"] == conninfo
    assert isinstance(store.db, FakePostgresBackend)
    store.close()
