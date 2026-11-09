"""Check archive fencing and first-dispatch/readback decisions on Java/PostgreSQL."""

import argparse
from pathlib import Path
import secrets
import sys
import tempfile

from verify_first_batch import Browser, JAR, WORKSPACE, account, create_account, free_port, platform, postgres
from verify_git_jobs import call
from verify_node_jobs import complete, create_flow, end, fixture, poll, stage, work


def verify(owner, connect, origin):
    node = work('Delivery', 'Coordinator')
    flow, _ = create_flow(owner, [stage('Delivery stage', node, end(node['id']))], ['Coordinator'])
    device = fixture(owner, connect, origin, flow)
    job, = poll(origin, device)['jobs']
    complete(origin, device, job)
    path = '/api/runs/' + device['run']
    snapshot = owner.get(path)
    artifact, = snapshot['stages'][0]['nodes'][0]['artifacts']
    assert snapshot['state'] == 'completed'
    body = {'artifactId': artifact['id'], 'expectedCommit': artifact['commit'], 'publicApproved': True}
    runtime = lambda method, data, expected=200: call(origin, device['token'], '/api/worker/archive/' + method, data, expected)
    assert not runtime('poll', {}).get('job')
    first_approval = owner.post(path + '/archives', body)
    assert owner.post(path + '/archives', body) == first_approval
    event_path = path + '/events?cursor=' + snapshot['eventsCursor']
    event, = owner.get(event_path)['items']
    assert event['kind'] == 'run_changed' and set(event) == {'kind', 'sequence', 'runVersion', 'time'}
    stale = runtime('poll', {})['job']
    key = lambda job: {field: job[field] for field in ('artifactId', 'epoch')}
    runtime('result', {**key(stale), 'state': 'failed', 'reasonCode': 'ARCHIVE_SOURCE_UNAVAILABLE'})
    failed = owner.get(path)['stages'][0]['nodes'][0]['artifacts'][0]['archive']
    assert failed['retryable']
    assert owner.post(path + '/archives', body) == failed
    assert not runtime('poll', {}).get('job')
    retry = {**body, 'retryApprovalAt': failed['retryApprovalAt']}
    owner.post(path + '/archives', retry)
    active = runtime('poll', {})['job']
    assert active['epoch'] > stale['epoch']
    export = '3' * 40
    runtime('authorize', {**key(stale), 'exportCommit': export}, 409)
    permission = runtime('authorize', {**key(active), 'exportCommit': export})
    assert permission['decision'] == 'dispatch' and permission['expiresAt'] <= active['deadlineAt']
    assert runtime('authorize', {**key(active), 'exportCommit': export}) == {'decision': 'reconcile'}
    runtime('result', {**key(active), 'state': 'unknown'})
    assert owner.post(path + '/archives', body)['state'] == 'unknown'
    with connect() as db:
        db.execute("UPDATE agentship_design.artifact_archive SET available_at=statement_timestamp()-interval '1 second' WHERE artifact_id=%s", (artifact['id'],))
    renewed = runtime('poll', {})['job']
    assert renewed['epoch'] > active['epoch'] and renewed['exportCommit'] == export
    runtime('authorize', {**key(renewed), 'exportCommit': '4' * 40}, 409)
    assert runtime('authorize', {**key(renewed), 'exportCommit': export}) == {'decision': 'reconcile'}
    result = {**key(renewed), 'state': 'succeeded', 'ref': renewed['ref'], 'observedCommit': export}
    runtime('result', {**result, 'observedCommit': '4' * 40}, 409)
    runtime('result', {**result, 'epoch': active['epoch']}, 409)
    runtime('result', result)
    assert runtime('result', result)['duplicate']
    assert owner.post(path + '/archives', body)['commit'] == export
    assert not runtime('poll', {}).get('job')
    with connect() as db:
        assert db.execute("SELECT count(*) FROM agentship_design.audit_event WHERE action='approve_archive'").fetchone() == (2,)
    print('PASS archive scope, explicit pre-dispatch reapproval, coalesced events, stale epochs and read-only unknown reconciliation')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--java', type=Path, required=True)
    parser.add_argument('--jar', type=Path, default=JAR)
    args = parser.parse_args()
    sys.path.insert(0, str(WORKSPACE / 'pg-python'))
    import psycopg
    with tempfile.TemporaryDirectory(prefix='archive-jobs-', dir=WORKSPACE) as folder:
        scratch = Path(folder)
        with postgres(WORKSPACE / 'tools' / 'pg17' / 'bin', scratch) as dbport:
            def connect():
                return psycopg.connect(host='127.0.0.1', port=dbport, user='design_check', dbname='postgres')
            with platform(args.java, args.jar, scratch, dbport, free_port(), secrets.token_urlsafe(40), 'initial') as origin:
                owner = Browser(origin)
                create_account(owner, account('archive_owner', 994))
                verify(owner, connect, origin)


if __name__ == '__main__':
    main()
