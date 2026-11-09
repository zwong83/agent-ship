"""Node scheduling and role receipts against the packaged HTTP/PostgreSQL boundary."""

import argparse
from concurrent.futures import ThreadPoolExecutor
import hashlib
from pathlib import Path
import secrets
import sys
import tempfile
from uuid import uuid4

from verify_first_batch import Browser, JAR, WORKSPACE, account, create_account, free_port, platform, postgres
from verify_git_jobs import Driver, call


def uuid():
    return str(uuid4())


def create_flow(owner, stages, roles):
    agent_ids = {}
    for name in roles:
        role = owner.post('/api/objects/agents', {'name': name, 'data': {
            'roleKey': 'node.' + uuid(), 'description': 'Synthetic role instruction',
        }}, 201)
        agent_ids[name] = role['id']
    for stage in stages:
        for node in stage['nodes']:
            if 'coordinatorId' in node:
                node['coordinatorId'] = agent_ids[node['coordinatorId']]
                node['agentIds'] = [agent_ids[role] for role in node.get('agentIds', [])]
    flow = owner.post('/api/objects/flows', {'name': 'Flow ' + uuid(), 'data': {'stages': stages}}, 201)
    return flow, agent_ids


def fixture(owner, connect, origin, flow, description='Synthetic requirement revision 1'):
    actor = owner.get('/api/me')['user']['id']
    project = owner.get('/api/projects')['items'][0]['id']
    req = owner.post('/api/objects/requirements', {'name': 'Node ' + uuid(), 'data': {
        'projectId': project, 'description': description,
    }}, 201)
    device, run, repo, git_task, git_attempt = (uuid() for _ in range(5))
    token = secrets.token_urlsafe(32)
    with connect() as db:
        db.execute("INSERT INTO agentship_design.device(id,account_id,display_name,mode,protocol_version,paired_origin,token_digest,proof_public_key,codex_status,last_seen_at) VALUES(%s,%s,'Fixture','demo','1',%s,%s,%s,'not_required',statement_timestamp())",
                   (device, actor, origin, hashlib.sha256(token.encode()).digest(), b'fixture-public-key'))
        db.execute("INSERT INTO agentship_design.repository(id,provider,provider_repository_id,display_name,default_branch) VALUES(%s,'demo',%s,%s,'main')",
                   (repo, 'demo:' + req['id'], 'fixture/agentship-' + req['id']))
        db.execute("""INSERT INTO agentship_design.run(
            id,project_id,requirement_id,workflow_id,workflow_version,initiator_id,device_id,mode,work_type,
            github_namespace,state,current_revision,state_version,reason_code,repository_id,base_branch,work_branch,base_commit,git_default_branch)
            VALUES(%s,%s,%s,%s,1,%s,%s,'demo','feature','fixture','waiting',1,1,'AGENT_EXECUTION_PENDING',%s,'dev',%s,%s,'main')""",
                   (run, project, req['id'], flow['id'], actor, device, repo, 'feature/' + run, 'a' * 40))
        db.execute("""INSERT INTO agentship_design.run_requirement_revision(run_id,revision,requirement_version,title,description,recorded_by)
            VALUES(%s,1,1,'Node fixture',%s,%s)""", (run, description, actor))
        db.execute("""INSERT INTO agentship_design.node_execution(id,run_id,workflow_id,workflow_version,node_id,wave,requirement_revision,state)
            SELECT gen_random_uuid(),%s,workflow_id,workflow_version,node_id,1,1,'blocked'
            FROM agentship_design.workflow_node WHERE workflow_id=%s AND workflow_version=1""", (run, flow['id']))
        db.execute("INSERT INTO agentship_design.role_task(id,run_id,device_id,kind,requirement_revision,current_attempt) VALUES(%s,%s,%s,'git',1,1)",
                   (git_task, run, device))
        db.execute("INSERT INTO agentship_design.task_attempt(task_id,attempt_number,attempt_id,device_id,state,available_at) VALUES(%s,1,%s,%s,'succeeded',statement_timestamp())",
                   (git_task, git_attempt, device))
    return {'run': run, 'device': device, 'token': token, 'actor': actor, 'mode': 'demo'}


