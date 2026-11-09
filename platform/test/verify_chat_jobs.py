"""Exercise authorized chat, durable task delivery and revision actions over HTTP."""

import argparse
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import secrets
import sys
import tempfile
from urllib.error import HTTPError
from urllib.parse import urlencode
from urllib.request import Request
import json

from verify_first_batch import Browser, JAR, WORKSPACE, account, create_account, free_port, platform, postgres
from verify_git_jobs import Driver
from verify_node_jobs import complete, create_flow, end, fixture, poll, report, stage, uuid, work


def lease(browser, run):
    tab = uuid()
    view = browser.post(f'/api/runs/{run}/chat', {'action': 'acquire', 'tabId': tab})
    return {'tabId': tab, 'epoch': view['epoch'], 'leaseCredential': view['credential']}


def chat(browser, run, proof, expected=200, **query):
    path = f'/api/runs/{run}/chat?' + urlencode({'tabId': proof['tabId'], 'epoch': proof['epoch'], **query})
    request = Request(browser.origin + path, headers={'X-Chat-Lease': proof['leaseCredential']})
    try:
        response = browser.opener.open(request, timeout=15)
    except HTTPError as err:
        response = err
    with response:
        body = json.loads(response.read())
        assert response.status == expected, (response.status, body.get('error', {}).get('code'))
        return body


def action(browser, run, proof, name, expected=200, key=None, **fields):
    return browser.post(f'/api/runs/{run}/actions', {'action': name, **proof, **fields}, expected, key=key)


def active(*jobs):
    return [{key: job[key] for key in ('taskId', 'attemptId', 'epoch')} for job in jobs]


