"""Run a signed workflow through Java, PostgreSQL, local Git and the Agent demo executor."""

import argparse
import hashlib
from pathlib import Path
import secrets
import shutil
import subprocess
import tempfile
import time
from uuid import uuid4

from verify_device import bridge
from verify_first_batch import Browser, JAR, WORKSPACE, account, create_account, free_port, platform, postgres, test_chrome
from verify_git_pipeline import executor


def create_flow(owner):
    def role(key, name):
        return owner.post('/api/objects/agents', {'name': name, 'data': {
            'roleKey': key, 'description': 'Synthetic workflow Agent'}}, 201)['id']

    coordinator = role('pipeline.lead', '交付协调 Agent')
    selected = [role('pipeline.agent' + str(i), '交付子 Agent ' + str(i)) for i in range(1, 4)]
    role('pipeline.unselected', '未选择角色')

    def work(name, dependencies, agents):
        return {'id': str(uuid4()), 'name': name, 'type': 'work', 'purpose': 'product',
                'dependencies': dependencies, 'coordinatorId': coordinator, 'agentIds': agents, 'agentOrder': 'parallel'}

    start = work('需求产物', [], [])
    left = work('实现方案', [start['id']], selected)
    right = work('交付说明', [start['id']], [])
    end = {'id': str(uuid4()), 'name': '交付结束', 'type': 'end', 'dependencies': [left['id'], right['id']]}
    return owner.post('/api/objects/flows', {'name': 'Agent pipeline flow', 'data': {'stages': [
        {'id': str(uuid4()), 'name': '准备', 'nodes': [start]},
        {'id': str(uuid4()), 'name': '交付', 'nodes': [left, right, end]},
    ]}}, 201)


def wait_for_completion(owner, run_id):
    until = time.monotonic() + 125
    while time.monotonic() < until:
        result = owner.get('/api/runs/' + run_id)
        if result['state'] == 'completed':
            return result
        if result['state'] in ('needs_attention', 'failed', 'stopped'):
            raise AssertionError('Workflow failed: ' + str(result.get('blockerCode')))
        time.sleep(.4)
    states = [(node['name'], node['state'], [task['state'] for task in node['tasks']])
              for stage in result['stages'] for node in stage['nodes']]
    raise AssertionError('Workflow timed out: ' + str(states))


def verify_artifact(scratch, artifact):
    ref = artifact['sourceRef']
    assert ref.startswith('local-git:')
    scoped, git_ref = ref.removeprefix('local-git:').split('@', 1)
    commit, file = git_ref.split(':', 1)
    assert commit == artifact['commit']
    workspace = scratch / 'worker' / 'agent-jobs' / scoped / 'workspace'
    data = subprocess.check_output(['git', '-C', str(workspace), 'show', commit + ':' + file])
    assert data.strip() and 'sha256:' + hashlib.sha256(data).hexdigest() == artifact['contentDigest']
    return workspace, file


