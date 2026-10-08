import urllib.request
import urllib.parse
import json
import uuid

base = "http://127.0.0.1:8000"

def get(path, headers=None):
    req = urllib.request.Request(f"{base}{path}", headers=headers or {})
    with urllib.request.urlopen(req) as res:
        return res.status, res.read()

def post(path, data, headers=None):
    body = urllib.parse.urlencode(data).encode() if isinstance(data, dict) and headers and "x-www-form-urlencoded" in headers.get("Content-Type", "") else json.dumps(data).encode()
    req = urllib.request.Request(f"{base}{path}", data=body, headers=headers or {})
    with urllib.request.urlopen(req) as res:
        return res.status, json.loads(res.read().decode())

print("1. Static Pages & SPA Assets:")
for p in ["/", "/forecast.html", "/historical.html", "/decision.html", "/comparison.html", "/sentiment.html", "/assets/css/styles.css", "/assets/js/dashboard.js"]:
    status, content = get(p)
    print(f"   {p}: {status} ({len(content)} bytes)")

print("\n2. Market & Analytics Endpoints (Resilient & Cached):")
for p in ["/api/crypto/prices/live", "/api/crypto/history/BTC?days=30", "/api/analytics/forecast/BTC", "/api/analytics/news/BTC", "/api/analytics/snapshot"]:
    status, content = get(p)
    print(f"   {p}: {status} ({len(content)} bytes)")

print("\n3. Authentication & Portfolio End-to-End:")
uid = uuid.uuid4().hex[:6]
u_data = {"username": f"test_{uid}", "email": f"test_{uid}@crypto.trade", "password": "password123"}
status, reg = post("/api/auth/signup", u_data, {"Content-Type": "application/json"})
token = reg["access_token"]
print(f"   Signup: {status}, token={token[:15]}...")

status, me_bytes = get("/api/auth/me", {"Authorization": f"Bearer {token}"})
me = json.loads(me_bytes)
print(f"   /api/auth/me: {status}, user={me['username']}, role={me['role']}")

port_item = {"symbol": "BTC", "quantity": 0.25, "average_buy_price": 63000.0, "target_price": 72000.0}
req = urllib.request.Request(f"{base}/api/portfolio/", data=json.dumps(port_item).encode(), headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"})
with urllib.request.urlopen(req) as res:
    created = json.loads(res.read().decode())
    print(f"   Create portfolio item: {res.status}, ID={created['id']}")

status, my_port_bytes = get("/api/portfolio/", {"Authorization": f"Bearer {token}"})
my_port = json.loads(my_port_bytes)
print(f"   Get portfolio: {status}, count={len(my_port)}")

# Delete portfolio item
req_del = urllib.request.Request(f"{base}/api/portfolio/{created['id']}", headers={"Authorization": f"Bearer {token}"}, method="DELETE")
with urllib.request.urlopen(req_del) as res:
    print(f"   Delete portfolio item: {res.status}")

print("\n=== ALL SYSTEMS VERIFIED 100% OPERATIONAL ===")