def chat_delivery(owner, guest, connect, origin):
    node = work('Build', 'Coordinator', children=['Alpha', 'Beta'])
    flow, _ = create_flow(owner, [stage('Chat', node, end(node['id']))], ['Coordinator', 'Alpha', 'Beta'])
    data = fixture(owner, connect, origin, flow)
    run = data['run']
    owner.post(f'/api/runs/{run}/chat/access', {'action': 'grant', 'username': 'chat_guest'})
    proof = lease(guest, run)
    view = chat(guest, run, proof)
    assert not view['messages'] and not view['questions']
    chat(guest, run, {**proof, 'tabId': uuid()}, 409)
    owner.get(f'/api/runs/{run}/chat', 400)
    guest.get(f'/api/runs/{run}', 404)
    guest.get(f'/api/runs/{run}/attempts', 404)
    guest.get(f'/api/runs/{run}/artifacts', 404)
    alpha, beta = poll(origin, data)['jobs']
    a, b = Driver(origin, data, alpha), Driver(origin, data, beta)
    a.event('progress', {'threadId': 'alpha-thread'})
    b.event('progress', {'threadId': 'beta-thread'})
    role = alpha['input']['roleId']
    action(guest, run, proof, 'message', 409, nodeId=node['id'], wave=1, text='No coordinator yet')
    action(guest, run, proof, 'message', 409, nodeId=node['id'], wave=1, targetRoleId='unknown', text='No fallback')
    key = uuid()
    params = {'nodeId': node['id'], 'wave': 1, 'targetRoleId': role, 'text': 'For Alpha only'}
    receipt = action(guest, run, proof, 'message', key=key, **params)
    assert action(guest, run, proof, 'message', key=key, **params)['receiptId'] == receipt['receiptId']
    assert not poll(origin, data, slots=0, active=active(beta))['inbox']
    item, = poll(origin, data, slots=0, active=active(alpha, beta))['inbox']
    assert item['sessionRef'] == 'alpha-thread' and item['text'] == 'For Alpha only'
    b.event('progress', {'deliveredInboxIds': [item['id']]}, 409)
    a.event('progress', {'deliveredInboxIds': [item['id']]})
    a.event('message', {'sessionRef': 'alpha-thread', 'text': 'Confirmed', 'inReplyToInboxId': item['id']})
    assert not poll(origin, data, slots=0, active=active(alpha, beta))['inbox']
    newest = chat(guest, run, proof, pageSize=1)
    assert newest['messages'][0]['inReplyToMessageId'] == item['chatMessageId']
    older = chat(guest, run, proof, cursor=newest['nextCursor'], pageSize=1)
    assert older['messages'][0]['deliveryState'] == 'delivered'

    a.event('question', {'sessionRef': 'alpha-thread', 'text': 'What should I do?'})
    question, = chat(guest, run, proof)['questions']
    assert question['state'] == 'waiting' and not question['canCancel']
    action(guest, run, proof, 'cancel-question', 403, targetId=question['id'])
    action(guest, run, proof, 'reply', targetId=question['id'], text='Use the approved design')
    action(guest, run, proof, 'reply', 409, targetId=question['id'], text='Double answer')
    resumed_poll = poll(origin, data, active=active(beta))
    resumed, = resumed_poll['jobs']
    answer, = resumed_poll['inbox']
    assert resumed['attemptId'] == alpha['attemptId'] and resumed['epoch'] > alpha['epoch']
    assert answer['sessionRef'] == 'alpha-thread' and answer['kind'] == 'answer'
    a.event('progress', {'threadId': 'alpha-thread'}, 409)
    Driver(origin, data, resumed).event('progress', {'deliveredInboxIds': [answer['id']]})
    assert chat(guest, run, proof)['questions'][0]['deliveryState'] == 'delivered'
    owner.post(f'/api/runs/{run}/chat/access', {'action': 'revoke', 'userId': guest.get('/api/me')['user']['id']})
    chat(guest, run, proof, 404)
    print('PASS authorized directional message, durable ordered history, exclusive question resolution and exact inbox fencing')

    b.event('question', {'sessionRef': 'beta-thread', 'text': 'May I continue?'})
    proof = lease(owner, run)
    question = next(item for item in chat(owner, run, proof)['questions'] if item['state'] == 'waiting')
    assert question['canCancel']
    with ThreadPoolExecutor(max_workers=2) as pool:
        outcomes = list(pool.map(lambda body: owner.call('POST', f'/api/runs/{run}/actions', expected=(200, 409),
            body={**proof, 'targetId': question['id'], **body}), [{'action': 'cancel-question'}, {'action': 'reply', 'text': 'Continue'}]))
    assert sorted(outcome[0] for outcome in outcomes) == [200, 409]
    with connect() as db:
        resolved = db.execute('SELECT action FROM agentship_design.question_resolution WHERE question_id=%s', (question['id'],)).fetchone()[0]
    resumed_poll = poll(origin, data, active=active(resumed))
    item, = resumed_poll['inbox']
    assert item['sessionRef'] == 'beta-thread'
    assert item['kind'] == ('continue_without_answer' if resolved == 'cancel' else 'answer')
    print('PASS concurrent reply/cancel changes one durable question once and routes only to the original session')


