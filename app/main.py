import redis
from celery.result import AsyncResult
from fastapi import Depends, FastAPI

from pathlib import Path

from fastapi import Depends, FastAPI, Request
from app.rate_limiter import peek_bucket, rate_limit

from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app.celery_app import celery_app
from app.config import settings
from app.rate_limiter import rate_limit
from app.schemas import JobRequest, JobStatusResponse, JobSubmitResponse
from app.tasks import process_job

app = FastAPI(title="Task Queue & Rate-Limited Gateway")

STATIC_DIR = Path(__file__).resolve().parent / "static"
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


@app.get("/", include_in_schema=False)
def dashboard():
    return FileResponse(STATIC_DIR / "index.html")

redis_client = redis.Redis.from_url(settings.redis_url, decode_responses=True)
broker_client = redis.Redis.from_url(settings.celery_broker_url, decode_responses=True)


def _stats(values):
    """Summarize a list of seconds."""
    if not values:
        return {"count": 0, "avg": None, "p50": None, "p95": None, "max": None}
    v = sorted(float(x) for x in values)

    def pct(p):
        return v[min(len(v) - 1, int(len(v) * p))]

    return {
        "count": len(v),
        "avg": round(sum(v) / len(v), 3),
        "p50": round(pct(0.50), 3),
        "p95": round(pct(0.95), 3),
        "max": round(v[-1], 3),
    }


@app.get("/health")
def health():
    redis_ok = redis_client.ping()
    return {"status": "ok", "redis": redis_ok}


@app.get("/metrics")
@app.get("/rate-limit/status")
def rate_limit_status(request: Request):
    return peek_bucket(request)
def metrics():
    counters = redis_client.hgetall("metrics:counters")
    return {
        "queue_depth": broker_client.llen("celery"),
        "tasks": {
            "completed": int(counters.get("completed", 0)),
            "failed": int(counters.get("failed", 0)),
            "retried": int(counters.get("retried", 0)),
        },
        "queue_wait_seconds": _stats(redis_client.lrange("metrics:wait_times", 0, -1)),
        "run_time_seconds": _stats(redis_client.lrange("metrics:run_times", 0, -1)),
    }


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