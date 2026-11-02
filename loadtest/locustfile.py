"""Load test for the CAIC voucher system (Locust).

Simulates many people using the app at once and measures response times and errors.

    pip install locust
    locust -f loadtest/locustfile.py --host http://database.nyala-ordinal.ts.net/api

Then open http://localhost:8089, choose the number of users and how fast to add them, and start.
(Use --host http://database.nyala-ordinal.ts.net:8000 to test the backend directly.)

Settings (PowerShell: $env:NAME = "value" before running locust):

    LT_USER, LT_PASS              a normal (staff) test account       required
    LT_ADMIN, LT_ADMIN_PASS       an admin test account               optional (no admin users without it)
    LT_WRITE=1                    also add entries, to project LT_PROJECT (default "ZZ Load Test")
    LT_LIVE=0                     don't hold a live-updates connection per user (default: hold one)
    LT_ASSISTANT=1                include AssistantUser (questions to the AI model)
    LT_WAIT_MIN, LT_WAIT_MAX      seconds a user pauses between actions (default 5 and 30)

Each account signs in once per Locust process, and all simulated users of that kind share the
sign-in, so the test doesn't flood the Activity Log with sign-ins.
"""
import os
import random
import time
import uuid
from datetime import date
from urllib.parse import quote

import gevent
from locust import HttpUser, between, task

WAIT = between(float(os.getenv("LT_WAIT_MIN", "5")), float(os.getenv("LT_WAIT_MAX", "30")))
WRITE = os.getenv("LT_WRITE") == "1"
LIVE = os.getenv("LT_LIVE", "1") != "0"
TEST_PROJECT = os.getenv("LT_PROJECT", "ZZ Load Test")

ACCOUNTS = {
    "staff": (os.getenv("LT_USER"), os.getenv("LT_PASS")),
    "admin": (os.getenv("LT_ADMIN"), os.getenv("LT_ADMIN_PASS")),
}
_tokens = {}  # account kind -> sign-in token, shared by all simulated users of that kind



def _json(response):
    """The response's JSON, or None if it isn't JSON (e.g. a web page, because --host doesn't
    point at the backend). Reported as a failure where Locust allows it."""
    try:
        return response.json()
    except ValueError:
        if hasattr(response, "failure"):
            text = (response.text or "")[:80].replace("\n", " ")
            response.failure(f"not JSON ({response.status_code}, {response.headers.get('content-type', '?')}): {text}")
        return None

class AppUser(HttpUser):
    """What every simulated person does: sign in, keep a live connection, browse."""

    abstract = True
    wait_time = WAIT
    account = "staff"

    # ---------- sign-in ----------
    def _token(self, renew=False):
        if renew or self.account not in _tokens:
            username, password = ACCOUNTS[self.account]
            if not username or not password:
                raise RuntimeError(f"Set the {self.account} test account (see the top of locustfile.py).")
            with self.client.post("/token", data={"username": username, "password": password},
                                  name="/token (sign in)", catch_response=True) as r:
                if r.status_code != 200:
                    r.failure(f"sign-in failed: {r.status_code} {r.text[:120]}")
                    raise RuntimeError(f"Sign-in failed for {username}: {r.status_code}")
                data = _json(r)
                if not isinstance(data, dict) or "access_token" not in data:
                    raise RuntimeError(f"Sign-in for {username} didn't reach the backend: got "
                                       f"{r.headers.get('content-type', '?')} from {r.url}. Check that "
                                       "--host ends with /api (e.g. http://<server>/api).")
                _tokens[self.account] = data["access_token"]
        return _tokens[self.account]

    def _auth(self):
        return {"Authorization": f"Bearer {self._token()}"}

    def api(self, method, path, name=None, **kwargs):
        """A signed-in request. Signs in again once if the token expired (it lasts 30 minutes)."""
        response = self.client.request(method, path, headers=self._auth(), name=name or path, **kwargs)
        if response.status_code == 401:
            self._token(renew=True)
            response = self.client.request(method, path, headers=self._auth(), name=name or path, **kwargs)
        return response

    # ---------- lifecycle ----------
    def on_start(self):
        self._token()
        self._projects = []
        self._running = True
        self._live = gevent.spawn(self._hold_live) if LIVE else None

    def on_stop(self):
        self._running = False
        if self._live:
            self._live.kill(block=False)

    # ---------- live updates: one open connection per user, like an open browser tab ----------
    def _hold_live(self):
        while self._running:
            try:
                with self.client.get("/live", headers=self._auth(), stream=True, timeout=(10, 60),
                                     name="/live (connect)", catch_response=True) as r:
                    if r.status_code != 200:
                        r.failure(f"{r.status_code}")
                        gevent.sleep(5)
                        continue
                    r.success()
                    for _line in r.iter_lines():  # keep reading until the test stops
                        if not self._running:
                            return
            except Exception:
                if self._running:
                    gevent.sleep(5)

    # ---------- what the screens request ----------
    def open_dashboard(self):
        """Voucher Control, as the screens load it: the project list and the voucher list."""
        r = self.api("GET", "/projects", name="/projects")
        data = _json(r) if r.status_code == 200 else None
        if isinstance(data, list):
            self._projects = [p["title"] for p in data]
        self.api("GET", "/disbursements/", name="/disbursements/ (voucher list)")

    def open_project(self):
        if not self._projects:
            return self.open_dashboard()
        title = random.choice(self._projects)
        self.api("GET", f"/projects/{quote(title, safe='')}/summary", name="/projects/[title]/summary")


