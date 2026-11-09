"""Verify saved workflow graphs through HTTP and real isolated PostgreSQL."""

import argparse
from copy import deepcopy
import hashlib
import json
from pathlib import Path
import secrets
import sys
import tempfile
from uuid import uuid4

from verify_first_batch import Browser, JAR, WORKSPACE, account, create_account, free_port, platform, postgres


def agent(browser, index):
    return browser.post("/api/objects/agents", {
        "name": f"Flow role {index}",
        "data": {"roleKey": f"flow.role.{index}", "description": f"Synthetic role {index}"},
    }, 201)


def ordinary(name, agents, dependencies=None, kind="work"):
    return {"id": str(uuid4()), "name": name, "type": kind, "purpose": "other",
            "dependencies": dependencies or [], "coordinatorId": agents[0]["id"],
            "agentIds": [item["id"] for item in agents[1:4]], "agentOrder": "parallel"}


def graph(agents):
    design = ordinary("Design", agents)
    backend = ordinary("Backend", agents, [design["id"]])
    frontend = ordinary("Frontend", agents, [design["id"]])
    end = {"id": str(uuid4()), "name": "End", "type": "end", "dependencies": sorted([backend["id"], frontend["id"]])}
    return {"stages": [{"id": str(uuid4()), "name": "Define", "nodes": [design]},
                       {"id": str(uuid4()), "name": "Build", "nodes": [backend, frontend, end]}]}


def nested_routes(roles):
    outer = ordinary("Outer check", roles, kind="check")
    passed = ordinary("Outer pass", roles)
    inner = ordinary("Inner check", roles, kind="check")
    inner_pass = ordinary("Inner pass", roles)
    inner_repair = ordinary("Inner repair", roles)
    outer["checkRoutes"] = {"passNodeId": passed["id"], "repairNodeId": inner["id"], "automaticRepairLimit": 3}
    inner["checkRoutes"] = {"passNodeId": inner_pass["id"], "repairNodeId": inner_repair["id"], "automaticRepairLimit": 2}
    passed["route"] = {"checkNodeId": outer["id"], "outcome": "pass"}
    inner["route"] = {"checkNodeId": outer["id"], "outcome": "repair"}
    inner_pass["route"] = {"checkNodeId": inner["id"], "outcome": "pass"}
    inner_repair["route"] = {"checkNodeId": inner["id"], "outcome": "repair"}
    end = {"id": str(uuid4()), "name": "End", "type": "end", "dependencies": [passed["id"]]}
    return {"stages": [{"id": str(uuid4()), "name": "Nested checks", "nodes": [outer, passed, inner, inner_pass, inner_repair, end]}]}


