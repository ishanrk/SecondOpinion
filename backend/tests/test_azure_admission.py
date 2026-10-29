"""Verify rejection happens before Azure work and preserves cheap cached paths."""

import asyncio

import httpx2 as httpx
import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import app, create_app
from app.models.claims import ClaimCandidates
from app.routers import normalization
from app.services import research_overview as overview
from app.services.azure_budget import AzureBudgets, RateLimitExceeded
from app.services.normalization import FoundryUnavailableError
from tests.helpers import FakeClock
from tests.test_claims import api, calls, cache, NORMALIZED
from tests.test_research_overview import clean_overview_caches, fake_generator


@pytest.fixture
def limited(monkeypatch):
    clock = FakeClock()
    budgets = AzureBudgets(Settings(
        _env_file=None, azure_normalization_per_minute=6, azure_normalization_burst=1,
        azure_overview_per_minute=2, azure_overview_burst=1,
    ), clock)
    monkeypatch.setattr(app.state, 'azure_budgets', budgets)
    monkeypatch.setattr(normalization, 'normalize_claim', lambda _: NORMALIZED)
    return clock


def test_normalize_burst_has_retry_header_and_no_extra_provider_call(limited, monkeypatch):
    calls = []
    monkeypatch.setattr(normalization, 'normalize_claim', lambda text: calls.append(text) or NORMALIZED)
    client = TestClient(app)
    payload = {'raw_text': 'Does zinc prevent colds?'}
    assert client.post('/api/claims/normalize', json=payload).status_code == 200
    denied = client.post('/api/claims/normalize', json=payload)
    assert denied.status_code == 429
    assert denied.headers['retry-after'] == '10'
    assert set(denied.json()) == {'detail'}
    assert len(calls) == 1
    limited.now = 10
    assert client.post('/api/claims/normalize', json=payload).status_code == 200
    assert len(calls) == 2


def test_claims_and_normalize_share_a_budget(api, limited, calls):
    client = api()
    assert client.post('/api/claims/normalize', json={'raw_text': 'A health claim'}).status_code == 200
    denied = client.post('/api/claims', json={'claim': 'Does zinc prevent colds?'})
    assert denied.status_code == 429
    assert calls.external == 0


def test_cached_search_and_normalized_query_do_not_spend_tokens(api, limited, calls):
    client = api()
    payload = {'claim': 'Does zinc prevent colds?', 'limit': 3}
    assert client.post('/api/claims', json=payload).status_code == 200
    before = calls.external
    cached = client.post('/api/claims', json=payload)
    assert cached.status_code == 200 and cached.json()['cached']
    assert before == calls.external
    # A different limit needs retrieval, but the cached normalization avoids Azure.
    assert client.post('/api/claims', json={**payload, 'limit': 2}).status_code == 200
    assert calls.normalize == 1
    assert client.post('/api/claims/normalize', json={'raw_text': 'Another claim'}).status_code == 429


def test_refresh_and_new_wording_are_charged(api, limited, calls):
    client = api()
    payload = {'claim': 'Does zinc prevent colds?'}
    assert client.post('/api/claims', json=payload).status_code == 200
    before = calls.external
    assert client.post('/api/claims?refresh=true', json=payload).status_code == 429
    assert client.post('/api/claims', json={'claim': 'Will zinc help me avoid a cold?'}).status_code == 429
    assert calls.external == before
    limited.now = 10
    assert client.post('/api/claims?refresh=true', json=payload).status_code == 200
    assert calls.normalize == 2


def test_failed_normalization_still_consumes_budget(limited, monkeypatch):
    attempts = []
    def fail(text):
        attempts.append(text)
        raise FoundryUnavailableError('Provider unavailable')
    monkeypatch.setattr(normalization, 'normalize_claim', fail)
    client = TestClient(app)
    assert client.post('/api/claims/normalize', json={'raw_text': 'A health claim'}).status_code == 503
    assert client.post('/api/claims/normalize', json={'raw_text': 'A health claim'}).status_code == 429
    assert len(attempts) == 1


@pytest.mark.parametrize('raw', ['', '   ', 'x' * 2001])
def test_invalid_inputs_do_not_spend_budget(api, limited, raw):
    client = api()
    assert client.post('/api/claims/normalize', json={'raw_text': raw}).status_code == 422
    assert client.post('/api/claims', json={'claim': raw}).status_code == 422
    assert client.post('/api/claims/normalize', json={'raw_text': 'Valid health claim'}).status_code == 200


def test_disabled_setting_allows_repeated_requests(monkeypatch):
    monkeypatch.setattr(normalization, 'normalize_claim', lambda _: NORMALIZED)
    client = TestClient(app)
    for _ in range(10):
        assert client.post('/api/claims/normalize', json={'raw_text': 'A health claim'}).status_code == 200