def poll(origin, data, slots=4, active=None, opt_in=True):
    body = {'protocolVersion': '1', 'availableSlots': slots, 'active': active or [], 'codexStatus': 'not_required'}
    if opt_in:
        body['acceptsAgentJobs'] = True
    return call(origin, data['token'], '/api/worker/poll', body)


def work(name, coordinator, dependencies=(), children=(), order='parallel'):
    return {'id': uuid(), 'name': name, 'type': 'work', 'purpose': 'backend', 'dependencies': list(dependencies),
            'coordinatorId': coordinator, 'agentIds': list(children), 'agentOrder': order}


def stage(name, *nodes):
    return {'id': uuid(), 'name': name, 'nodes': list(nodes)}


def end(*dependencies):
    return {'id': uuid(), 'name': 'Finish', 'type': 'end', 'dependencies': list(dependencies)}


def report(job, commit=None):
    commit = commit or hashlib.sha1(job['attemptId'].encode()).hexdigest()
    git = job['input']['git']
    return {
        'kind': 'product' if job['kind'] == 'coordinator' else 'other',
        'title': 'Synthetic report',
        'sourceRef': f"local-git:{job['runId']}/{job['taskId']}/{job['attemptId']}@{commit}:.agentship-results/{job['attemptId']}/result.md",
        'contentDigest': 'sha256:' + 'b' * 64,
        'commit': commit,
        'repositoryId': git['repository']['repositoryId'],
        'workBranch': git['workBranch'],
    }


def complete(origin, data, job, **extra):
    return Driver(origin, data, job).event('complete', {'artifacts': [report(job)], **extra})


def run_state(connect, data):
    with connect() as db:
        return db.execute('SELECT state,reason_code FROM agentship_design.run WHERE id=%s', (data['run'],)).fetchone()


