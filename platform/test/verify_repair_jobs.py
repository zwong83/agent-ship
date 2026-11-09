"""Check and repair rounds through the packaged HTTP/PostgreSQL boundary."""

import argparse
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import secrets
import sys
import tempfile

from verify_first_batch import Browser, JAR, WORKSPACE, account, create_account, free_port, platform, postgres
from verify_git_jobs import Driver
from verify_node_jobs import complete, create_flow, end, fixture, poll, report, run_state, stage, uuid, work


def check_graph(name, limit, dependencies=()):
    check = work(name, 'Coordinator', dependencies)
    check['type'] = 'check'
    passed = work(name + ' passed', 'Coordinator', [check['id']])
    repair = work(name + ' fix', 'Coordinator')
    repair['purpose'] = 'repair'
    check['checkRoutes'] = {'passNodeId': passed['id'], 'repairNodeId': repair['id'], 'automaticRepairLimit': limit}
    passed['route'] = {'checkNodeId': check['id'], 'outcome': 'pass'}
    repair['route'] = {'checkNodeId': check['id'], 'outcome': 'repair'}
    return check, passed, repair


def check_event(job, outcome):
    candidate = job['input']['checkCandidate']
    return {'artifacts': [report(job)], 'check': {
        'outcome': outcome, 'testedCommit': candidate['commit'], 'testedArtifactVersion': candidate['version'],
    }}


def check_result(origin, data, job, outcome):
    return Driver(origin, data, job).event('complete', check_event(job, outcome))


def progress(connect, data, check):
    with connect() as db:
        return db.execute("""SELECT current_wave,automatic_repair_count,manual_repair_count,state
            FROM agentship_design.check_cycle WHERE run_id=%s AND check_node_id=%s""",
            (data['run'], check['id'])).fetchone()


