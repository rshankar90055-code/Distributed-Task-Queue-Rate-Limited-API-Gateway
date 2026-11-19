import uuid

import pytest
from fastapi.testclient import TestClient

import app.main as main
from app.main import app

client = TestClient(app)


class FakeTask:
    id = "fake-task-id"


@pytest.fixture
def fresh_key():
    """A unique API key per test, so each test gets a fresh rate-limit bucket."""
    return {"X-API-Key": f"test-{uuid.uuid4()}"}


def test_health():
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json()["redis"] is True


def test_submit_job_returns_202_and_job_id(monkeypatch, fresh_key):
    # Replace the real queue call so this test doesn't need a worker
    monkeypatch.setattr(main.process_job, "delay", lambda *a, **k: FakeTask())

    r = client.post("/jobs", json={"job_name": "t", "duration": 1}, headers=fresh_key)
    assert r.status_code == 202
    assert r.json() == {"job_id": "fake-task-id", "status": "queued"}


def test_submit_job_validation(fresh_key):
    r = client.post("/jobs", json={"job_name": "t", "duration": 999}, headers=fresh_key)
    assert r.status_code == 422


def test_rate_limit_blocks_after_burst(fresh_key):
    codes = [
        client.get("/jobs/some-id", headers=fresh_key).status_code for _ in range(12)
    ]
    assert codes[:10] == [200] * 10   # burst capacity
    assert 429 in codes[10:]          # then blocked


def test_rate_limit_is_per_client():
    a = {"X-API-Key": f"a-{uuid.uuid4()}"}
    b = {"X-API-Key": f"b-{uuid.uuid4()}"}
    for _ in range(12):
        client.get("/jobs/x", headers=a)
    assert client.get("/jobs/x", headers=a).status_code == 429
    assert client.get("/jobs/x", headers=b).status_code == 200


def test_429_has_retry_after_header(fresh_key):
    for _ in range(11):
        r = client.get("/jobs/x", headers=fresh_key)
    assert r.status_code == 429
    assert "retry-after" in r.headers


def test_metrics_shape():
    data = client.get("/metrics").json()
    assert "queue_depth" in data
    assert set(data["tasks"]) == {"completed", "failed", "retried"}
    assert "p95" in data["queue_wait_seconds"]