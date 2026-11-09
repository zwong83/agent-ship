"""Exercise AgentShip HTTP, persistence and optional Chrome journeys in a disposable local stack."""

import argparse
import http.cookiejar
import json
import os
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from pathlib import Path
import re
import secrets
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import HTTPCookieProcessor, ProxyHandler, Request, build_opener
from uuid import uuid4


ROOT = Path(__file__).resolve().parents[2]
WORKSPACE = ROOT / ".agentship" / "verification"
JAR = ROOT / "platform" / "target" / "agentship-platform-0.1.0-SNAPSHOT.jar"
TEST_PASSWORD = "synthetic test phrase +!"
FLOW_BROWSER_NAME = "浏览器端多 Agent 流程"
FLOW_BROWSER_AGENTS = (
    ("coordinator", "流程协调 Agent"),
    ("frontend", "前端子 Agent"),
    ("backend", "后端子 Agent"),
    ("review", "复核子 Agent"),
    ("unused", "未选子 Agent"),
)


def free_port():
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        return listener.getsockname()[1]


class Browser:
    def __init__(self, origin, cookies=None):
        self.origin = origin
        self.cookies = cookies if cookies is not None else http.cookiejar.CookieJar()
        self.opener = build_opener(ProxyHandler({}), HTTPCookieProcessor(self.cookies))
        self.csrf = None

    def call(self, method, path, *, expected, body=None, key=None, csrf=True, origin=None):
        headers = {"Accept": "application/json", "Origin": origin or self.origin}
        if body is not None:
            headers["Content-Type"] = "application/json"
        if method not in ("GET", "HEAD"):
            headers["Idempotency-Key"] = key or str(uuid4())
            if self.csrf and csrf:
                headers["X-CSRF-Token"] = self.csrf
        data = None if body is None else json.dumps(body).encode()
        request = Request(self.origin + path, data=data, headers=headers, method=method)
        try:
            response = self.opener.open(request, timeout=15)
        except HTTPError as error:
            response = error
        with response:
            raw = response.read()
            try:
                value = json.loads(raw) if raw else None
            except (json.JSONDecodeError, UnicodeDecodeError):
                raise AssertionError(f"{method} {path.split('?')[0]} returned non-JSON status {response.status}") from None
            statuses = (expected,) if isinstance(expected, int) else expected
            if response.status not in statuses:
                code = value.get("error", {}).get("code") if isinstance(value, dict) else None
                raise AssertionError(f"{method} {path.split('?')[0]} returned {response.status}/{code}; expected {statuses}")
            return response.status, response.headers, value

    def get(self, path, expected=200):
        return self.call("GET", path, expected=expected)[2]

    def post(self, path, body=None, expected=200, **options):
        return self.call("POST", path, expected=expected, body=body, **options)[2]

    def login(self, identifier):
        status, headers, value = self.call(
            "POST", "/api/login", expected=200,
            body={"identifier": identifier, "password": TEST_PASSWORD},
        )
        assert status == 200
        assert "HttpOnly" in headers.get("Set-Cookie", ""), "session cookie must be HttpOnly"
        assert set(value["user"]) == {"id", "displayName", "username"}
        self.csrf = value["csrfToken"]
        assert self.csrf
        return value["user"]


def account(username, number, *, email=None, phone=None, password=TEST_PASSWORD):
    return {
        "name": f"Fixture {number}",
        "username": username,
        "email": email or f"{username}@example.invalid",
        "phone": phone or f"+1202555{number:04d}",
        "password": password,
        "confirmPassword": password,
    }


def verify_channels(browser, registration):
    query = urlencode({"registrationRef": registration["registrationRef"]})
    result = browser.get("/api/dev/registration-messages?" + query)
    codes = {message["channel"]: message["code"] for message in result["messages"]}
    assert set(codes) == {"email", "phone"}
    return codes


def verify(browser, receipt, channel, code, expected=200):
    return browser.post("/api/register/verify", {
        "registrationRef": receipt["registrationRef"], "channel": channel, "code": code,
    }, expected)