def serial(owner, connect, origin):
    first = work('First', 'Coordinator', children=['Child A', 'Child B'], order='serial')
    flow, _ = create_flow(owner, [stage('Build', first, end(first['id']))], ['Coordinator', 'Child A', 'Child B'])
    data = fixture(owner, connect, origin, flow)
    assert poll(origin, data, opt_in=False)['jobs'] == []
    with ThreadPoolExecutor(max_workers=2) as pool:
        jobs = [job for result in pool.map(lambda _: poll(origin, data), range(2)) for job in result['jobs']]
    assert len(jobs) == 1 and jobs[0]['kind'] == 'agent' and jobs[0]['nodeId'] == first['id'], 'verified Git did not dispatch first selected serial Agent'
    child = jobs[0]
    assert child['input']['roleDisplayName'] == 'Child A'
    assert child['input']['siblingArtifacts'] == []
    assert child['input']['requirementRevision'] == 1
    assert poll(origin, data)['jobs'] == []
    active = [{key: child[key] for key in ('taskId', 'attemptId', 'epoch')}]
    assert poll(origin, data, 0, active)['renewed'][0]['taskId'] == child['taskId']
    driver = Driver(origin, data, child)
    scope = {'operationKey': 'forbidden', 'effect': 'create_work_branch', 'targetId': 'forbidden'}
    driver.authorize(scope, 403)
    driver.event('complete', {'artifacts': []}, 409)
    checkpoint = {'threadId': 'synthetic-thread', 'turnId': 'synthetic-turn'}
    event_key = uuid()
    first_ack = driver.event('progress', checkpoint, key=event_key)
    with connect() as db:
        db.execute("""INSERT INTO agentship_design.run_requirement_revision(run_id,revision,requirement_version,title,description,recorded_by)
            VALUES(%s,2,2,'Second revision','Changed while running',%s)""", (data['run'], data['actor']))
        db.execute('UPDATE agentship_design.run SET current_revision=2 WHERE id=%s', (data['run'],))
        db.execute("UPDATE agentship_design.task_attempt SET lease_deadline=statement_timestamp()-interval '1 second' WHERE task_id=%s", (child['taskId'],))
    reclaimed, = poll(origin, data)['jobs']
    assert reclaimed['epoch'] > child['epoch'] and reclaimed['attemptId'] == child['attemptId']
    assert reclaimed['checkpoint'] == checkpoint
    assert reclaimed['input']['requirementRevision'] == 1
    driver.event('progress', {'threadId': 'stale-thread'}, 409)
    replay = driver.event('progress', checkpoint, key=event_key, sequence=1)
    assert replay['duplicate'] and replay['receiptId'] == first_ack['receiptId']
    driver.event('progress', {'threadId': 'changed'}, 409, key=event_key, sequence=1)
    complete(origin, data, reclaimed)
    second, = poll(origin, data)['jobs']
    assert second['input']['roleDisplayName'] == 'Child B' and second['input']['requirementRevision'] == 1
    assert second['input']['siblingArtifacts'][0]['sourceRef'] == report(child)['sourceRef']
    complete(origin, data, second)
    coordinator, = poll(origin, data)['jobs']
    assert coordinator['kind'] == 'coordinator' and coordinator['input']['requirementRevision'] == 1
    assert [ref['sourceRef'] for ref in coordinator['input']['siblingArtifacts']] == [report(child)['sourceRef'], report(second)['sourceRef']]
    coordinator_driver = Driver(origin, data, coordinator)
    invalid = {**report(coordinator), 'sourceRef': '../../other-run.md'}
    coordinator_driver.event('complete', {'artifacts': [invalid]}, 409)
    assert run_state(connect, data)[0] == 'running'
    final_key = uuid()
    final_ack = coordinator_driver.event('complete', {'artifacts': [report(coordinator)]}, key=final_key)
    final_replay = coordinator_driver.event('complete', {'artifacts': [report(coordinator)]}, key=final_key, sequence=1)
    assert final_replay['duplicate'] and final_replay['receiptId'] == final_ack['receiptId']
    assert run_state(connect, data) == ('completed', None)
    assert poll(origin, data)['jobs'] == []
    with connect() as db:
        assert db.execute('SELECT count(*) FROM agentship_design.artifact WHERE run_id=%s', (data['run'],)).fetchone() == (3,)
        assert db.execute('SELECT count(*) FROM agentship_design.role_task WHERE run_id=%s', (data['run'],)).fetchone() == (4,)
    print('PASS serial selected roles, revision pin, one claim under concurrent polls, fencing, final artifact gate and end idempotency')


def parallel(owner, connect, origin):
    first = work('First root', 'Coordinator')
    second = work('Second root', 'Coordinator')
    left = work('Left sibling', 'Coordinator', [first['id'], second['id']], ['Child A', 'Child B'])
    right = work('Right sibling', 'Coordinator', [first['id']])
    separate = work('Unrelated sibling', 'Coordinator')
    stages = [stage('Define', first, second), stage('Build', left, right, separate, end(left['id'], right['id']))]
    flow, _ = create_flow(owner, stages, ['Coordinator', 'Child A', 'Child B'])
    data = fixture(owner, connect, origin, flow)
    first_job, = poll(origin, data)['jobs']
    assert first_job['nodeId'] == first['id']
    assert poll(origin, data)['jobs'] == []
    complete(origin, data, first_job)
    second_job, = poll(origin, data)['jobs']
    assert second_job['nodeId'] == second['id']
    complete(origin, data, second_job)
    left_a, left_b, right_job = poll(origin, data)['jobs']
    assert [left_a['nodeId'], left_b['nodeId'], right_job['nodeId']] == [left['id'], left['id'], right['id']]
    assert [left_a['input']['roleDisplayName'], left_b['input']['roleDisplayName']] == ['Child A', 'Child B']
    assert left_b['input']['siblingArtifacts'] == []
    assert [ref['sourceRef'] for ref in right_job['input']['upstreamArtifacts']] == [report(first_job)['sourceRef']]
    assert len(left_a['input']['upstreamArtifacts']) == 2
    complete(origin, data, right_job)
    complete(origin, data, left_a)
    assert poll(origin, data)['jobs'] == []
    complete(origin, data, left_b)
    left_final, = poll(origin, data)['jobs']
    assert left_final['nodeId'] == left['id'] and len(left_final['input']['siblingArtifacts']) == 2
    complete(origin, data, left_final)
    separate_job, = poll(origin, data)['jobs']
    assert separate_job['nodeId'] == separate['id']
    assert separate_job['input']['upstreamArtifacts'] == []
    assert run_state(connect, data)[0] == 'running'
    complete(origin, data, separate_job)
    assert run_state(connect, data) == ('completed', None)
    print('PASS stage barrier, deterministic roots, common-upstream parallel nodes and children, global end join')