def cross_stage(owner, connect, origin, last_outcome):
    seed = work('Seed', 'Coordinator')
    check, passed, repair = check_graph('Original check', 2, [seed['id']])
    sibling = work('Independent route', 'Coordinator', [seed['id']])
    continuation = work('Independent continuation', 'Coordinator', [sibling['id']])
    # The repair branch bypasses normal phase progression, even though its final node
    # is after the phase containing the pass-gated nodes.
    final_fix = work('Finish fix', 'Coordinator', [repair['id']])
    final_fix['route'] = dict(repair['route'])
    flow, _ = create_flow(owner, [stage('Checks', seed, check, sibling, continuation), stage('Next', passed),
        stage('Fix', repair), stage('Fix continuation', final_fix, end(passed['id'], continuation['id']))], ['Coordinator'])
    data = fixture(owner, connect, origin, flow)
    seed_job, = poll(origin, data)['jobs']
    complete(origin, data, seed_job)
    original, = poll(origin, data, 1)['jobs']
    assert original['nodeId'] == check['id']
    driver = Driver(origin, data, original)
    key = uuid()
    result = check_event(original, 'repair')
    ack = driver.event('complete', result, key=key)
    assert driver.event('complete', result, key=key, sequence=1)['receiptId'] == ack['receiptId']

    for round_number in (1, 2):
        jobs = poll(origin, data)['jobs']
        fixes = [job for job in jobs if job['nodeId'] == repair['id']]
        assert len(fixes) == 1, 'repair conclusion did not open the cross-stage repair route'
        fix, = fixes
        assert fix['wave'] == round_number
        assert any(ref['sourceRef'] == report(original)['sourceRef'] for ref in fix['input']['upstreamArtifacts'])
        if round_number == 1:
            independent, = [job for job in jobs if job['nodeId'] == sibling['id']]
        else:
            assert jobs == [fix]
        assert progress(connect, data, check) == (round_number, round_number, 0, 'repair')
        complete(origin, data, fix)
        finish_fix, = poll(origin, data)['jobs']
        assert finish_fix['nodeId'] == final_fix['id'] and finish_fix['wave'] == round_number
        assert any(ref['sourceRef'] == report(fix)['sourceRef'] for ref in finish_fix['input']['upstreamArtifacts'])
        complete(origin, data, finish_fix)
        with ThreadPoolExecutor(max_workers=2) as pool:
            rechecks = [job for response in pool.map(lambda _: poll(origin, data), range(2)) for job in response['jobs']]
        assert len(rechecks) == 1
        original, = rechecks
        assert original['nodeId'] == check['id'] and original['wave'] == round_number + 1
        assert original['input']['checkCandidate'] == {'commit': report(finish_fix)['commit'], 'version': report(finish_fix)['sourceRef']}
        assert any(ref['sourceRef'] == report(finish_fix)['sourceRef'] for ref in original['input']['upstreamArtifacts'])
        assert progress(connect, data, check) == (round_number + 1, round_number, 0, 'pending')
        if round_number == 2 and last_outcome == 'repair':
            # The poll and final check receipt have separate HTTP/PostgreSQL transactions.
            # Before commit the old check still owns the lease; after commit the cap is visible.
            with ThreadPoolExecutor(max_workers=2) as pool:
                completion = pool.submit(check_result, origin, data, original, 'repair')
                claim = pool.submit(poll, origin, data)
                assert claim.result()['jobs'] == [] and completion.result()['accepted']
        else:
            check_result(origin, data, original, 'repair' if round_number == 1 else last_outcome)

    assert progress(connect, data, check) == (3, 2, 0, 'pass' if last_outcome == 'pass' else 'limit_reached')
    assert run_state(connect, data)[0] != 'completed'
    if last_outcome == 'repair':
        assert run_state(connect, data) == ('needs_attention', 'AGENT_REPAIR_LIMIT_REACHED')
        lease = {name: independent[name] for name in ('taskId', 'attemptId', 'epoch')}
        response = poll(origin, data, active=[lease])
        assert response['jobs'] == [] and response['renewed'][0]['taskId'] == independent['taskId']
        with connect() as db:
            for node in (check, passed, repair, final_fix, sibling):
                opened, = db.execute('SELECT agentship_design.task_route_is_open(%s,%s)',
                    (data['run'], node['id'])).fetchone()
                assert opened == (node is sibling)
        # Agent work never carries a Git write scope, including after the route cap.
        Driver(origin, data, fix).authorize({'operationKey': 'fixture', 'effect': 'create_work_branch', 'targetId': 'fixture'}, 403)
    complete(origin, data, independent)
    continuation_jobs = poll(origin, data)['jobs']
    assert [job['nodeId'] for job in continuation_jobs] == [continuation['id']], 'independent successor did not continue after local pause'
    continuation_job, = continuation_jobs
    complete(origin, data, continuation_job)
    if last_outcome == 'pass':
        next_job, = poll(origin, data)['jobs']
        assert next_job['nodeId'] == passed['id']
        complete(origin, data, next_job)
        assert run_state(connect, data) == ('completed', None)
    else:
        assert poll(origin, data)['jobs'] == []
    with connect() as db:
        history = db.execute("""SELECT wave,outcome FROM agentship_design.check_wave
            WHERE run_id=%s AND check_node_id=%s ORDER BY wave""", (data['run'], check['id'])).fetchall()
        rounds = db.execute("""SELECT round_number,triggering_wave,state FROM agentship_design.repair_round
            WHERE run_id=%s AND check_node_id=%s ORDER BY round_number""", (data['run'], check['id'])).fetchall()
    assert history == [(1, 'repair'), (2, 'repair'), (3, last_outcome)]
    assert rounds == [(1, 1, 'complete'), (2, 2, 'complete')]
    print('PASS cross-stage repair, repeat rounds, stable artifacts and ' + ('pass at the limit' if last_outcome == 'pass' else 'local cap'))