def create_account(browser, payload):
    receipt = browser.post("/api/register", payload, 202)
    assert receipt["status"] == "verification_required"
    assert set(receipt["requiredChannels"]) == {"email", "phone"}
    assert set(receipt) == {"status", "requiredChannels", "registrationRef", "expiresAt"}
    login = {"identifier": payload["username"], "password": payload["password"]}
    browser.post("/api/login", login, 401)
    codes = verify_channels(browser, receipt)
    verify(browser, receipt, "email", "invalid-fixture-code", 400)
    first = verify(browser, receipt, "email", codes["email"])
    assert first == {"status": "verification_required", "verifiedChannels": ["email"]}
    browser.post("/api/login", login, 401)
    second = verify(browser, receipt, "phone", codes["phone"])
    assert second["status"] == "active" and set(second["verifiedChannels"]) == {"email", "phone"}
    assert browser.get("/api/me")["user"] is None
    return browser.login(payload["email"].upper())


def error_code(body, expected):
    assert body["error"]["code"] == expected, (body["error"]["code"], expected)


def test_identity(origin, connect):
    anon, owner, deputy, outsider = (Browser(origin) for _ in range(4))
    assert anon.get("/api/me") == {"user": None, "csrfToken": None}
    anon.get("/api/me/contact", 401)
    anon.get("/api/projects", 401)
    for length in (14, 129):
        anon.post("/api/register", account("bad_password", 108, password="x" * length), 400)
    mismatch = account("bad_password", 108)
    mismatch["confirmPassword"] = "another synthetic phrase"
    anon.post("/api/register", mismatch, 400)
    anon.post("/api/register", account("x" * 101, 109, email="overlimit@example.invalid"), 400)
    for index, size in enumerate((15, 128), start=130):
        anon.post("/api/register", account(f"valid_password_{size}", index, password="x" * size), 202)
    anon.post("/api/register", account("x" * 100, 132, email="atlimit@example.invalid"), 202)

    owner_info = create_account(owner, account("fixture_owner", 101))
    deputy_info = create_account(deputy, account("fixture_deputy", 102))
    outsider_info = create_account(outsider, account("fixture_outsider", 103))
    assert owner.get("/api/me")["user"]["id"] == owner_info["id"]
    reload = Browser(origin, owner.cookies)
    state = reload.get("/api/me")
    assert state["user"] == owner_info and state["csrfToken"]
    assert "email" not in state["user"] and "phone" not in state["user"]
    _, headers, contact = owner.call("GET", "/api/me/contact", expected=200)
    assert contact == {"email": "fixture_owner@example.invalid", "phone": "+12025550101"}
    assert "no-store" in headers.get("Cache-Control", "")
    assert deputy.get("/api/me/contact")["email"] == "fixture_deputy@example.invalid"
    assert outsider.get("/api/me/contact")["email"] == "fixture_outsider@example.invalid"
    owner.post("/api/logout", expected=403, csrf=False)
    owner.post("/api/logout", expected=403, origin="http://127.0.0.1:1")
    assert owner.get("/api/me")["user"]["id"] == owner_info["id"]

    for payload in (
        account("FIXTURE_OWNER", 121),
        account("duplicate_email", 122, email="FIXTURE_OWNER@EXAMPLE.INVALID"),
        account("duplicate_phone", 123, phone="+1 (202) 555-0101"),
    ):
        conflict = anon.post("/api/register", payload, 409)
        error_code(conflict, "IDENTIFIER_UNAVAILABLE")

    race = threading.Barrier(2)
    def concurrent_registration(index):
        browser = Browser(origin)
        race.wait(timeout=5)
        return browser.call("POST", "/api/register", expected=(202, 409), body=account(
            ["concurrent_fixture", "CONCURRENT_FIXTURE"][index], 124 + index,
        ))[0]
    with ThreadPoolExecutor(max_workers=2) as executor:
        assert sorted(executor.map(concurrent_registration, range(2))) == [202, 409]

    expiring = account("expired_fixture", 126)
    first = anon.post("/api/register", expiring, 202)
    codes = verify_channels(anon, first)
    verify(anon, first, "email", codes["email"])
    with connect() as connection:
        cursor = connection.execute(
            "UPDATE agentship_design.account SET created_at = clock_timestamp() - interval '25 hours' "
            "WHERE username_key = %s", ("expired_fixture",),
        )
        assert cursor.rowcount == 1
    verify(anon, first, "phone", codes["phone"], 400)
    renewed = anon.post("/api/register", expiring, 202)
    assert first["registrationRef"] != renewed["registrationRef"]
    verify(anon, first, "email", codes["email"], 400)
    anon.post("/api/login", {"identifier": "expired_fixture", "password": TEST_PASSWORD}, 401)
    assert Browser(origin).login("FIXTURE_OWNER")["id"] == owner_info["id"]
    print("PASS HTTP registration, activation, expiry/reuse, concurrent duplicates, session, self-contact and CSRF")
    return owner, deputy, outsider, owner_info, deputy_info


