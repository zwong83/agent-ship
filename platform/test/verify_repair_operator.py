"""Verify authorized repair actions and single-tab ownership over HTTP/PostgreSQL."""

import argparse
from pathlib import Path
import secrets
import sys
import tempfile
from concurrent.futures import ThreadPoolExecutor

from verify_first_batch import Browser, JAR, WORKSPACE, account, create_account, free_port, platform, postgres
from verify_git_jobs import Driver
from verify_node_jobs import complete, create_flow, end, fixture, poll, report, stage, uuid, work


def verdict(origin, data, job, outcome):
    candidate = job['input']['checkCandidate']
    return Driver(origin, data, job).event('complete', {'artifacts': [report(job)], 'check': {
        'outcome': outcome, 'testedCommit': candidate['commit'], 'testedArtifactVersion': candidate['version'],
    }})


def verify(owner, guest, deputy, connect, origin):
    check = work('Check', 'Coordinator')
    check['type'] = 'check'
    passed, repair = work('Pass', 'Coordinator'), work('Repair', 'Coordinator')
    check['checkRoutes'] = {'passNodeId': passed['id'], 'repairNodeId': repair['id'], 'automaticRepairLimit': 0}
    passed['route'] = {'checkNodeId': check['id'], 'outcome': 'pass'}
    repair['route'] = {'checkNodeId': check['id'], 'outcome': 'repair'}
    flow, _ = create_flow(owner, [stage('Check stage', check, passed, repair, end(passed['id']))], ['Coordinator'])
    data = fixture(owner, connect, origin, flow)
    path = '/api/runs/' + data['run']
    chat = path + '/chat'
    access = chat + '/access'
    actions = path + '/actions'
    tab, other = uuid(), uuid()
    guest_id = guest.get('/api/me')['user']['id']
    with connect() as db:
        requirement, = db.execute('SELECT requirement_id FROM agentship_design.run WHERE id=%s', (data['run'],)).fetchone()
    owner.post('/api/objects/requirements/' + str(requirement) + '/ownership',
               {'action': 'add_deputy', 'username': 'repair_deputy', 'expectedVersion': 1})
    guest.post(chat, {'action': 'acquire', 'tabId': other}, 404)
    deputy.post(chat, {'action': 'acquire', 'tabId': other}, 404)
    owner.post(access, {'action': 'grant', 'username': 'repair_deputy'}, 409)
    owner.post(access, {'action': 'grant', 'username': 'repair_guest'})
    assert [item['id'] for item in owner.get(access)['guests']] == [guest_id]
    guest.get(path, 404)
    guest.get(access, 404)
    # A single run owner and guest race for the same row. Only one receives a credential.
    with ThreadPoolExecutor(max_workers=2) as pool:
        attempts = list(pool.map(lambda args: args[0].call('POST', chat, expected=(200, 409),
            body={'action': 'acquire', 'tabId': args[1]}), [(owner, tab), (guest, other)]))
    assert sorted(item[0] for item in attempts) == [200, 409]
    if attempts[1][0] == 200:
        owner.post(access, {'action': 'revoke', 'userId': guest_id})
    lease = owner.post(chat, {'action': 'acquire', 'tabId': tab})
    proof = {'tabId': tab, 'epoch': lease['epoch'], 'leaseCredential': lease['credential']}
    conflict = owner.post(chat, {'action': 'acquire', 'tabId': other}, 409)
    assert conflict['error']['code'] == 'CHAT_OCCUPIED'
    owner.post(chat, {'action': 'release', **proof, 'tabId': other}, 409)
    owner.post(access, {'action': 'grant', 'username': 'repair_guest'})
    with connect() as db:
        db.execute("""UPDATE agentship_design.chat_lease SET heartbeat_until=statement_timestamp()-interval '1 second',
                    grace_until=statement_timestamp()+interval '299 seconds' WHERE run_id=%s""", (data['run'],))
    guest.post(chat, {'action': 'acquire', 'tabId': other}, 409)
    renewed = owner.post(chat, {'action': 'heartbeat', **proof})
    assert renewed['epoch'] == lease['epoch']
    with connect() as db:
        db.execute("""UPDATE agentship_design.chat_lease SET heartbeat_until=statement_timestamp()-interval '5 minutes 1 second',
                    grace_until=statement_timestamp()-interval '1 second' WHERE run_id=%s""", (data['run'],))
    guest_lease = guest.post(chat, {'action': 'acquire', 'tabId': other})
    assert guest_lease['epoch'] > lease['epoch']
    owner.post(chat, {'action': 'release', **proof}, 409)
    owner.post(access, {'action': 'revoke', 'userId': guest_id})
    guest.post(chat, {'action': 'heartbeat', 'tabId': other, 'epoch': guest_lease['epoch'],
                     'leaseCredential': guest_lease['credential']}, 404)
    lease = owner.post(chat, {'action': 'acquire', 'tabId': tab})
    proof = {'tabId': tab, 'epoch': lease['epoch'], 'leaseCredential': lease['credential']}
    print('PASS operator races, exact tab fencing, grace, renewal, takeover and revocation')

    job, = poll(origin, data)['jobs']
    assert job['nodeId'] == check['id']
    verdict(origin, data, job, 'unresolved')
    assert owner.get(path + '/repair-control')['targets'][0]['actions'] == ['recheck']
    cmd = {'action': 'recheck', 'targetId': check['id'], 'wave': 1, **proof}
    owner.post(actions, cmd, 403, csrf=False)
    deputy.post(actions, cmd, 404)
    owner.post(actions, {**cmd, 'wave': 2}, 409)
    key = uuid()
    accepted = owner.post(actions, cmd, key=key)
    assert owner.post(actions, cmd, key=key)['receiptId'] == accepted['receiptId']
    owner.post(actions, {**cmd, 'wave': 2}, 409, key=key)
    job, = poll(origin, data)['jobs']
    assert job['nodeId'] == check['id'] and job['wave'] == 2
    verdict(origin, data, job, 'repair')
    assert poll(origin, data)['jobs'] == []
    repair_cmd = {'action': 'repair', 'targetId': check['id'], 'wave': 2, **proof}
    key = uuid()
    accepted = owner.post(actions, repair_cmd, key=key)
    assert owner.post(actions, repair_cmd, key=key)['receiptId'] == accepted['receiptId']
    repair_job, = poll(origin, data)['jobs']
    assert repair_job['nodeId'] == repair['id']
    complete(origin, data, repair_job)
    recheck, = poll(origin, data)['jobs']
    assert recheck['nodeId'] == check['id'] and recheck['wave'] == 3
    verdict(origin, data, recheck, 'repair')
    assert not poll(origin, data)['jobs']
    owner.post(actions, {'action': 'stop', 'targetId': check['id'], 'wave': 3, **proof})
    assert owner.get(path)['state'] == 'stopped' and not poll(origin, data)['jobs']
    with connect() as db:
        counts = db.execute('SELECT automatic_repair_count,manual_repair_count FROM agentship_design.check_cycle WHERE run_id=%s',
                            (data['run'],)).fetchone()
        assert counts == (0, 1)
        actions_recorded = db.execute("SELECT count(*) FROM agentship_design.audit_event WHERE run_id=%s AND target_kind='check'",
                                      (data['run'],)).fetchone()[0]
        assert actions_recorded == 3
    print('PASS missing verdict recheck, exactly one manual repair, new candidate, stop, audit and replay')
    owner.post(access, {'action': 'grant', 'username': 'repair_guest'})
    owner.post('/api/logout')
    assert guest.post(chat, {'action': 'acquire', 'tabId': other})['epoch'] > lease['epoch']
    owner.post(chat, {'action': 'heartbeat', **proof}, 401)
    print('PASS logout clears the held lease and fences the old browser session')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--java', type=Path, required=True)
    parser.add_argument('--jar', type=Path, default=JAR)
    args = parser.parse_args()
    sys.path.insert(0, str(WORKSPACE / 'pg-python'))
    import psycopg
    with tempfile.TemporaryDirectory(prefix='repair-operator-', dir=WORKSPACE) as folder:
        scratch = Path(folder)
        with postgres(WORKSPACE / 'tools' / 'pg17' / 'bin', scratch) as dbport:
            def connect():
                return psycopg.connect(host='127.0.0.1', port=dbport, user='design_check', dbname='postgres')
            with platform(args.java, args.jar, scratch, dbport, free_port(), secrets.token_urlsafe(40), 'initial') as origin:
                owner, guest, deputy = [Browser(origin) for _ in range(3)]
                for browser, username, number in [(owner, 'repair_owner', 985), (guest, 'repair_guest', 986), (deputy, 'repair_deputy', 987)]:
                    create_account(browser, account(username, number))
                verify(owner, guest, deputy, connect, origin)


if __name__ == '__main__':
    main()
