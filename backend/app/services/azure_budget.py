"""Bounded, thread-safe admission control for work that can call Azure.

This is distinct from the outbound NCBI/Crossref pacing limiter. Admission never
sleeps: callers either reserve one token or receive the time until retry. Cache
lookups happen before admission, and callers charge once for each new workflow,
not once per paper in that workflow.
"""

import math
import time
from collections import OrderedDict
from collections.abc import Callable
from dataclasses import dataclass
from threading import Lock
from typing import Literal

from app.config import Settings

Operation = Literal["normalization", "overview"]


class RateLimitExceeded(Exception):
    def __init__(self, retry_after: int) -> None:
        super().__init__("Too many research requests. Please try again shortly.")
        self.retry_after = retry_after


@dataclass
class _Bucket:
    tokens: float
    updated: float


class TokenBuckets:
    """One pool of independent client buckets, with bounded retained identities.

    Fully refilled, idle buckets can safely be forgotten. Active buckets are never
    evicted to admit a new identity: that would reset a client's spent budget.
    At capacity, unknown identities are rejected until an idle entry can expire.
    The lock covers check/refill/debit so sync and async routes share one budget.
    """

    def __init__(
        self, per_minute: float, burst: int, max_clients: int,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        if not math.isfinite(per_minute) or per_minute <= 0:
            raise ValueError("per_minute must be finite and positive")
        if burst <= 0 or max_clients <= 0:
            raise ValueError("burst and max_clients must be positive")
        self.refill_per_second = per_minute / 60
        self.burst = burst
        self.max_clients = max_clients
        self._clock = clock
        self._lock = Lock()
        self._buckets: OrderedDict[str, _Bucket] = OrderedDict()

    def consume(self, identity: str) -> None:
        with self._lock:
            now = self._clock()
            full_refill = self.burst / self.refill_per_second
            # Ordered by last access. Waiting a full refill period guarantees an
            # entry has no debt, including entries that were last seen denied.
            while self._buckets:
                oldest = next(iter(self._buckets.values()))
                if now - oldest.updated < full_refill:
                    break
                self._buckets.popitem(last=False)

            bucket = self._buckets.get(identity)
            if bucket is None:
                if len(self._buckets) >= self.max_clients:
                    oldest = next(iter(self._buckets.values()))
                    raise RateLimitExceeded(max(1, math.ceil(full_refill - (now - oldest.updated))))
                bucket = _Bucket(float(self.burst), now)
                self._buckets[identity] = bucket

            # A monotonic clock is expected. A backwards test/custom clock must
            # not create tokens or move the recorded timestamp backwards.
            elapsed = max(0.0, now - bucket.updated)
            bucket.tokens = min(float(self.burst), bucket.tokens + elapsed * self.refill_per_second)
            bucket.updated = max(now, bucket.updated)
            self._buckets.move_to_end(identity)
            if bucket.tokens < 1:
                raise RateLimitExceeded(max(1, math.ceil((1 - bucket.tokens) / self.refill_per_second)))
            bucket.tokens -= 1


class AzureBudgets:
    def __init__(self, settings: Settings, clock: Callable[[], float] = time.monotonic) -> None:
        self.enabled = settings.azure_rate_limit_enabled
        self._pools = {
            "normalization": TokenBuckets(
                settings.azure_normalization_per_minute, settings.azure_normalization_burst,
                settings.azure_rate_limit_max_clients, clock,
            ),
            "overview": TokenBuckets(
                settings.azure_overview_per_minute, settings.azure_overview_burst,
                settings.azure_rate_limit_max_clients, clock,
            ),
        }

    def consume(self, operation: Operation, identity: str) -> None:
        if self.enabled:
            self._pools[operation].consume(identity)
