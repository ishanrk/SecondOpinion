from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field, field_validator

from app.routers.budgets import admission, RATE_LIMIT_RESPONSE

from app.models.normalization import NormalizedClaim
from app.services.normalization import (
    ClaimNormalizationError, FoundryUnavailableError, normalize_claim,
)

router = APIRouter(prefix="/claims", tags=["claims"])


class NormalizeRequest(BaseModel):
    raw_text: str = Field(min_length=1, max_length=2000)

    @field_validator("raw_text")
    @classmethod
    def nonblank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("Enter one health claim")
        return value.strip()


@router.post("/normalize", responses={429: RATE_LIMIT_RESPONSE})
def normalize(request: NormalizeRequest, http_request: Request) -> NormalizedClaim:
    admission(http_request, "normalization")()
    try:
        return normalize_claim(request.raw_text)
    except ClaimNormalizationError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from None
    except FoundryUnavailableError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from None