class StaffUser(AppUser):
    """A normal staff member."""

    weight = 8
    account = "staff"

    @task(5)
    def dashboard(self):
        self.open_dashboard()

    @task(3)
    def project(self):
        self.open_project()

    @task(1)
    def my_requests(self):
        self.api("GET", "/my-requests")

    @task(1)
    def add_entry(self):
        if not WRITE:
            return
        self.api("POST", "/disbursements/", name="/disbursements/ (add entry)", json={
            "project_title": TEST_PROJECT,
            "date": date.today().isoformat(),
            "cv_no": f"LT-{uuid.uuid4().hex[:12]}",
            "payee": "Load Test Supplier",
            "amount": f"{random.randint(100, 50000)}.00",
        })


class AdminUser(AppUser):
    """An admin: browses like staff, and also opens the admin windows."""

    abstract = not (ACCOUNTS["admin"][0] and ACCOUNTS["admin"][1])
    weight = 1
    account = "admin"

    @task(3)
    def dashboard(self):
        self.open_dashboard()

    @task(2)
    def project(self):
        self.open_project()

    @task(2)
    def activity(self):
        self.api("GET", "/activity-logs?limit=50", name="/activity-logs")

    @task(1)
    def requests(self):
        self.api("GET", "/deletion-requests?status=pending", name="/deletion-requests")
        self.api("GET", "/password-resets?status=pending", name="/password-resets")

    @task(1)
    def archived(self):
        self.api("GET", "/disbursements/archived")
        self.api("GET", "/projects/archived")

    @task(1)
    def users(self):
        self.api("GET", "/users")


QUESTIONS = [
    "How many projects are there?",
    "Which project spent the most this year?",
    "Who are our top 3 payees?",
    "Show the latest entries for Plant 2 Perimeter Fence Construction",
    "How much have we paid Laguna Steel?",
    "Total spending in 2025",
    "Find CV-25-0001",
]


class AssistantUser(AppUser):
    """Someone asking the assistant questions. Only included with LT_ASSISTANT=1.

    Reports two extra timings: "first words" (until the answer starts) and "whole answer"."""

    abstract = os.getenv("LT_ASSISTANT") != "1"
    weight = 1
    account = "staff"
    wait_time = between(20, 60)

    def on_start(self):
        self._token()
        self._projects = []
        self._running = True
        self._live = None  # counted by the other users

    @task
    def ask(self):
        question = random.choice(QUESTIONS)
        started = time.perf_counter()
        first, length, error = None, 0, None
        try:
            with self.client.post("/chat", headers=self._auth(), json={"messages": [{"role": "user", "content": question}]},
                                  stream=True, timeout=(10, 600), name="/chat (headers)", catch_response=True) as r:
                if r.status_code != 200:
                    r.failure(f"{r.status_code}")
                    return
                r.success()
                for line in r.iter_lines():
                    if not line:
                        continue
                    length += len(line)
                    if b'"type": "delta"' in line and first is None:
                        first = time.perf_counter()
                    if b'"type": "error"' in line:
                        error = RuntimeError(line.decode("utf-8", "replace")[:200])
        except Exception as e:
            error = e
        total_ms = (time.perf_counter() - started) * 1000
        events = self.environment.events.request
        if first is not None:
            events.fire(request_type="CHAT", name="first words", response_time=(first - started) * 1000,
                        response_length=0, exception=None, context={})
        events.fire(request_type="CHAT", name="whole answer", response_time=total_ms,
                    response_length=length, exception=error, context={})
