import asyncio
import sys

import pytest


def pytest_configure():
    # Psycopg async connections require a selector loop on Windows. This also
    # covers asyncio.run() and the separate loops created by ASGI TestClient.
    if sys.platform == "win32":
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())


@pytest.fixture
def anyio_backend() -> str:
    return "asyncio"


@pytest.fixture(autouse=True)
def isolated_azure_budget(monkeypatch):
    """Most tests exercise other behavior; admission tests opt in explicitly."""
    from app.config import Settings
    from app.main import app
    from app.services.azure_budget import AzureBudgets
    monkeypatch.setattr(app.state, "azure_budgets", AzureBudgets(
        Settings(_env_file=None, azure_rate_limit_enabled=False),
    ))