def failed_roles(owner, guest, connect, origin):
    node = work('Recover', 'Coordinator', children=['Success', 'Retry', 'Skip', 'RetryThenSkip'])
    flow, _ = create_flow(owner, [stage('Roles', node, end(node['id']))],
                          ['Coordinator', 'Success', 'Retry', 'Skip', 'RetryThenSkip'])
    data = fixture(owner, connect, origin, flow)
    run = data['run']
    proof = lease(owner, run)
    jobs = {job['input']['roleDisplayName']: job for job in poll(origin, data)['jobs']}
    complete(origin, data, jobs['Success'])
    failure = {'reasonCode': 'AGENT_EXECUTION_FAILED', 'message': 'Synthetic failure', 'retryable': True}
    Driver(origin, data, jobs['Retry']).event('failure', failure)
    Driver(origin, data, jobs['Skip']).event('failure', failure)
    Driver(origin, data, jobs['RetryThenSkip']).event('failure', failure)
    assert {role['roleDisplayName'] for role in chat(owner, run, proof)['failedRoles']} == {'Retry', 'Skip', 'RetryThenSkip'}
    action(owner, run, proof, 'retry', 409, targetId=jobs['Success']['taskId'])
    action(owner, run, proof, 'retry', 409, targetId=jobs['Retry']['taskId'], expectedAttemptNumber=2)
    key = uuid()
    replay = action(owner, run, proof, 'retry', key=key, targetId=jobs['Retry']['taskId'], expectedAttemptNumber=1)
    assert action(owner, run, proof, 'retry', key=key, targetId=jobs['Retry']['taskId'], expectedAttemptNumber=1)['receiptId'] == replay['receiptId']
    action(owner, run, proof, 'skip', targetId=jobs['Skip']['taskId'], expectedAttemptNumber=1)
    action(owner, run, proof, 'retry', targetId=jobs['RetryThenSkip']['taskId'], expectedAttemptNumber=1)
    retried_jobs = {job['input']['roleDisplayName']: job for job in poll(origin, data)['jobs']}
    retry = retried_jobs['Retry']
    assert retry['taskId'] == jobs['Retry']['taskId'] and retry['attemptId'] != jobs['Retry']['attemptId']
    complete(origin, data, retry)
    retry_then_skip = retried_jobs['RetryThenSkip']
    Driver(origin, data, retry_then_skip).event('failure', failure)
    action(owner, run, proof, 'skip', targetId=retry_then_skip['taskId'], expectedAttemptNumber=2)
    coordinator, = poll(origin, data)['jobs']
    assert coordinator['kind'] == 'coordinator'
    assert len(coordinator['input']['siblingArtifacts']) == 2
    Driver(origin, data, coordinator).event('failure', failure)
    assert chat(owner, run, proof)['failedRoles'][0]['actions'] == ['retry']
    action(owner, run, proof, 'skip', 409, targetId=coordinator['taskId'])
    action(owner, run, proof, 'retry', targetId=coordinator['taskId'])
    coordinator, = poll(origin, data)['jobs']
    c = Driver(origin, data, coordinator)
    c.event('progress', {'threadId': 'final-coordinator'})
    action(owner, run, proof, 'message', nodeId=node['id'], wave=1, text='Default destination')
    item, = poll(origin, data, slots=0, active=active(coordinator))['inbox']
    assert item['taskId'] == coordinator['taskId'] and item['sessionRef'] == 'final-coordinator'
    c.event('progress', {'unknownInboxIds': [item['id']]})
    assert chat(owner, run, proof)['messages'][0]['deliveryState'] == 'unknown'
    assert not poll(origin, data, slots=0, active=active(coordinator))['inbox']
    c.event('complete', {'artifacts': []}, 409)
    c.event('complete', {'artifacts': [report(coordinator)]})
    assert owner.get(f'/api/runs/{run}')['state'] == 'completed'
    attempts_path = f'/api/runs/{run}/attempts?taskId={jobs["Retry"]["taskId"]}&pageSize=1'
    first = owner.get(attempts_path)
    assert first['items'][0]['state'] == 'failed' and first['items'][0]['attemptNumber'] == 1
    cursor = urlencode({'cursor': first['nextCursor']})
    later = owner.get(attempts_path + '&' + cursor)
    assert later['items'][0]['state'] == 'succeeded' and later['items'][0]['attemptNumber'] == 2
    assert later['items'][0]['artifactIds'] and later['nextCursor'] is None
    assert not first['items'][0].get('operatorActions')
    display_name = owner.get('/api/me')['user']['displayName']
    retry_action, = later['items'][0]['operatorActions']
    assert retry_action['action'] == 'retry' and retry_action['operatorDisplayName'] == display_name and retry_action['operatedAt']
    both = owner.get(f'/api/runs/{run}/attempts?taskId={retry_then_skip["taskId"]}')['items'][1]['operatorActions']
    assert [entry['action'] for entry in both] == ['retry', 'skip']
    assert all(entry['operatorDisplayName'] == display_name and entry['operatedAt'] for entry in both)
    owner.get(f'/api/runs/{run}/attempts?' + cursor, 410)
    artifact_path = f'/api/runs/{run}/artifacts?pageSize=1'
    artifact_page = owner.get(artifact_path)
    artifact = artifact_page['items'][0]
    assert artifact['attemptId'] == jobs['Success']['attemptId']
    detail_path = f'/api/runs/{run}/artifacts/{artifact["id"]}'
    detail = owner.get(detail_path)
    assert detail == {'reference': artifact, 'title': artifact['title']}
    owner.get(f'/api/runs/{run}/artifacts/{uuid()}', 404)
    owner.post(f'/api/runs/{run}/chat/access', {'action': 'grant', 'username': 'chat_guest'})
    guest.get(detail_path, 404)
    another_run = fixture(owner, connect, origin, flow)['run']
    owner.get(f'/api/runs/{another_run}')
    owner.get(f'/api/runs/{another_run}/artifacts/{artifact["id"]}', 404)
    artifact_cursor = urlencode({'cursor': artifact_page['nextCursor']})
    assert owner.get(artifact_path + '&' + artifact_cursor)['items'][0]['attemptId'] == retry['attemptId']
    owner.get(f'/api/runs/{run}/attempts?' + artifact_cursor, 410)
    with connect() as db:
        attempts = db.execute('SELECT attempt_number,state,disposition FROM agentship_design.task_attempt WHERE task_id=%s',
                              (jobs['Skip']['taskId'],)).fetchall()
        assert attempts == [(1, 'failed', 'skipped')]
        assert db.execute('SELECT count(*) FROM agentship_design.task_attempt WHERE task_id=%s', (jobs['Success']['taskId'],)).fetchone()[0] == 1
    print('PASS retry only failed attempts, durable skip, default coordinator messaging, uncertain delivery and final artifact gate')


