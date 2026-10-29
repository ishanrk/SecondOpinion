"""HTTP boundary for the process-local Azure admission budgets."""

from collections.abc import Callable
from functools import partial
from ipaddress import ip_address

from fastapi import Request

from app.services.azure_budget import Operation

RATE_LIMIT_RESPONSE = {
    "description": "Too many Azure-producing requests from this client; retry after the indicated delay",
    "headers": {"Retry-After": {
        "description": "Whole seconds until another request may be admitted",
        "schema": {"type": "integer", "minimum": 1},
    }},
}


def admission(request: Request, operation: Operation) -> Callable[[], None]:
    # Uvicorn may replace request.client only for explicitly trusted proxies.
    # Never parse X-Forwarded-For/Forwarded here: direct callers can forge them.
    identity = request.client.host if request.client else "unknown-client"
    try:
        identity = str(ip_address(identity))
    except ValueError:
        pass  # ASGI test clients and non-IP transports can have named peers.
    return partial(request.app.state.azure_budgets.consume, operation, identity)
