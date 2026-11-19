from celery import Celery

from app.config import settings

celery_app = Celery(
    "taskqueue",
    broker=settings.celery_broker_url,
    backend=settings.celery_result_backend,
    include=["app.tasks"],
)

celery_app.conf.update(
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    task_track_started=True,
    result_expires=3600,
    worker_prefetch_multiplier=1,
    task_acks_late=True,
)
import app.metrics  # noqa: E402,F401  (registers the signal handlers)