def query(path, **parameters):
    return path + "?" + urlencode(parameters)


def items(browser, path):
    page = browser.get(path)
    assert set(page) >= {"items", "nextCursor"}
    return {item["id"] for item in page["items"]}


def own_project(browser):
    projects = browser.get("/api/projects")["items"]
    assert len(projects) == 1, "each newly activated fixture starts with its personal project"
    return projects[0]["id"]


def end_only_flow():
    return {"stages": [{"id": str(uuid4()), "name": "Completion", "nodes": [
        {"id": str(uuid4()), "name": "End", "type": "end", "dependencies": []},
    ]}]}


def seed_flow_browser_agents(owner):
    result = {}
    for role, name in FLOW_BROWSER_AGENTS:
        agent = owner.post("/api/objects/agents", {
            "name": name, "data": {"roleKey": f"browser.flow.{role}", "description": "Synthetic browser fixture"},
        }, 201)
        result[role] = agent["id"]
    assert set(result.values()) <= items(owner, "/api/catalog")
    return result


def check_flow_browser_result(owner, agents, connect):
    collection = "/api/objects/flows"
    found = owner.get(query(collection, q=FLOW_BROWSER_NAME))["items"]
    assert len(found) == 1
    flow = owner.get(f"{collection}/{found[0]['id']}")
    assert flow["name"] == FLOW_BROWSER_NAME and flow["version"] == flow["workflowVersion"] == 2
    stages = flow["data"]["stages"]
    assert [stage["name"] for stage in stages] == ["准备阶段", "并行开发", "汇合交付"]
    expected_nodes = [["分析需求"], ["前端实现", "后端实现"], ["汇总产物", "结束"]]
    assert [[node["name"] for node in stage["nodes"]] for stage in stages] == expected_nodes
    prepare, frontend, backend, join, end = (node for stage in stages for node in stage["nodes"])
    assert not prepare["dependencies"]
    assert frontend["dependencies"] == backend["dependencies"] == [prepare["id"]]
    assert set(join["dependencies"]) == {frontend["id"], backend["id"]}
    assert set(end["dependencies"]) == {join["id"], frontend["id"]}
    assert end["type"] == "end" and "coordinatorId" not in end and not end.get("agentIds")
    assert all(node["coordinatorId"] == agents["coordinator"] for node in (prepare, frontend, backend, join))
    assert prepare["agentOrder"] == "serial"
    assert prepare["agentIds"] == [agents["review"], agents["frontend"], agents["backend"]]
    assert all(agents["unused"] not in node.get("agentIds", []) for stage in stages for node in stage["nodes"])
    with connect() as connection:
        orders = connection.execute(
            "SELECT workflow_version, agent_order FROM agentship_design.workflow_node "
            "WHERE workflow_id = %s AND node_id = %s ORDER BY workflow_version",
            (flow["id"], prepare["id"]),
        ).fetchall()
        assert orders == [(1, "parallel"), (2, "serial")], "the two valid submissions must preserve both modes"
    print("PASS HTTP round-trip after restart of Chrome-created stages, fork/join, end marker and ordered Agent subset")


