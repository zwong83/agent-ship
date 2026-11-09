"""Check offline browser reply and same-device/attempt continuation against the real Java stack."""

import argparse
from pathlib import Path
import secrets
import shutil
import subprocess
import sys
import tempfile
import time
from uuid import uuid4

from verify_agent_pipeline import verify_artifact, wait_for_completion
from verify_device import bridge
from verify_first_batch import Browser, JAR, WORKSPACE, account, create_account, free_port, platform, postgres, test_chrome
from verify_git_pipeline import executor

ANSWER = 'Synthetic private acceptance answer for original role'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--java', type=Path, required=True)
    parser.add_argument('--jar', type=Path, default=JAR)
    args = parser.parse_args()
    cli = shutil.which('playwright-cli')
    if not cli: parser.error('playwright-cli is required for Chrome verification')
    sys.path.insert(0, str(WORKSPACE / 'pg-python'))
    import psycopg
    with tempfile.TemporaryDirectory(prefix='chat-pipeline-', dir=WORKSPACE) as folder:
        scratch = Path(folder)
        with postgres(WORKSPACE / 'tools' / 'pg17' / 'bin', scratch) as dbport:
            def connect():
                return psycopg.connect(host='127.0.0.1', port=dbport, user='design_check', dbname='postgres')
            port, bridge_port, key = free_port(), free_port(), secrets.token_urlsafe(40)
            with platform(args.java, args.jar, scratch, dbport, port, key, 'initial') as origin:
                owner = Browser(origin)
                create_account(owner, account('chat_pipeline', 993))
                project = owner.get('/api/projects')['items'][0]['id']
                requirement = owner.post('/api/objects/requirements', {'name': 'Chat pipeline fixture',
                    'data': {'projectId': project, 'description': 'Synthetic workflow input'}}, 201)
                agent = owner.post('/api/objects/agents', {'name': '问答协调 Agent', 'data': {
                    'roleKey': 'chat.pipeline', 'description': '[demo:question]'}}, 201)
                work, end = str(uuid4()), str(uuid4())
                flow = owner.post('/api/objects/flows', {'name': 'Chat pipeline flow', 'data': {'stages': [{
                    'id': str(uuid4()), 'name': '交付', 'nodes': [
                        {'id': work, 'name': '需求确认', 'type': 'work', 'purpose': 'requirement', 'dependencies': [],
                         'coordinatorId': agent['id'], 'agentIds': [], 'agentOrder': 'parallel'},
                        {'id': end, 'name': '结束', 'type': 'end', 'dependencies': [work]},
                    ]}]}}, 201)
                code = owner.post('/api/devices/pair', expected=201)['code']
                with executor(args.java, args.jar, scratch, origin, bridge_port, code, execute_agents=True):
                    proof = bridge(origin, bridge_port, '/proof', owner.post('/api/devices/challenge', expected=201))
                    receipt = owner.post('/api/runs', {'requirementId': requirement['id'], 'requirementVersion': requirement['version'],
                        'workflowId': flow['id'], 'workflowVersion': flow['workflowVersion'], 'workType': 'feature',
                        'githubNamespace': 'fixture', 'deviceProof': proof}, 201)
                    path = '/api/runs/' + receipt['runId']
                    until = time.monotonic() + 70
                    while time.monotonic() < until:
                        detail = owner.get(path)
                        if detail.get('blockerCode') == 'AGENT_QUESTION_PENDING': break
                        time.sleep(.4)
                    else: raise AssertionError('Worker did not persist its question: ' + str(detail.get('blockerCode')))
                with connect() as db:
                    db.execute("""UPDATE agentship_design.device SET last_seen_at=statement_timestamp()-interval '32 seconds'
                        WHERE id=(SELECT device_id FROM agentship_design.run WHERE id=%s)""", (receipt['runId'],))
                    first = db.execute("""SELECT a.task_id,a.attempt_id,a.session_ref,a.lease_epoch FROM agentship_design.task_attempt a
                        JOIN agentship_design.role_task t ON t.id=a.task_id WHERE t.run_id=%s AND t.kind='coordinator'""", (receipt['runId'],)).fetchone()
                test_chrome(cli, origin, scratch, [('chat_pipeline.browser.js', 'agentShip-chat-pipeline-ok',
                    'real offline question, authorized browser reply and pending delivery')])
                with connect() as db:
                    pending = db.execute("""SELECT i.session_ref,i.delivery_state,r.answer FROM agentship_design.agent_inbox i
                        JOIN agentship_design.question_resolution r ON r.question_id=i.question_id WHERE i.run_id=%s""", (receipt['runId'],)).fetchall()
                    assert pending == [(first[2], 'pending', ANSWER)]
                with executor(args.java, args.jar, scratch, origin, bridge_port, execute_agents=True):
                    done = wait_for_completion(owner, receipt['runId'])
                    item = done['stages'][0]['nodes'][0]['artifacts'][0]
                    workspace, report = verify_artifact(scratch, item)
                    text = subprocess.check_output(['git', '-C', str(workspace), 'show', item['commit'] + ':' + report], text=True)
                    assert ANSWER not in text
                with connect() as db:
                    attempts = db.execute("""SELECT task_id,attempt_id,session_ref,lease_epoch,state FROM agentship_design.task_attempt WHERE task_id=%s""", (first[0],)).fetchall()
                    assert len(attempts) == 1 and attempts[0][:3] == first[:3] and attempts[0][3] > first[3] and attempts[0][4] == 'succeeded'
                    deliveries = db.execute("SELECT delivery_state FROM agentship_design.agent_inbox WHERE run_id=%s", (receipt['runId'],)).fetchall()
                    assert deliveries == [('delivered',)]
                    assert db.execute("SELECT count(*) FROM agentship_design.agent_question WHERE run_id=%s", (receipt['runId'],)).fetchone() == (1,)
                print('PASS original worker resumes same attempt and session after offline browser reply, with private answer excluded from artifact')
            with platform(args.java, args.jar, scratch, dbport, port, key, 'restart') as origin:
                assert Browser(origin, owner.cookies).get(path)['state'] == 'completed'
                with connect() as db:
                    assert db.execute("SELECT answer FROM agentship_design.question_resolution").fetchone() == (ANSWER,)
                print('PASS question resolution and completed run persist after platform restart')


if __name__ == '__main__':
    main()
