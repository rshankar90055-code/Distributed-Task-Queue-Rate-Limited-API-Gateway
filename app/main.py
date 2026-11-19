import redis
from celery.result import AsyncResult
from fastapi import Depends, FastAPI

from app.celery_app import celery_app
from app.config import settings
from app.rate_limiter import rate_limit
from app.schemas import JobRequest, JobStatusResponse, JobSubmitResponse
from app.tasks import process_job

app = FastAPI(title="Task Queue & Rate-Limited Gateway")

redis_client = redis.Redis.from_url(settings.redis_url, decode_responses=True)


@app.get("/health")
def health():
    redis_ok = redis_client.ping()
    return {"status": "ok", "redis": redis_ok}


@app.post(
    "/jobs",
    response_model=JobSubmitResponse,
    status_code=202,
    dependencies=[Depends(rate_limit)],
)
def submit_job(job: JobRequest):
    task = process_job.delay(job.job_name, job.duration, job.fail_rate)
    return JobSubmitResponse(job_id=task.id, status="queued")


@app.get(
    "/jobs/{job_id}",
    response_model=JobStatusResponse,
    dependencies=[Depends(rate_limit)],
)
def get_job_status(job_id: str):
    task = AsyncResult(job_id, app=celery_app)
    result = task.result if task.successful() else None
    return JobStatusResponse(job_id=job_id, status=task.status, result=result)