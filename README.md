# Distributed Task Queue & Rate-Limited API Gateway

A FastAPI gateway that moves heavy work to background Celery workers and
limits how fast each client can send requests.

![Dashboard](docs/dashboard.png)

**Live demo UI:** open http://127.0.0.1:8000/ after starting the stack.

## Problem

Heavy jobs block API requests, and one noisy client can overload downstream
services. This project queues slow work and rate-limits each client.

## Architecture

```
Client -> FastAPI (rate limiter) -> Redis queue -> Celery workers
                |                                       |
                +------- /metrics <---- Redis <---------+
```

- **FastAPI gateway** accepts requests and returns a job ID immediately (HTTP 202).
- **Redis** serves as the message broker, result store, and rate-limit store.
- **Celery workers** process jobs asynchronously.
- **Token-bucket rate limiter** runs as an atomic Lua script in Redis, per client.
- **Retry with exponential backoff and jitter** recovers failed jobs automatically.
- **Monitoring endpoint** reports queue depth, queue wait time, and run time.
- **Docker Compose** runs the whole stack with one command.

## Tech stack

Python, FastAPI, Celery, Redis, Docker, pytest

## Quick start

```bash
git clone https://github.com/YOUR_USERNAME/taskqueue-gateway.git
cd taskqueue-gateway
docker compose up --build
```

- API docs: http://127.0.0.1:8000/docs
- Health: http://127.0.0.1:8000/health
- Metrics: http://127.0.0.1:8000/metrics

## API

| Method | Path | Description |
|---|---|---|
| POST | `/jobs` | Queue a job. Returns `202` with a `job_id`. |
| GET | `/jobs/{job_id}` | Get job status and result. |
| GET | `/metrics` | Queue depth, task counters, wait and run-time stats. |
| GET | `/health` | Service and Redis health. |
| GET | `/` | Live dashboard (metrics chart, job tracker, token-bucket visual). |

Example:

```bash
curl -X POST http://127.0.0.1:8000/jobs \
  -H "Content-Type: application/json" \
  -H "X-API-Key: my-client" \
  -d '{"job_name": "report", "duration": 5}'
```

`fail_rate` (0 to 1) is an optional field that makes a job fail randomly, to
demonstrate retries.

## Rate limiting

Each client (identified by the `X-API-Key` header, or IP address if absent)
gets a token bucket: bursts of up to 10 requests, then 1 request per second
sustained. Excess requests receive `429 Too Many Requests` with a
`Retry-After` header. Limits are configurable in `app/config.py`.

The bucket logic runs as a Lua script inside Redis, so concurrent requests
cannot race each other.

## Reliability

Failed jobs retry automatically with exponential backoff (2s, 4s, 8s, ...,
capped at 60s) plus jitter, up to 5 retries. Tasks acknowledge late, so a
crashed worker does not lose its job.

## Dashboard

A dependency-free UI (HTML, CSS, JavaScript and Chart.js) served by FastAPI:

- Live queue depth, completed, retried and failed counters
- Rolling queue-depth chart and latency bars (avg, p50, p95, max)
- Job submission with presets (quick, heavy, flaky, doomed) and a live tracker
- Token-bucket visual with a burst test that shows 429 responses

## Running tests

Requires Redis on localhost:6379 (`docker compose up -d redis`).

```bash
pip install -r requirements.txt
pytest -v
```

## Project structure

```
app/
  static/          Dashboard (index.html, styles.css, app.js)
  main.py          API routes
  celery_app.py    Celery configuration
  tasks.py         Background tasks with retry policy
  rate_limiter.py  Token-bucket limiter (Redis + Lua)
  metrics.py       Celery signal handlers recording latency
  config.py        Settings
  schemas.py       Request/response models
tests/             pytest suite
scripts/           Manual rate-limit demo
Dockerfile
docker-compose.yml
```
docs/              Screenshots

## Possible improvements

- Authentication and per-plan rate limits
- Prometheus and Grafana dashboards
- Dead-letter queue for permanently failed jobs
- Horizontal scaling with multiple worker replicas