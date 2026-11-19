from typing import Any, Optional

from pydantic import BaseModel, Field


class JobRequest(BaseModel):
    job_name: str = Field(..., min_length=1, max_length=100)
    duration: int = Field(default=10, ge=1, le=60)


class JobSubmitResponse(BaseModel):
    job_id: str
    status: str


class JobStatusResponse(BaseModel):
    job_id: str
    status: str
    result: Optional[Any] = None