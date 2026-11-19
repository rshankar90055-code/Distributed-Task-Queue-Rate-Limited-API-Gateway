import time

from app.celery_app import celery_app


@celery_app.task(name="process_job")
def process_job(job_name: str, duration: int = 10) -> dict:
    """Simulates a heavy job (report generation, video encoding, etc.)."""
    time.sleep(duration)
    return {"job_name": job_name, "duration": duration, "status": "completed"}