def requirement_change(owner, guest, connect, origin):
    draft = work('Draft', 'Coordinator')
    brd = work('Active BRD', 'Coordinator')
    brd['purpose'] = 'requirement'
    consumer = work('Consumer', 'Coordinator', dependencies=[draft['id'], brd['id']])
    flow, _ = create_flow(owner, [stage('Draft', draft), stage('BRD', brd), stage('Output', consumer, end(consumer['id']))], ['Coordinator'])
    data = fixture(owner, connect, origin, flow)
    run = data['run']
    before, = poll(origin, data)['jobs']
    complete(origin, data, before)
    brd_job, = poll(origin, data)['jobs']
    assert brd_job['nodeId'] == brd['id']
    owner.post(f'/api/runs/{run}/chat/access', {'action': 'grant', 'username': 'chat_guest'})
    guest_proof = lease(guest, run)
    target, = chat(guest, run, guest_proof)['requirements']
    scope = {'nodeId': target['nodeId'], 'wave': target['wave'], 'expectedRequirementRevision': target['revision'],
             'expectedSourceRequirementVersion': target['sourceVersion']}
    action(guest, run, guest_proof, 'propose-change', **scope, proposedRequirement={'title': 'Approved BRD', 'description': 'Updated description'})
    proposal, = chat(guest, run, guest_proof)['changes']
    assert proposal['state'] == 'pending' and not proposal['canConfirm']
    action(guest, run, guest_proof, 'confirm-change', 403, targetId=proposal['id'], **scope)
    guest.post(f'/api/runs/{run}/chat', {'action': 'release', **guest_proof})
    proof = lease(owner, run)
    assert chat(owner, run, proof)['changes'][0]['canConfirm']
    action(owner, run, proof, 'confirm-change', 409, targetId=proposal['id'], **{**scope, 'expectedSourceRequirementVersion': 2})
    action(owner, run, proof, 'confirm-change', targetId=proposal['id'], **scope)
    assert chat(owner, run, proof)['changes'][0]['effectiveRevision'] == 2
    with connect() as db:
        row = db.execute('SELECT q.name,q.description,c.version,r.current_revision FROM agentship_design.run r '
                         'JOIN agentship_design.requirement q ON q.id=r.requirement_id '
                         'JOIN agentship_design.configuration c ON c.id=q.id WHERE r.id=%s', (run,)).fetchone()
        assert row == ('Approved BRD', 'Updated description', 2, 2)
    current = owner.get(f'/api/runs/{run}')
    assert current['stages'][1]['nodes'][0]['basedOnOlderRequirementRevision']
    rerun, = chat(owner, run, proof)['rerunTargets']
    assert rerun['nodeId'] == draft['id']
    action(owner, run, proof, 'rerun', nodeId=draft['id'], wave=1)
    revised, = poll(origin, data, active=active(brd_job))['jobs']
    assert revised['nodeId'] == draft['id'] and revised['wave'] == 2 and revised['input']['requirementRevision'] == 2
    complete(origin, data, revised)
    complete(origin, data, brd_job)
    later, = poll(origin, data)['jobs']
    assert later['nodeId'] == consumer['id'] and later['input']['requirementRevision'] == 2
    assert {item['commit'] for item in later['input']['upstreamArtifacts']} == {report(revised)['commit'], report(brd_job)['commit']}
    with connect() as db:
        old, new = db.execute('SELECT wave,requirement_revision FROM agentship_design.node_execution WHERE run_id=%s AND node_id=%s ORDER BY wave',
                              (run, draft['id'])).fetchall()
        assert old == (1, 1) and new == (2, 2)
    print('PASS active BRD proposal, initiator-only confirmation, version fence, frozen in-flight revision and explicit non-destructive rerun')


