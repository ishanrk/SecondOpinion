"""No wall-clock sleeps or live service calls are needed to test admission."""

from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

import pytest
from pydantic import ValidationError

from app.config import Settings
from app.services.azure_budget import AzureBudgets, RateLimitExceeded, TokenBuckets
from tests.helpers import FakeClock


def test_initial_burst_is_allowed_then_denied():
    pool = TokenBuckets(6, 6, 100, FakeClock())
    for _ in range(6):
        pool.consume('one-client')
    with pytest.raises(RateLimitExceeded) as error:
        pool.consume('one-client')
    assert error.value.retry_after == 10


def test_refill_boundary_and_no_over_credit():
    clock = FakeClock()
    pool = TokenBuckets(6, 1, 100, clock)
    pool.consume('one')
    clock.now = 9.9
    with pytest.raises(RateLimitExceeded) as error:
        pool.consume('one')
    assert error.value.retry_after == 1
    clock.now = 10
    pool.consume('one')
    with pytest.raises(RateLimitExceeded):
        pool.consume('one')
    clock.now = 10000
    pool.consume('one')
    with pytest.raises(RateLimitExceeded):
        pool.consume('one')


def test_clients_have_independent_budgets():
    pool = TokenBuckets(1, 1, 100, FakeClock())
    pool.consume('one')
    pool.consume('two')
    with pytest.raises(RateLimitExceeded):
        pool.consume('one')
    with pytest.raises(RateLimitExceeded):
        pool.consume('two')


def test_backwards_clock_cannot_mint_tokens():
    clock = FakeClock()
    clock.now = 100
    pool = TokenBuckets(60, 1, 100, clock)
    pool.consume('one')
    clock.now = 50
    with pytest.raises(RateLimitExceeded):
        pool.consume('one')
    clock.now = 100
    with pytest.raises(RateLimitExceeded):
        pool.consume('one')
    clock.now = 101
    pool.consume('one')


def test_capacity_rejects_unknown_identities_without_resetting_existing_debt():
    clock = FakeClock()
    pool = TokenBuckets(60, 2, 2, clock)
    pool.consume('one')
    pool.consume('one')
    pool.consume('two')
    with pytest.raises(RateLimitExceeded) as error:
        pool.consume('three')
    assert error.value.retry_after == 2
    with pytest.raises(RateLimitExceeded):
        pool.consume('one')
    clock.now = 1
    pool.consume('one')  # known clients can still spend a refilled token
    with pytest.raises(RateLimitExceeded):
        pool.consume('three')
    clock.now = 2
    pool.consume('three')  # the idle second client can now be forgotten
    pool.consume('one')  # exactly one token refilled since its last debit
    with pytest.raises(RateLimitExceeded):
        pool.consume('one')  # pruning a different client did not reset its debt


def test_idle_identities_are_pruned_and_burst_is_restored():
    clock = FakeClock()
    pool = TokenBuckets(60, 3, 2, clock)
    pool.consume('one')
    pool.consume('two')
    clock.now = 3
    pool.consume('three')
    assert list(pool._buckets) == ['three']
    for _ in range(3):
        pool.consume('one')
    assert len(pool._buckets) == 2
    with pytest.raises(RateLimitExceeded):
        pool.consume('one')


def test_concurrent_threads_cannot_overspend_the_burst():
    pool = TokenBuckets(1, 4, 100, FakeClock())
    barrier = Barrier(16)
    def reserve(_):
        barrier.wait()
        try:
            pool.consume('shared-client')
            return True
        except RateLimitExceeded:
            return False
    with ThreadPoolExecutor(max_workers=16) as executor:
        results = list(executor.map(reserve, range(16)))
    assert sum(results) == 4


def test_operation_budgets_are_independent():
    settings = Settings(_env_file=None, azure_normalization_burst=1, azure_overview_burst=1)
    budgets = AzureBudgets(settings, FakeClock())
    budgets.consume('normalization', 'one')
    budgets.consume('overview', 'one')
    for operation in ('normalization', 'overview'):
        with pytest.raises(RateLimitExceeded):
            budgets.consume(operation, 'one')


def test_disabled_setting_does_not_retain_client_state():
    budgets = AzureBudgets(Settings(_env_file=None, azure_rate_limit_enabled=False), FakeClock())
    for i in range(100):
        budgets.consume('normalization', str(i))
        budgets.consume('overview', str(i))
    assert all(not pool._buckets for pool in budgets._pools.values())


@pytest.mark.parametrize('name', [
    'azure_normalization_per_minute', 'azure_normalization_burst',
    'azure_overview_per_minute', 'azure_overview_burst', 'azure_rate_limit_max_clients',
])
@pytest.mark.parametrize('value', [0, -1])
def test_invalid_settings_fail_at_startup(name, value):
    with pytest.raises(ValidationError):
        Settings(_env_file=None, **{name: value})


@pytest.mark.parametrize('value', [float('inf'), float('-inf'), float('nan')])
def test_nonfinite_rates_are_rejected(value):
    with pytest.raises(ValidationError):
        Settings(_env_file=None, azure_normalization_per_minute=value)
    with pytest.raises(ValueError):
        TokenBuckets(value, 1, 1)


def test_settings_read_environment(monkeypatch):
    monkeypatch.setenv('AZURE_RATE_LIMIT_ENABLED', 'false')
    monkeypatch.setenv('AZURE_NORMALIZATION_PER_MINUTE', '12')
    monkeypatch.setenv('AZURE_OVERVIEW_BURST', '3')
    settings = Settings(_env_file=None)
    assert settings.azure_rate_limit_enabled is False
    assert settings.azure_normalization_per_minute == 12
    assert settings.azure_overview_burst == 3