def test_configuration(owner, deputy, outsider, owner_info, deputy_info):
    owner_project, deputy_project, outsider_project = map(own_project, (owner, deputy, outsider))
    deputy_requirement = deputy.post("/api/objects/requirements", {
        "name": "Deputy launch target", "data": {"projectId": deputy_project, "description": "Fixture"},
    }, 201)
    assert len({owner_project, deputy_project, outsider_project}) == 3
    launch_context = deputy_requirement["id"]
    fixture_agent = None
    requirements = {"projectId": owner_project, "description": "Fixture"}
    bodies = {
        "requirements": {"name": "First batch cross-project uniqueness", "data": requirements},
        "flows": {"name": "First batch flow", "data": end_only_flow()},
        "agents": {"name": "First batch Agent", "data": {"roleKey": "batch.fixture", "description": "Fixture"}},
    }
    for kind, original in bodies.items():
        collection = f"/api/objects/{kind}"
        _, headers, created = owner.call("POST", collection, expected=201, body=original)
        request_id = headers.get("X-Request-Id")
        assert request_id
        object_id = created["id"]
        path = f"{collection}/{object_id}"
        assert created["owner"] == owner_info and created["deputies"] == []
        assert "manage_members" in created["allowedActions"]
        if kind == "flows":
            assert created["workflowVersion"] == 1
        outsider.get(path, (403, 404))
        assert object_id not in items(outsider, collection)

        if kind == "requirements":
            visible_duplicate = owner.post(collection, original, 409)
            error_code(visible_duplicate, "REQUIREMENT_EXISTS")
            assert visible_duplicate["error"]["details"]["existingRequirementId"] == object_id
            hidden_duplicate = outsider.post(collection, {
                "name": original["name"], "data": {**requirements, "projectId": outsider_project},
            }, 409)
            error_code(hidden_duplicate, "NAME_UNAVAILABLE")
            assert "existingRequirementId" not in hidden_duplicate["error"].get("details", {})
        owner.post(path + "/ownership", {
            "action": "add_deputy", "username": "FIXTURE_DEPUTY", "expectedVersion": created["version"],
        })
        if kind == "flows":
            eligible = query(collection, purpose="use", requirementId=launch_context)
            assert object_id in items(deputy, eligible)
            owner.get(eligible, (403, 404))
        elif kind == "agents":
            eligible = "/api/catalog"
            assert object_id in items(deputy, eligible)
            assert object_id not in items(outsider, eligible)
        granted = deputy.get(path)
        assert granted["deputies"] == [deputy_info]
        assert "edit" in granted["allowedActions"] and "manage_members" not in granted["allowedActions"]
        if kind == "flows":
            assert granted["version"] > created["version"] and granted["workflowVersion"] == 1
        if kind == "requirements":
            assert "start" not in granted["allowedActions"]
        deputy.post(path + "/ownership", {
            "action": "remove_deputy", "userId": deputy_info["id"], "expectedVersion": granted["version"],
        }, (403, 404))

        update = {"expectedVersion": granted["version"], "name": original["name"] + " edited", "data": original["data"]}
        changed = deputy.call("PATCH", path, expected=200, body=update)[2]
        assert changed["name"] == update["name"]
        if kind == "flows":
            assert changed["workflowVersion"] == 2
        owner.post(path + "/ownership", {
            "action": "remove_deputy", "userId": deputy_info["id"], "expectedVersion": changed["version"],
        })
        rejected = deputy.call("PATCH", path, expected=(403, 409), body={
            **update, "expectedVersion": changed["version"],
        })[2]
        error_code(rejected, "ACCESS_REVOKED")
        assert object_id not in items(deputy, collection)
        if kind in ("flows", "agents"):
            assert object_id not in items(deputy, eligible)

        transfer = {
            "action": "transfer", "username": "fixture_deputy", "expectedVersion": owner.get(path)["version"],
        }
        key = str(uuid4())
        receipt = owner.post(path + "/ownership", transfer, key=key)
        assert set(receipt) == {"accepted", "duplicate", "receiptId"}
        assert receipt["accepted"] and not receipt["duplicate"]
        owner.get(path, (403, 404))
        replay = owner.post(path + "/ownership", transfer, key=key)
        assert replay == {**receipt, "duplicate": True}
        inconsistent = owner.post(path + "/ownership", {**transfer, "username": "fixture_outsider"}, 409, key=key)
        error_code(inconsistent, "IDEMPOTENCY_CONFLICT")
        new_owner = deputy.get(path)
        assert new_owner["owner"] == deputy_info and "manage_members" in new_owner["allowedActions"]
        if kind == "flows":
            assert new_owner["version"] > changed["version"] and new_owner["workflowVersion"] == 2
        assert "email" not in new_owner["owner"] and "phone" not in new_owner["owner"]
        if kind == "agents":
            fixture_agent = (path, object_id, request_id)

    print("PASS HTTP three configuration kinds, visibility, name isolation, candidates, deputy revocation and transfer replay")
    return fixture_agent