def nested_and_independent_counts(owner, connect, origin):
    outer, passed, nested = check_graph('Outer check', 1)
    nested['type'] = 'check'
    inner_pass = work('Nested pass handoff', 'Coordinator', [nested['id']])
    inner_fix = work('Nested fix', 'Coordinator')
    inner_fix['purpose'] = 'repair'
    nested['checkRoutes'] = {'passNodeId': inner_pass['id'], 'repairNodeId': inner_fix['id'], 'automaticRepairLimit': 2}
    inner_pass['route'] = {'checkNodeId': nested['id'], 'outcome': 'pass'}
    inner_fix['route'] = {'checkNodeId': nested['id'], 'outcome': 'repair'}
    flow, _ = create_flow(owner, [stage('Checks', outer, passed), stage('Outer fix', nested),
        stage('Nested pass', inner_pass), stage('Nested repair', inner_fix, end(passed['id']))], ['Coordinator'])
    data = fixture(owner, connect, origin, flow)

    def next_job(node, wave):
        job, = poll(origin, data)['jobs']
        assert job['nodeId'] == node['id'] and job['wave'] == wave
        return job

    check_result(origin, data, next_job(outer, 1), 'repair')
    for round_number in (1, 2):
        check_result(origin, data, next_job(nested, round_number), 'repair')
        complete(origin, data, next_job(inner_fix, round_number))
        assert progress(connect, data, outer) == (1, 1, 0, 'repair')
        assert progress(connect, data, nested) == (round_number + 1, round_number, 0, 'pending')
    check_result(origin, data, next_job(nested, 3), 'pass')
    handoff = next_job(inner_pass, 1)
    complete(origin, data, handoff)
    outer_recheck = next_job(outer, 2)
    # The terminal work output of the actual selected path is the repair candidate.
    assert outer_recheck['input']['checkCandidate']['version'] == report(handoff)['sourceRef']
    check_result(origin, data, outer_recheck, 'pass')
    complete(origin, data, next_job(passed, 1))
    assert progress(connect, data, outer) == (2, 1, 0, 'pass')
    assert progress(connect, data, nested) == (3, 2, 0, 'pass')
    assert run_state(connect, data) == ('completed', None)
    print('PASS nested checks preserve independent counters and outer repair waits for the selected nested route')


def zero_cap_and_malformed_check(owner, connect, origin):
    check, passed, repair = check_graph('Manual-only check', 0)
    flow, _ = create_flow(owner, [stage('Check', check, passed, repair, end(passed['id']))], ['Coordinator'])
    for result, state, reason in (
        ('repair', 'limit_reached', 'AGENT_REPAIR_LIMIT_REACHED'),
        ('not-a-verdict', 'unresolved', 'AGENT_CHECK_UNRESOLVED'),
    ):
        data = fixture(owner, connect, origin, flow)
        job, = poll(origin, data)['jobs']
        check_result(origin, data, job, result)
        assert progress(connect, data, check) == (1, 0, 0, state)
        assert run_state(connect, data) == ('needs_attention', reason)
        assert poll(origin, data)['jobs'] == []
        with connect() as db:
            assert db.execute('SELECT agentship_design.check_action_is_available(%s,%s,%s)',
                (data['run'], check['id'], state)).fetchone() == (True,)
            assert db.execute('SELECT count(*) FROM agentship_design.repair_round WHERE run_id=%s',
                (data['run'],)).fetchone() == (0,)
    print('PASS zero cap creates no automatic round and an unrecognized verdict waits with neither route released')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--java', type=Path, required=True)
    parser.add_argument('--jar', type=Path, default=JAR)
    args = parser.parse_args()
    sys.path.insert(0, str(WORKSPACE / 'pg-python'))
    import psycopg
    with tempfile.TemporaryDirectory(prefix='repair-jobs-', dir=WORKSPACE) as folder:
        scratch = Path(folder)
        with postgres(WORKSPACE / 'tools' / 'pg17' / 'bin', scratch) as dbport:
            def connect():
                return psycopg.connect(host='127.0.0.1', port=dbport, user='design_check', dbname='postgres')

            with platform(args.java, args.jar, scratch, dbport, free_port(), secrets.token_urlsafe(40), 'initial') as origin:
                owner = Browser(origin)
                create_account(owner, account('repair_jobs_owner', 990))
                cross_stage(owner, connect, origin, 'pass')
                cross_stage(owner, connect, origin, 'repair')
                nested_and_independent_counts(owner, connect, origin)
                zero_cap_and_malformed_check(owner, connect, origin)


if __name__ == '__main__':
    main()