def questions(owner, connect, origin):
    first = work('Blocked role', 'Coordinator', children=['Question child', 'Independent child'])
    next_node = work('Downstream', 'Coordinator', [first['id']])
    flow, _ = create_flow(owner, [stage('Build', first, next_node, end(next_node['id']))],
                          ['Coordinator', 'Question child', 'Independent child'])
    data = fixture(owner, connect, origin, flow)
    job, = poll(origin, data, 1)['jobs']
    assert job['input']['roleDisplayName'] == 'Question child'
    driver = Driver(origin, data, job)
    driver.event('progress', {'threadId': 'fixture-question-session'})
    result = {'text': 'Please supply synthetic input', 'sessionRef': 'fixture-question-session'}
    driver.event('question', {**result, 'sessionRef': 'other-session'}, 409)
    event_key = uuid()
    ack = driver.event('question', result, key=event_key)
    assert driver.event('question', result, key=event_key, sequence=2)['receiptId'] == ack['receiptId']
    driver.event('complete', {'artifacts': [report(job)]}, 409)
    assert run_state(connect, data) == ('waiting', 'AGENT_QUESTION_PENDING')
    sibling, = poll(origin, data, 1)['jobs']
    assert sibling['input']['roleDisplayName'] == 'Independent child'
    complete(origin, data, sibling)
    assert poll(origin, data)['jobs'] == []
    with connect() as db:
        rows = db.execute('SELECT body,session_ref FROM agentship_design.agent_question WHERE run_id=%s', (data['run'],)).fetchall()
    assert rows == [(result['text'], result['sessionRef'])]
    print('PASS question stays in its original session and blocks downstream while queued parallel sibling continues')


def failures(owner, connect, origin):
    first = work('Build', 'Coordinator', children=['Failing child', 'Independent child'])
    downstream = work('Downstream', 'Coordinator', [first['id']])
    flow, _ = create_flow(owner, [stage('Build', first, downstream, end(downstream['id']))],
                          ['Coordinator', 'Failing child', 'Independent child'])
    data = fixture(owner, connect, origin, flow)
    other = fixture(owner, connect, origin, flow)
    job, = poll(origin, data, 1)['jobs']
    assert job['input']['roleDisplayName'] == 'Failing child'
    failure = {'reasonCode': 'UNSAFE_PROVIDER_DETAILS', 'message': 'Synthetic diagnostic', 'retryable': False}
    Driver(origin, other, job).event('failure', failure, 404)
    Driver(origin, data, job).event('failure', failure)
    assert run_state(connect, data) == ('needs_attention', 'AGENT_EXECUTION_FAILED')
    sibling, = poll(origin, data, 1)['jobs']
    assert sibling['input']['roleDisplayName'] == 'Independent child'
    complete(origin, data, sibling)
    assert poll(origin, data)['jobs'] == []
    assert run_state(connect, data) == ('needs_attention', 'AGENT_EXECUTION_FAILED')
    print('PASS wrong device cannot report, failed role is sanitized, independent sibling continues, no false coordinator release')


