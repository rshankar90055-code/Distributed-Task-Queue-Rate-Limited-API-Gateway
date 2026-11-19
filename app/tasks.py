import random
import time

from app.celery_app import celery_app


class TransientError(Exception):
    """A temporary failure that is worth retrying."""


@celery_app.task(
    name="process_job",
    bind=True,
    autoretry_for=(TransientError,),
    retry_backoff=2,          # wait 2s, 4s, 8s, ...
    retry_backoff_max=60,     # never wait more than 60s
    retry_jitter=True,        # randomize the wait a little
    retry_kwargs={"max_retries": 5},
)
def process_job(self, job_name: str, duration: int = 10, fail_rate: float = 0.0) -> dict:
    """Simulates a heavy job. fail_rate (0 to 1) randomly causes failures for testing."""
    attempt = self.request.retries + 1
    print(f"[{job_name}] attempt {attempt}")

    time.sleep(duration)

    if random.random() < fail_rate:
        raise TransientError(f"{job_name} failed on attempt {attempt}")

    return {
        "job_name": job_name,
        "duration": duration,
        "status": "completed",
        "attempts": attempt,
    }