def test_graphs(owner, outsider, connect):
    roles = [agent(owner, index) for index in range(5)]
    old_payload = {"name": "Flow role 0", "version": 0, "project": None,
                   "description": "Synthetic role 0", "roleKey": "flow.role.0", "skillRef": None}
    expected_digest = hashlib.sha256(json.dumps(old_payload, separators=(",", ":")).encode()).digest()
    with connect() as connection:
        actual_digest = connection.execute(
            "SELECT request_digest FROM agentship_design.command_receipt WHERE scope='configuration:create:agents' AND result_id=%s",
            (roles[0]["id"],),
        ).fetchone()[0]
        assert bytes(actual_digest) == expected_digest, "adding flow data changed the prior Agent command fingerprint"
    original = graph(roles)
    command = {"name": "Versioned workflow", "data": original}
    key = str(uuid4())
    created = owner.post("/api/objects/flows", command, 201, key=key)
    assert created["workflowVersion"] == 1
    path = "/api/objects/flows/" + created["id"]
    assert created["data"] == original
    assert owner.get(path)["data"] == original
    assert owner.post("/api/objects/flows", command, 201, key=key)["id"] == created["id"]
    outsider.get(path, (403, 404))

    def rejected(data, text, expected=400):
        response = owner.call("PATCH", path, expected=expected,
                              body={"name": "Rejected", "data": data, "expectedVersion": created["version"]})[2]
        assert response["error"]["code"] in ("INVALID_REQUEST", "AGENT_UNAVAILABLE", "FORBIDDEN", "ACTION_NOT_ALLOWED")
        assert text in response["error"]["message"], response["error"]
        assert owner.get(path) == created, "invalid graph changed the persisted workflow"

    invalid = deepcopy(original)
    invalid["stages"][-1]["nodes"].pop()
    rejected(invalid, "结束")
    invalid = deepcopy(original)
    invalid["stages"][-1]["nodes"].reverse()
    rejected(invalid, "结束")
    invalid = deepcopy(original)
    invalid["stages"][-1]["nodes"][-1]["agentIds"] = [roles[1]["id"]]
    rejected(invalid, "结束")
    invalid = deepcopy(original)
    nodes = invalid["stages"][1]["nodes"]
    nodes[0]["dependencies"] = [nodes[1]["id"]]
    nodes[1]["dependencies"] = [nodes[0]["id"]]
    rejected(invalid, "循环")
    invalid = deepcopy(original)
    invalid["stages"][1]["nodes"][1]["dependencies"] = []
    invalid["stages"][0]["nodes"][0]["dependencies"] = [invalid["stages"][1]["nodes"][1]["id"]]
    rejected(invalid, "阶段")
    invalid = deepcopy(original)
    invalid["stages"][0]["nodes"][0]["dependencies"] = [str(uuid4())]
    rejected(invalid, "依赖")
    invalid = deepcopy(original)
    invalid["stages"][0]["nodes"][0]["agentIds"].append(roles[1]["id"])
    rejected(invalid, "重复")
    invalid = deepcopy(original)
    invalid["stages"][0]["nodes"][0]["type"] = "check"
    rejected(invalid, "路线")
    invalid = deepcopy(original)
    invalid["stages"][0]["nodes"][0]["type"] = "publish"
    rejected(invalid, "发布")

    invalid = nested_routes(roles)
    nested = invalid["stages"][0]["nodes"]
    nested[3]["dependencies"] = [nested[1]["id"]]
    rejected(invalid, "互斥")

    hidden = agent(outsider, 9)
    invalid = deepcopy(original)
    invalid["stages"][0]["nodes"][0]["agentIds"] = [hidden["id"]]
    rejected(invalid, "Agent", 403)

    changed_agent = owner.call("PATCH", "/api/objects/agents/" + roles[1]["id"], expected=200, body={
        "name": "Updated role", "expectedVersion": roles[1]["version"], "data": roles[1]["data"],
    })[2]
    assert changed_agent["version"] > roles[1]["version"]
    edited = deepcopy(original)
    edited["stages"][1]["nodes"][0]["agentOrder"] = "serial"
    edited["stages"][1]["nodes"][0]["agentIds"].reverse()
    update_key = str(uuid4())
    update = {
        "name": "Versioned workflow edited", "expectedVersion": created["version"], "data": edited,
    }
    saved = owner.call("PATCH", path, expected=200, body=update, key=update_key)[2]
    assert saved["workflowVersion"] == 2
    assert saved["data"] == edited
    assert owner.call("PATCH", path, expected=200, body=update, key=update_key)[2] == saved
    conflict = owner.call("PATCH", path, expected=409, body={**update, "data": original}, key=update_key)[2]
    assert conflict["error"]["code"] == "IDEMPOTENCY_CONFLICT"
    stale = owner.call("PATCH", path, expected=409, body={
        "name": "Stale", "expectedVersion": created["version"], "data": original,
    })[2]
    assert stale["error"]["code"] == "STALE_VERSION"
    with connect() as connection:
        versions = connection.execute(
            "SELECT version, sealed_at IS NOT NULL FROM agentship_design.workflow_version WHERE workflow_id=%s ORDER BY version",
            (created["id"],),
        ).fetchall()
        assert len(versions) == 2 and all(sealed for _, sealed in versions)
        pinned = connection.execute(
            "SELECT DISTINCT workflow_version,agent_version FROM agentship_design.workflow_role WHERE workflow_id=%s AND agent_id=%s ORDER BY workflow_version",
            (created["id"], roles[1]["id"]),
        ).fetchall()
        assert pinned == [(versions[0][0], 1), (versions[1][0], 2)], pinned
    with connect() as connection:
        try:
            connection.execute("UPDATE agentship_design.workflow_node SET name='forbidden' WHERE workflow_id=%s",
                               (created["id"],))
        except Exception as error:
            assert getattr(error, "sqlstate", None) == "55000", type(error)
            connection.rollback()
        else:
            raise AssertionError("sealed workflow node was mutable")

    for role in roles[:4]:
        current = owner.get("/api/objects/agents/" + role["id"])
        owner.post("/api/objects/agents/" + role["id"] + "/ownership", {
            "action": "add_deputy", "username": "flow_outsider", "expectedVersion": current["version"],
        })
    owner.post(path + "/ownership", {
        "action": "add_deputy", "username": "flow_outsider", "expectedVersion": saved["version"],
    })
    shared = outsider.get(path)
    assert shared["version"] == saved["version"] + 1
    assert shared["workflowVersion"] == saved["workflowVersion"]
    saved = outsider.call("PATCH", path, expected=200, body={
        "name": shared["name"], "expectedVersion": shared["version"], "data": shared["data"],
    })[2]
    assert saved["workflowVersion"] == shared["workflowVersion"] + 1
    revoked = owner.get("/api/objects/agents/" + roles[1]["id"])
    owner.post("/api/objects/agents/" + roles[1]["id"] + "/ownership", {
        "action": "remove_deputy", "userId": outsider.get("/api/me")["user"]["id"], "expectedVersion": revoked["version"],
    })
    denied = outsider.call("PATCH", path, expected=403, body={
        "name": "No rights", "expectedVersion": saved["version"], "data": saved["data"],
    })[2]
    assert denied["error"]["code"] == "AGENT_UNAVAILABLE"
    current = owner.get(path)
    assert current["data"] == saved["data"] and current["version"] == saved["version"] and current["name"] == saved["name"]
    saved = current
    test_routes_and_legacy(owner, roles, connect)
    print("PASS workflow graph round-trip, multiple roles/order, invalid graph rollback, rights and immutable versions")
    return path, saved