def test_spoofed_forwarded_headers_do_not_change_peer_identity(limited):
    client = TestClient(app, client=('192.0.2.1', 1234))
    payload = {'raw_text': 'A health claim'}
    assert client.post('/api/claims/normalize', json=payload).status_code == 200
    response = client.post('/api/claims/normalize', json=payload, headers={
        'X-Forwarded-For': '198.51.100.1', 'Forwarded': 'for=198.51.100.1',
    })
    assert response.status_code == 429
    other = TestClient(app, client=('192.0.2.2', 1234))
    assert other.post('/api/claims/normalize', json=payload).status_code == 200


def test_overview_cache_is_free_and_distinct_work_is_limited(api, limited, monkeypatch):
    client = api()
    found = client.post('/api/claims', json={'claim': 'Does zinc prevent colds?', 'limit': 3}).json()
    result = ClaimCandidates.model_validate(found)
    generated = []
    monkeypatch.setattr(overview, 'generate', fake_generator(generated))
    path = '/api/claims/overview/' + found['analysis_id']
    assert client.post(path).status_code == 200
    cached = client.post(path)
    assert cached.status_code == 200 and cached.json()['cached']
    assert len(generated) == 4
    # New snapshot of the identical result also reuses completed work.
    assert client.post('/api/claims/overview/' + overview.register_snapshot(result)).status_code == 200
    result.claim = 'A different claim for the same sources'
    denied = client.post('/api/claims/overview/' + overview.register_snapshot(result))
    assert denied.status_code == 429 and denied.headers['retry-after'] == '30'
    assert len(generated) == 4
    assert result.candidates  # admission does not mutate/erase retrieved papers
    limited.now = 30
    assert client.post('/api/claims/overview/' + overview.register_snapshot(result)).status_code == 200


def test_expired_snapshot_does_not_spend_overview_budget(api, limited, monkeypatch):
    client = api()
    assert client.post('/api/claims/overview/not-a-token').status_code == 410
    found = client.post('/api/claims', json={'claim': 'Does zinc prevent colds?', 'limit': 3}).json()
    monkeypatch.setattr(overview, 'generate', fake_generator([]))
    assert client.post('/api/claims/overview/' + found['analysis_id']).status_code == 200


def test_concurrent_overview_requests_reserve_once(api, limited, monkeypatch):
    result = ClaimCandidates.model_validate(api().post(
        '/api/claims', json={'claim': 'Does zinc prevent colds?', 'limit': 3},
    ).json())
    generated = []
    monkeypatch.setattr(overview, 'generate', fake_generator(generated))
    admitted = []
    def reserve():
        admitted.append(True)
        app.state.azure_budgets.consume('overview', 'one')
    async def run():
        return await asyncio.gather(*(
            overview.shared_overview(result, before_start=reserve) for _ in range(8)
        ))
    outputs = asyncio.run(run())
    assert all(output == outputs[0] for output in outputs)
    assert len(admitted) == 1
    assert len(generated) == 4


def test_denial_does_not_leave_an_inflight_task(api, limited):
    result = ClaimCandidates.model_validate(api().post(
        '/api/claims', json={'claim': 'Does zinc prevent colds?', 'limit': 3},
    ).json())
    app.state.azure_budgets.consume('overview', 'one')
    async def run():
        with pytest.raises(RateLimitExceeded):
            await overview.shared_overview(result, before_start=lambda: app.state.azure_budgets.consume('overview', 'one'))
        assert overview.cache_key(result) not in overview.inflight
    asyncio.run(run())


def test_cors_exposes_retry_after_and_openapi_documents_429(limited):
    client = TestClient(app)
    payload = {'raw_text': 'A health claim'}
    client.post('/api/claims/normalize', json=payload)
    response = client.post('/api/claims/normalize', json=payload, headers={'Origin': 'http://localhost:5173'})
    assert response.status_code == 429
    assert response.headers['access-control-allow-origin'] == 'http://localhost:5173'
    assert 'Retry-After' in response.headers['access-control-expose-headers']
    schema = client.get('/openapi.json').json()
    for path in ('/api/claims', '/api/claims/normalize', '/api/claims/overview/{analysis_id}'):
        assert 'Retry-After' in schema['paths'][path]['post']['responses']['429']['headers']


def test_new_app_has_fresh_budgets(monkeypatch):
    import app.main as main
    monkeypatch.setattr(main, 'get_settings', lambda: Settings(_env_file=None, azure_normalization_burst=1))
    first, second = create_app(), create_app()
    first.state.azure_budgets.consume('normalization', 'same')
    with pytest.raises(RateLimitExceeded):
        first.state.azure_budgets.consume('normalization', 'same')
    second.state.azure_budgets.consume('normalization', 'same')
