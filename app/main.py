import redis
from fastapi import FastAPI

from app.config import settings

app = FastAPI(title="Task Queue & Rate-Limited Gateway")

redis_client = redis.Redis.from_url(settings.redis_url, decode_responses=True)


@app.get("/health")
def health():
    redis_ok = redis_client.ping()
    return {"status": "ok", "redis": redis_ok}