def verify_archive(owner, path, detail, scratch):
    artifacts = [artifact for stage in detail['stages'] for node in stage['nodes'] for artifact in node['artifacts']]
    first, second = artifacts[:2]
    workspace, report = verify_artifact(scratch, first)
    repository, = (scratch / 'worker' / 'repositories').iterdir()
    remote = lambda *args: subprocess.check_output(['git', '--git-dir', str(repository), *args], text=True).strip()
    assert not remote('tag', '--list', 'agentship/*')
    payload = {'artifactId': first['id'], 'expectedCommit': first['commit'], 'publicApproved': True}
    owner.post(path + '/archives', {**payload, 'publicApproved': False}, 400)
    owner.post(path + '/archives', {**payload, 'expectedCommit': '0' * 40}, 409)
    queued = owner.post(path + '/archives', payload)
    assert queued['ref'] == 'refs/tags/agentship/' + detail['id'] + '/' + first['id']
    assert owner.post(path + '/archives', payload)['ref'] == queued['ref']

    def wait_archive(artifact, expected):
        until = time.monotonic() + 45
        while time.monotonic() < until:
            value = owner.get(path)
            candidate = next(a for s in value['stages'] for n in s['nodes'] for a in n['artifacts'] if a['id'] == artifact['id'])
            if candidate.get('archive', {}).get('state') == expected:
                return candidate['archive']
            time.sleep(.3)
        raise AssertionError('Archive did not reach ' + expected + ': ' + str(candidate.get('archive')))

    archived = wait_archive(first, 'succeeded')
    commit = archived['commit']
    assert remote('rev-parse', archived['ref']) == commit
    assert remote('rev-list', '--parents', '-n', '1', commit).split() == [commit, detail['git']['baseCommit']]
    original_tree = subprocess.check_output(['git', '-C', str(workspace), 'rev-parse', first['commit'] + '^{tree}'], text=True).strip()
    assert remote('rev-parse', commit + '^{tree}') == original_tree
    assert remote('show', commit + ':' + report)
    print('PASS reviewed final artifact exports its exact Git tree and report to an immutable repository tag')

    conflict_ref = 'refs/tags/agentship/' + detail['id'] + '/' + second['id']
    remote('update-ref', conflict_ref, detail['git']['baseCommit'])
    owner.post(path + '/archives', {'artifactId': second['id'], 'expectedCommit': second['commit'], 'publicApproved': True})
    failed = wait_archive(second, 'failed')
    assert failed['reasonCode'] == 'ARCHIVE_TAG_CONFLICT' and remote('rev-parse', conflict_ref) == detail['git']['baseCommit']
    print('PASS existing conflicting tag stays intact and archive failure is visible')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--java', type=Path, required=True)
    parser.add_argument('--jar', type=Path, default=JAR)
    parser.add_argument('--browser', action='store_true')
    parser.add_argument('--archive', action='store_true')
    args = parser.parse_args()
    cli = shutil.which('playwright-cli')
    if args.browser and not cli:
        parser.error('playwright-cli is required for Chrome verification')
    with tempfile.TemporaryDirectory(prefix='agent-pipeline-', dir=WORKSPACE) as folder:
        scratch = Path(folder)
        with postgres(WORKSPACE / 'tools' / 'pg17' / 'bin', scratch) as dbport:
            port, bridge_port, key = free_port(), free_port(), secrets.token_urlsafe(40)
            with platform(args.java, args.jar, scratch, dbport, port, key, 'initial') as origin:
                owner = Browser(origin)
                create_account(owner, account('agent_pipeline', 970))
                project = owner.get('/api/projects')['items'][0]['id']
                requirement = owner.post('/api/objects/requirements', {
                    'name': 'Agent pipeline fixture', 'data': {'projectId': project, 'description': 'Synthetic multi-Agent delivery'}}, 201)
                flow = create_flow(owner)
                code = owner.post('/api/devices/pair', expected=201)['code']
                with executor(args.java, args.jar, scratch, origin, bridge_port, code, execute_agents=True):
                    proof = bridge(origin, bridge_port, '/proof', owner.post('/api/devices/challenge', expected=201))
                    receipt = owner.post('/api/runs', {'requirementId': requirement['id'], 'requirementVersion': requirement['version'],
                        'workflowId': flow['id'], 'workflowVersion': flow['workflowVersion'], 'workType': 'feature',
                        'githubNamespace': 'fixture', 'deviceProof': proof}, 201)
                    detail = wait_for_completion(owner, receipt['runId'])
                    nodes = [node for stage in detail['stages'] for node in stage['nodes']]
                    assert len(nodes) == 4 and all(node['state'] == 'complete' for node in nodes)
                    assert nodes[-1]['type'] == 'end' and not nodes[-1]['tasks']
                    assert [len(node['tasks']) for node in nodes] == [1, 4, 1, 0]
                    assert {task['roleId'] for task in nodes[1]['tasks']} == {'pipeline.lead', 'pipeline.agent1', 'pipeline.agent2', 'pipeline.agent3'}
                    assert all(task['state'] == 'succeeded' for node in nodes for task in node['tasks'])
                    for node in nodes[:-1]:
                        assert len(node['artifacts']) == 1
                        verify_artifact(scratch, node['artifacts'][0])
                    print('PASS real Java pipeline joins both routes, dispatches selected roles only and verifies local artifact commits')
                    if args.archive:
                        path = '/api/runs/' + receipt['runId']
                        verify_archive(owner, path, detail, scratch)
                        detail = owner.get(path)
                    if args.browser:
                        journeys = [('agent_pipeline.browser.js', 'agentShip-agent-pipeline-ok',
                            'completed node execution, selected Agent roles, artifact evidence and mobile layout')]
                        if args.archive:
                            journeys.append(('archive_pipeline.browser.js', 'agentShip-archive-pipeline-ok',
                                'archive result, immutable tag and safe conflict explanation'))
                        test_chrome(cli, origin, scratch, journeys)
            with platform(args.java, args.jar, scratch, dbport, port, key, 'restart') as origin:
                restored = Browser(origin, owner.cookies).get('/api/runs/' + receipt['runId'])
                assert restored['state'] == 'completed' and restored['stages'] == detail['stages']
                print('PASS completed run, role and artifact projections persist across platform restart')


if __name__ == '__main__':
    main()