@contextmanager
def postgres(tools, scratch):
    port, data, log = free_port(), scratch / "db", scratch / "postgres.log"
    subprocess.run([tools / "initdb", "-D", data, "-A", "trust", "--no-locale", "--encoding=UTF8",
                    "-U", "design_check"], check=True, capture_output=True)
    subprocess.run([tools / "pg_ctl", "-D", data, "-l", log,
                    "-o", f"-h 127.0.0.1 -p {port} -c unix_socket_directories=", "-w", "start"],
                   check=True, capture_output=True)
    try:
        yield port
    finally:
        subprocess.run([tools / "pg_ctl", "-D", data, "-m", "fast", "-w", "stop"],
                       check=True, capture_output=True)


@contextmanager
def platform(java, jar, scratch, database_port, app_port, key, name):
    env = {**os.environ, "AGENTSHIP_JDBC_URL": f"jdbc:postgresql://127.0.0.1:{database_port}/postgres",
           "AGENTSHIP_DB_USER": "design_check", "AGENTSHIP_DB_PASSWORD": "",
           "AGENTSHIP_PORT": str(app_port), "AGENTSHIP_BIND_ADDRESS": "127.0.0.1",
           "AGENTSHIP_SECURE_COOKIE": "false", "AGENTSHIP_LOCAL_VERIFICATION": "true",
           "AGENTSHIP_VERIFICATION_KEY": key}
    origin, log = f"http://127.0.0.1:{app_port}", scratch / f"{name}.log"
    with log.open("wb") as output:
        process = subprocess.Popen([java, "-jar", jar], env=env, stdout=output, stderr=subprocess.STDOUT)
        try:
            deadline = time.monotonic() + 45
            while time.monotonic() < deadline and process.poll() is None:
                try:
                    if Browser(origin).get("/api/me") == {"user": None, "csrfToken": None}:
                        break
                except (OSError, URLError, AssertionError):
                    time.sleep(0.15)
            else:
                output.flush()
                safe_log = log.read_text(errors="replace").replace(key, "[redacted]").replace(TEST_PASSWORD, "[redacted]")
                tail = safe_log.splitlines()[-18:]
                raise RuntimeError("AgentShip did not become ready:\n" + "\n".join(tail))
            yield origin
        finally:
            if process.poll() is None:
                process.terminate()
                try:
                    process.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=5)
    contents = log.read_text(errors="replace")
    assert TEST_PASSWORD not in contents and key not in contents, "credentials appeared in server logs"


