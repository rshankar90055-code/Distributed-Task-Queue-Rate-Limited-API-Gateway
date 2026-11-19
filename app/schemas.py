from typing import Any, Optional

from pydantic import BaseModel, Field


class JobRequest(BaseModel):
    job_name: str = Field(..., min_length=1, max_length=100)
    duration: int = Field(default=10, ge=1, le=60)
    fail_rate: float = Field(default=0.0, ge=0.0, le=1.0)


class JobSubmitResponse(BaseModel):
    job_id: str
    status: str


class JobStatusResponse(BaseModel):
    job_id: str
    status: str
    result: Optional[Any] = None