def test_routes_and_legacy(owner, roles, connect):
    nested = nested_routes(roles)
    nodes = nested["stages"][0]["nodes"]
    nodes[3]["dependencies"] = [nodes[2]["id"]]
    nodes[4]["dependencies"] = [nodes[2]["id"]]
    valid = owner.post("/api/objects/flows", {"name": "Nested route scopes", "data": nested}, 201)
    assert valid["data"] == nested

    routes = nested_routes(roles)
    check, passed, repair, _, _, end = routes["stages"][0]["nodes"]
    repair["type"] = "work"
    del repair["checkRoutes"]
    check["checkRoutes"]["automaticRepairLimit"] = 0
    cross_stage = {"stages": [{"id": str(uuid4()), "name": "Earlier repair", "nodes": [repair]},
                              {"id": str(uuid4()), "name": "Check", "nodes": [check, passed, end]}]}
    valid = owner.post("/api/objects/flows", {"name": "Controlled earlier repair", "data": cross_stage}, 201)
    assert valid["data"] == cross_stage
    broken = deepcopy(cross_stage)
    broken["stages"][0]["nodes"][0]["dependencies"] = [check["id"]]
    owner.post("/api/objects/flows", {"name": "Invalid earlier hard dependency", "data": broken}, 400)

    solo = graph(roles)
    for stage in solo["stages"]:
        for node in stage["nodes"]:
            if node["type"] != "end":
                node["agentIds"] = []
                del node["agentOrder"]
    saved = owner.post("/api/objects/flows", {"name": "Coordinator only", "data": solo}, 201)
    assert saved["data"]["stages"][0]["nodes"][0]["agentOrder"] == "parallel"
    assert saved["data"]["stages"][0]["nodes"][0]["agentIds"] == []

    ending = {"stages": [{"id": str(uuid4()), "name": "Complete", "nodes": [
        {"id": str(uuid4()), "name": "End", "type": "end", "dependencies": []}]}]}
    owner.post("/api/objects/flows", {"name": "End marker", "data": ending}, 201)

    legacy = str(uuid4())
    actor = owner.get("/api/me")["user"]["id"]
    with connect() as connection:
        connection.execute("INSERT INTO agentship_design.configuration(id,kind,owner_id,version) VALUES (%s,'workflow',%s,1)",
                           (legacy, actor))
        connection.execute("INSERT INTO agentship_design.workflow(id,name) VALUES (%s,'Legacy metadata')", (legacy,))
    legacy_path = "/api/objects/flows/" + legacy
    detail = owner.get(legacy_path)
    assert detail["workflowVersion"] is None
    assert detail["data"] == {"stages": []} and "use" not in detail["allowedActions"]
    project = owner.get("/api/projects")["items"][0]["id"]
    requirement = owner.post("/api/objects/requirements", {
        "name": "Flow candidate context", "data": {"projectId": project, "description": "Synthetic"}}, 201)
    candidates = "/api/objects/flows?purpose=use&requirementId=" + requirement["id"]
    assert legacy not in {item["id"] for item in owner.get(candidates)["items"]}
    converted = owner.call("PATCH", legacy_path, expected=200, body={
        "name": "Converted legacy flow", "expectedVersion": 1, "data": ending})[2]
    assert converted["workflowVersion"] == 1 and converted["version"] == 2
    assert "use" in converted["allowedActions"] and converted["data"] == ending
    assert legacy in {item["id"] for item in owner.get(candidates)["items"]}
    print("PASS nested and cross-stage routes, zero repair limit, coordinator-only, end-only and legacy conversion")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--java", type=Path, required=True)
    parser.add_argument("--jar", type=Path, default=JAR)
    args = parser.parse_args()
    sys.path.insert(0, str(WORKSPACE / "pg-python"))
    import psycopg

    with tempfile.TemporaryDirectory(prefix="flow-config-", dir=WORKSPACE) as folder:
        scratch = Path(folder)
        with postgres(WORKSPACE / "tools" / "pg17" / "bin", scratch) as database_port:
            def connect():
                return psycopg.connect(host="127.0.0.1", port=database_port, user="design_check", dbname="postgres")
            key = secrets.token_urlsafe(40)
            port = free_port()
            with platform(args.java, args.jar, scratch, database_port, port, key, "initial") as origin:
                owner, outsider = Browser(origin), Browser(origin)
                create_account(owner, account("flow_owner", 701))
                create_account(outsider, account("flow_outsider", 702))
                path, saved = test_graphs(owner, outsider, connect)
            with platform(args.java, args.jar, scratch, database_port, port, key, "restart") as origin:
                restored = Browser(origin, owner.cookies)
                assert restored.get(path) == saved
            print("PASS workflow graph persists across application restart")


if __name__ == "__main__":
    main()
