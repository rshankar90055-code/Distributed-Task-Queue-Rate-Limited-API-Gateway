import time

import redis
from fastapi import HTTPException, Request, Response

from app.config import settings

redis_client = redis.Redis.from_url(settings.redis_url, decode_responses=True)

TOKEN_BUCKET_LUA = """
local key = KEYS[1]
local capacity = tonumber(ARGV[1])
local refill_rate = tonumber(ARGV[2])
local now = tonumber(ARGV[3])
local requested = tonumber(ARGV[4])

local data = redis.call("HMGET", key, "tokens", "timestamp")
local tokens = tonumber(data[1])
local timestamp = tonumber(data[2])

if tokens == nil then
    tokens = capacity
    timestamp = now
end

local elapsed = math.max(0, now - timestamp)
tokens = math.min(capacity, tokens + elapsed * refill_rate)

local allowed = 0
local retry_after = 0
if tokens >= requested then
    tokens = tokens - requested
    allowed = 1
else
    retry_after = (requested - tokens) / refill_rate
end

redis.call("HSET", key, "tokens", tokens, "timestamp", now)
redis.call("EXPIRE", key, math.ceil(capacity / refill_rate) * 2)

return {allowed, tostring(tokens), tostring(retry_after)}
"""

_token_bucket = redis_client.register_script(TOKEN_BUCKET_LUA)


def get_client_id(request: Request) -> str:
    """Identify the client by API key if given, otherwise by IP address."""
    api_key = request.headers.get("X-API-Key")
    if api_key:
        return f"key:{api_key}"
    host = request.client.host if request.client else "unknown"
    return f"ip:{host}"


def rate_limit(request: Request, response: Response) -> None:
    """FastAPI dependency: consumes 1 token or raises 429."""
    client_id = get_client_id(request)

    allowed, tokens, retry_after = _token_bucket(
        keys=[f"ratelimit:{client_id}"],
        args=[
            settings.rate_limit_capacity,
            settings.rate_limit_refill_rate,
            time.time(),
            1,
        ],
    )

    response.headers["X-RateLimit-Limit"] = str(settings.rate_limit_capacity)
    response.headers["X-RateLimit-Remaining"] = str(int(float(tokens)))

    if not int(allowed):
        wait = max(1, int(float(retry_after)) + 1)
        raise HTTPException(
            status_code=429,
            detail="Rate limit exceeded. Slow down.",
            headers={
                "Retry-After": str(wait),
                "X-RateLimit-Limit": str(settings.rate_limit_capacity),
                "X-RateLimit-Remaining": "0",
            },
        )
def peek_bucket(request: Request) -> dict:
    """Return the bucket state without consuming a token (requests 0 tokens)."""
    client_id = get_client_id(request)
    _, tokens, _ = _token_bucket(
        keys=[f"ratelimit:{client_id}"],
        args=[
            settings.rate_limit_capacity,
            settings.rate_limit_refill_rate,
            time.time(),
            0,
        ],
    )
    return {
        "client": client_id,
        "capacity": settings.rate_limit_capacity,
        "refill_rate": settings.rate_limit_refill_rate,
        "tokens": float(tokens),
    }