def checks(owner, connect, origin):
    check = work('Check', 'Coordinator')
    check['type'] = 'check'
    passed = work('Pass route', 'Coordinator')
    repair = work('Repair route', 'Coordinator')
    repair['type'] = 'check'
    nested_pass = work('Nested pass', 'Coordinator')
    nested_repair = work('Nested repair', 'Coordinator')
    check['checkRoutes'] = {'passNodeId': passed['id'], 'repairNodeId': repair['id'], 'automaticRepairLimit': 3}
    repair['checkRoutes'] = {'passNodeId': nested_pass['id'], 'repairNodeId': nested_repair['id'], 'automaticRepairLimit': 2}
    passed['route'] = {'checkNodeId': check['id'], 'outcome': 'pass'}
    repair['route'] = {'checkNodeId': check['id'], 'outcome': 'repair'}
    nested_pass['route'] = {'checkNodeId': repair['id'], 'outcome': 'pass'}
    nested_repair['route'] = {'checkNodeId': repair['id'], 'outcome': 'repair'}
    flow, _ = create_flow(owner, [
        stage('Check stage', check, passed, repair, nested_pass, nested_repair, end(passed['id'])),
    ], ['Coordinator'])
    for outcome in ('pass', 'repair', 'unresolved'):
        data = fixture(owner, connect, origin, flow)
        job, = poll(origin, data)['jobs']
        assert job['nodeId'] == check['id']
        candidate = job['input']['checkCandidate']
        result = {'outcome': outcome, 'testedCommit': candidate['commit'], 'testedArtifactVersion': candidate['version']}
        driver = Driver(origin, data, job)
        if outcome == 'pass':
            driver.event('complete', {'artifacts': [report(job)], 'check': {**result, 'testedCommit': '0' * 40}}, 409)
        driver.event('complete', {'artifacts': [report(job)], 'check': result})
        jobs = poll(origin, data)['jobs']
        if outcome == 'pass':
            assert len(jobs) == 1 and jobs[0]['nodeId'] == passed['id']
            assert jobs[0]['input']['upstreamArtifacts'][0]['sourceRef'] == report(job)['sourceRef']
            complete(origin, data, jobs[0])
            assert run_state(connect, data) == ('completed', None)
            with connect() as db:
                inactive = db.execute("""
                    SELECT count(*) FROM agentship_design.node_execution WHERE run_id=%s AND state='skipped'
                    """, (data['run'],)).fetchone()
            assert inactive == (3,)
        elif outcome == 'repair':
            assert len(jobs) == 1 and jobs[0]['nodeId'] == repair['id']
            assert jobs[0]['input']['upstreamArtifacts'][0]['sourceRef'] == report(job)['sourceRef']
        else:
            assert jobs == [] and run_state(connect, data) == ('needs_attention', 'AGENT_CHECK_UNRESOLVED')
    print('PASS exact candidate evidence selects only its route, unresolved retains attention')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--java', type=Path, required=True)
    parser.add_argument('--jar', type=Path, default=JAR)
    args = parser.parse_args()
    sys.path.insert(0, str(WORKSPACE / 'pg-python'))
    import psycopg
    with tempfile.TemporaryDirectory(prefix='node-jobs-', dir=WORKSPACE) as folder:
        scratch = Path(folder)
        with postgres(WORKSPACE / 'tools' / 'pg17' / 'bin', scratch) as dbport:
            def connect():
                return psycopg.connect(host='127.0.0.1', port=dbport, user='design_check', dbname='postgres')
            with platform(args.java, args.jar, scratch, dbport, free_port(), secrets.token_urlsafe(40), 'initial') as origin:
                owner = Browser(origin)
                create_account(owner, account('node_jobs_owner', 980))
                serial(owner, connect, origin)
                parallel(owner, connect, origin)
                questions(owner, connect, origin)
                failures(owner, connect, origin)
                checks(owner, connect, origin)


if __name__ == '__main__':
    main()
