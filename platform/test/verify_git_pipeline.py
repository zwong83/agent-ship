"""Real Java platform + companion + local Git + PostgreSQL + optional Chrome."""
import argparse
from contextlib import contextmanager
from pathlib import Path
import secrets
import shutil
import subprocess
import sys
import tempfile
import time
from uuid import uuid4

from verify_device import bridge
from verify_first_batch import Browser, JAR, WORKSPACE, account, create_account, free_port, platform, postgres, test_chrome


@contextmanager
def executor(java, jar, scratch, origin, port, code=None, execute_agents=False):
    command = [str(java), '-jar', str(jar), '--worker', '--platform', origin,
               '--state-dir', str(scratch / 'worker'), '--port', str(port), '--execute-git']
    if code:
        command += ['--pair-code', code]
    if execute_agents:
        command += ['--execute-agents']
    with (scratch / 'worker-output.log').open('wb') as output:
        process = subprocess.Popen(command, stdout=output, stderr=subprocess.STDOUT)
        try:
            until = time.monotonic() + 20
            while time.monotonic() < until and process.poll() is None:
                try:
                    if bridge(origin, port, '/status').get('connectivity') == 'online':
                        break
                except (OSError, AssertionError):
                    pass
                time.sleep(.15)
            else:
                raise AssertionError('Git companion did not become ready')
            yield process
        finally:
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=5)


def ready(owner, run_id):
    until = time.monotonic() + 45
    while time.monotonic() < until:
        result = owner.get('/api/runs/' + run_id)
        if result.get('gitPreparation', {}).get('state') == 'ready':
            return result
        if result.get('gitPreparation', {}).get('state') == 'needs_attention':
            raise AssertionError('Git integration failed: ' + str(result['gitPreparation']))
        time.sleep(.25)
    raise AssertionError('Git integration timed out: ' + str(result.get('gitPreparation')))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--java', type=Path, required=True)
    parser.add_argument('--jar', type=Path, default=JAR)
    parser.add_argument('--browser', action='store_true')
    args = parser.parse_args()
    sys.path.insert(0, str(WORKSPACE / 'pg-python'))
    import psycopg
    cli = shutil.which('playwright-cli')
    if args.browser and not cli:
        parser.error('playwright-cli is required for Chrome verification')
    with tempfile.TemporaryDirectory(prefix='git-pipeline-', dir=WORKSPACE) as folder:
        scratch = Path(folder)
        with postgres(WORKSPACE / 'tools' / 'pg17' / 'bin', scratch) as dbport:
            def connect():
                return psycopg.connect(host='127.0.0.1', port=dbport, user='design_check', dbname='postgres')
            port, bridge_port, key = free_port(), free_port(), secrets.token_urlsafe(40)
            with platform(args.java, args.jar, scratch, dbport, port, key, 'initial') as origin:
                owner = Browser(origin)
                create_account(owner, account('git_pipeline', 969))
                project = owner.get('/api/projects')['items'][0]['id']
                requirement = owner.post('/api/objects/requirements', {
                    'name': 'Git pipeline fixture', 'data': {'projectId': project, 'description': 'Synthetic Git delivery'}}, 201)
                role = owner.post('/api/objects/agents', {'name': 'Pipeline coordinator',
                    'data': {'roleKey': 'pipeline.coordinator', 'description': 'Synthetic role'}}, 201)
                node = {'id': str(uuid4()), 'name': 'Implementation', 'type': 'work', 'purpose': 'backend',
                        'dependencies': [], 'coordinatorId': role['id'], 'agentIds': [], 'agentOrder': 'parallel'}
                flow = owner.post('/api/objects/flows', {'name': 'Git pipeline flow', 'data': {'stages': [
                    {'id': str(uuid4()), 'name': 'Delivery', 'nodes': [node,
                     {'id': str(uuid4()), 'name': 'End', 'type': 'end', 'dependencies': [node['id']]}]}]}}, 201)
                code = owner.post('/api/devices/pair', expected=201)['code']
                def start():
                    proof = bridge(origin, bridge_port, '/proof', owner.post('/api/devices/challenge', expected=201))
                    return owner.post('/api/runs', {'requirementId': requirement['id'], 'requirementVersion': requirement['version'],
                        'workflowId': flow['id'], 'workflowVersion': flow['workflowVersion'], 'workType': 'feature',
                        'githubNamespace': 'fixture', 'deviceProof': proof}, 201)['runId']
                with executor(args.java, args.jar, scratch, origin, bridge_port, code):
                    first = start()
                    detail = ready(owner, first)
                    assert detail['state'] == 'waiting' and detail['blockerCode'] == 'AGENT_EXECUTION_PENDING'
                    git = detail['git']
                    assert git['repository']['provider'] == 'demo' and git['repository']['defaultBranch'] == 'main'
                    assert git['baseBranch'] == 'dev' and git['workBranch'] == 'feature/' + first
                    assert len(git['baseCommit']) == 40 and git['headCommit'] == git['baseCommit']
                    assert len(detail['gitPreparation']['steps']) == 3
                    assert all(step['state'] == 'succeeded' for step in detail['gitPreparation']['steps'])
                    assert all(not n['tasks'] and n['state'] == 'blocked' for s in detail['stages'] for n in s['nodes'])
                    with connect() as db:
                        assert db.execute('SELECT repository_id FROM agentship_design.requirement WHERE id=%s', (requirement['id'],)).fetchone()[0] is None
                        assert db.execute('SELECT count(*) FROM agentship_design.operation_evidence').fetchone()[0] >= 3
                    print('PASS actual Java companion prepares local Git; platform persists confirmed evidence without completing Agent nodes or linking demo requirement')
                    if args.browser:
                        test_chrome(cli, origin, scratch, [('git_pipeline.browser.js', 'agentShip-git-pipeline-ok',
                            'real platform Git evidence and responsive Chrome view')])
                # Same worker state, same requirement and a new run: shared repository reused,
                # distinct work branch, no duplicate repository or new remote association.
                with executor(args.java, args.jar, scratch, origin, bridge_port):
                    second = start()
                    detail2 = ready(owner, second)
                    assert detail2['git']['repository']['repositoryId'] == git['repository']['repositoryId']
                    assert detail2['git']['workBranch'] != git['workBranch']
                    repos = list((scratch / 'worker' / 'repositories').iterdir())
                    assert len(repos) == 1
                    refs = subprocess.check_output(['git', '--git-dir', str(repos[0]), 'for-each-ref', '--format=%(refname)'], text=True)
                    assert 'refs/heads/feature/' + first in refs and 'refs/heads/feature/' + second in refs
                    print('PASS worker restart reuses confirmed demo repository and creates only the new run branch')
            with platform(args.java, args.jar, scratch, dbport, port, key, 'restart') as origin:
                owner = Browser(origin, owner.cookies)
                for run_id in [first, second]:
                    restored = owner.get('/api/runs/' + run_id)
                    assert restored['gitPreparation']['state'] == 'ready' and restored['state'] == 'waiting'
                    assert restored['git']['headCommit'] == git['headCommit']
                print('PASS confirmed Git evidence and waiting Agent state survive platform restart')


if __name__ == '__main__':
    main()
