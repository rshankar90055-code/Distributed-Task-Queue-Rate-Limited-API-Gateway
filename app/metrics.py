import time

import redis
from celery.signals import (
    before_task_publish,
    task_failure,
    task_postrun,
    task_prerun,
    task_retry,
    task_success,
)

from app.config import settings

r = redis.Redis.from_url(settings.redis_url, decode_responses=True)

MAX_SAMPLES = 1000
_start_times: dict = {}


def _safe(fn):
    """Metrics must never break a real task, so swallow Redis errors."""
    def wrapper(*args, **kwargs):
        try:
            fn(*args, **kwargs)
        except Exception:
            pass
    return wrapper


@before_task_publish.connect
@_safe
def on_publish(headers=None, **kwargs):
    headers= headers or {}
    task_id = headers.get("id")
    if not task_id:
        return
    r.set(f"metrics:published:{task_id}", time.time(), ex=3600)


@task_prerun.connect
@_safe
def on_start(task_id=None, **kwargs):
    now = time.time()
    _start_times[task_id] = now
    published = r.get(f"metrics:published:{task_id}")
    if published:
        r.lpush("metrics:wait_times", now - float(published))
        r.ltrim("metrics:wait_times", 0, MAX_SAMPLES - 1)


@task_postrun.connect
@_safe
def on_finish(task_id=None, **kwargs):
    started = _start_times.pop(task_id, None)
    if started:
        r.lpush("metrics:run_times", time.time() - started)
        r.ltrim("metrics:run_times", 0, MAX_SAMPLES - 1)


@task_success.connect
@_safe
def on_success(**kwargs):
    r.hincrby("metrics:counters", "completed", 1)


@task_failure.connect
@_safe
def on_failure(**kwargs):
    r.hincrby("metrics:counters", "failed", 1)


@task_retry.connect
@_safe
def on_retry(**kwargs):
    r.hincrby("metrics:counters", "retried", 1)