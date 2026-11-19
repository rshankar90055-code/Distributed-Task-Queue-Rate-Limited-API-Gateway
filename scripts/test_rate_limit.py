import time

import httpx

URL = "http://127.0.0.1:8000/jobs/test-id"


def hit(label, headers=None):
    r = httpx.get(URL, headers=headers or {})
    print(
        f"{label}: {r.status_code} "
        f"remaining={r.headers.get('X-RateLimit-Remaining')} "
        f"retry_after={r.headers.get('Retry-After')}"
    )


print("--- Burst of 15 requests from client A ---")
for i in range(15):
    hit(f"A #{i + 1}", {"X-API-Key": "client-a"})

print("\n--- Client B is unaffected ---")
hit("B #1", {"X-API-Key": "client-b"})

print("\n--- Waiting 5 seconds for client A to refill ---")
time.sleep(5)
for i in range(7):
    hit(f"A after wait #{i + 1}", {"X-API-Key": "client-a"})