def test_chrome(cli, origin, scratch, journeys):
    session = f"-s=agentship-integration-{uuid4().hex[:12]}"

    def run(*args):
        return subprocess.run([cli, session, *args], cwd=scratch, capture_output=True, text=True, timeout=90)

    try:
        opened = run("open", origin, "--browser=chrome")
        if opened.returncode or "### Error" in opened.stdout:
            raise RuntimeError("Playwright could not launch the installed Chrome browser")
        for filename, success, description in journeys:
            script = Path(__file__).with_name(filename).resolve()
            result = run("run-code", "--filename", str(script))
            if result.returncode or f"### Result\n{json.dumps(success)}" not in result.stdout:
                diagnostic = re.sub(r"```[\s\S]*?```", "", result.stdout or result.stderr).strip()
                diagnostic = diagnostic.replace(TEST_PASSWORD, "[redacted]")
                diagnostic = diagnostic.replace("synthetic browser test phrase +!", "[redacted]")
                message = " ".join(line.strip() for line in diagnostic.splitlines() if line.strip())[:1200]
                raise AssertionError(f"Chrome journey {filename} did not complete (CLI exit {result.returncode}). {message}")
            print(f"PASS Chrome {description}")
    finally:
        run("close")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--jar", type=Path, default=JAR)
    parser.add_argument("--java", type=Path, required=True, help="Java 21 executable")
    parser.add_argument("--pg-bin", type=Path, default=WORKSPACE / "tools" / "pg17" / "bin")
    parser.add_argument("--psycopg-path", type=Path, default=WORKSPACE / "pg-python")
    parser.add_argument("--browser", action="store_true", help="also verify the packaged frontend with Playwright CLI and Chrome")
    args = parser.parse_args()
    if not args.jar.is_file():
        parser.error(f"build the Spring Boot jar first: {args.jar}")
    playwright = shutil.which("playwright-cli") if args.browser else None
    if args.browser and not playwright:
        parser.error("--browser requires playwright-cli and Chrome to be installed")
    sys.path.insert(0, str(args.psycopg_path.resolve()))
    import psycopg

    WORKSPACE.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="first-batch-", dir=WORKSPACE) as folder:
        scratch = Path(folder)
        key = secrets.token_urlsafe(40)
        with postgres(args.pg_bin.resolve(), scratch) as database_port:
            def connect():
                return psycopg.connect(host="127.0.0.1", port=database_port, user="design_check", dbname="postgres")

            app_port = free_port()
            with platform(args.java, args.jar, scratch, database_port, app_port, key, "initial") as origin:
                owner, deputy, outsider, owner_info, deputy_info = test_identity(origin, connect)
                agent_path, agent_id, request_id = test_configuration(owner, deputy, outsider, owner_info, deputy_info)
                if playwright:
                    flow_agents = seed_flow_browser_agents(owner)
                    test_chrome(playwright, origin, scratch, [
                        ("first_batch_browser.js", "agentShip-browser-ok",
                         "dual verification, login, configuration pages, member changes, reload, contact and logout"),
                        ("flow_browser.js", "agentShip-flow-ok",
                         "workflow editor, missing end/routes and cycle guards, fork/join, Agent order, reopen and mobile reflow"),
                    ])
            with platform(args.java, args.jar, scratch, database_port, app_port, key, "restart") as origin:
                reloaded = Browser(origin, deputy.cookies)
                restored = reloaded.get("/api/me")
                assert restored["user"] == deputy_info
                reloaded.csrf = restored["csrfToken"]
                assert reloaded.get(agent_path)["owner"] == deputy_info
                reloaded.post("/api/logout")
                assert reloaded.get("/api/me")["user"] is None
                reloaded.get(agent_path, 401)
                with connect() as connection:
                    migrations = connection.execute(
                        "SELECT version, success FROM public.flyway_schema_history WHERE version IS NOT NULL ORDER BY installed_rank"
                    ).fetchall()
                    assert migrations[:2] == [("1", True), ("2", True)] and all(ok for _, ok in migrations), migrations
                    audit = connection.execute("SELECT action, to_jsonb(e)::text FROM agentship_design.audit_event e").fetchall()
                    assert {"register", "verify_contact", "activate_account", "login", "logout", "create",
                            "update", "add_deputy", "remove_deputy", "transfer"} <= {action for action, _ in audit}
                    assert all(TEST_PASSWORD not in event and key not in event and "@example.invalid" not in event
                               for _, event in audit), "credentials or contact data appeared in audit events"
                    matching_audit = connection.execute(
                        "SELECT count(*) FROM agentship_design.audit_event WHERE target_id = %s AND request_id = %s AND action = 'create'",
                        (agent_id, request_id),
                    ).fetchone()
                    assert matching_audit == (1,), "creation audit must use the HTTP response request ID"
                if playwright:
                    check_flow_browser_result(owner, flow_agents, connect)
            print("PASS clean Flyway migration, persisted state and audit, application restart and session logout")


if __name__ == "__main__":
    main()