def deferred_description(owner, connect, origin):
    brd = work('Fill requirement', 'Coordinator')
    brd['purpose'] = 'requirement'
    downstream = work('Next work', 'Coordinator', dependencies=[brd['id']])
    flow, _ = create_flow(owner, [stage('Description', brd), stage('Next', downstream, end(downstream['id']))], ['Coordinator'])
    data = fixture(owner, connect, origin, flow, description=None)
    run = data['run']
    proof = lease(owner, run)
    job, = poll(origin, data)['jobs']
    complete(origin, data, job)
    assert not poll(origin, data)['jobs']
    blocked = owner.get(f'/api/runs/{run}')
    assert blocked['blockerCode'] == 'AGENT_REQUIREMENT_REQUIRED'
    brd_view, = chat(owner, run, proof)['requirements']
    assert brd_view['description'] is None and brd_view['canConfirm']
    action(owner, run, proof, 'describe', nodeId=brd['id'], wave=1, text='Confirmed scope',
           expectedRequirementRevision=brd_view['revision'], expectedSourceRequirementVersion=brd_view['sourceVersion'])
    new, = poll(origin, data)['jobs']
    assert new['nodeId'] == downstream['id'] and new['input']['requirementRevision'] == 2
    assert new['input']['requirementDescription'] == 'Confirmed scope'
    assert new['input']['upstreamArtifacts'][0]['requirementRevision'] == 1
    print('PASS missing BRD description is completed in the active node and unblocks the already-produced artifact')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--java', type=Path, required=True)
    parser.add_argument('--jar', type=Path, default=JAR)
    args = parser.parse_args()
    sys.path.insert(0, str(WORKSPACE / 'pg-python'))
    import psycopg
    with tempfile.TemporaryDirectory(prefix='chat-jobs-', dir=WORKSPACE) as folder:
        scratch = Path(folder)
        with postgres(WORKSPACE / 'tools' / 'pg17' / 'bin', scratch) as dbport:
            def connect(): return psycopg.connect(host='127.0.0.1', port=dbport, user='design_check', dbname='postgres')
            with platform(args.java, args.jar, scratch, dbport, free_port(), secrets.token_urlsafe(40), 'initial') as origin:
                owner, guest = Browser(origin), Browser(origin)
                create_account(owner, account('chat_owner', 991))
                create_account(guest, account('chat_guest', 992))
                chat_delivery(owner, guest, connect, origin)
                failed_roles(owner, guest, connect, origin)
                requirement_change(owner, guest, connect, origin)
                deferred_description(owner, connect, origin)


if __name__ == '__main__':
    main()
