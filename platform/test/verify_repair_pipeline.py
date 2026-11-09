"""Run automatic repair to its cap, add a manual round in Chrome, and reach the original check's pass route."""

import argparse
from pathlib import Path
import secrets
import shutil
import tempfile
import time
from uuid import uuid4

from verify_device import bridge
from verify_first_batch import Browser, JAR, WORKSPACE, account, create_account, free_port, platform, postgres, test_chrome
from verify_git_pipeline import executor


def create_flow(owner):
    def role(name, key, description):
        return owner.post('/api/objects/agents', {'name': name, 'data': {
            'roleKey': key, 'description': description}}, 201)['id']

    checker = role('检查协调 Agent', 'repair.check', '[demo:repair-until=3]')
    maker = role('修复协调 Agent', 'repair.make', 'Synthetic repair output')
    def node(name, kind='work', purpose='backend'):
        return {'id': str(uuid4()), 'name': name, 'type': kind, 'purpose': purpose, 'dependencies': [],
                'coordinatorId': checker if kind == 'check' else maker, 'agentIds': [], 'agentOrder': 'parallel'}

    check = node('原检查', 'check', 'test')
    passed, repair = node('通过路线'), node('跨阶段修复', purpose='repair')
    check['checkRoutes'] = {'passNodeId': passed['id'], 'repairNodeId': repair['id'], 'automaticRepairLimit': 2}
    passed['route'] = {'checkNodeId': check['id'], 'outcome': 'pass'}
    repair['route'] = {'checkNodeId': check['id'], 'outcome': 'repair'}
    end = {'id': str(uuid4()), 'name': '结束', 'type': 'end', 'dependencies': [passed['id']]}
    stages = [{'id': str(uuid4()), 'name': label, 'nodes': [item]} for label, item in [
        ('检查', check), ('通过', passed), ('修复', repair), ('汇合', end),
    ]]
    return owner.post('/api/objects/flows', {'name': 'Repair demo flow', 'data': {'stages': stages}}, 201), check['id']


def wait_for(owner, path, predicate, timeout):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        detail = owner.get(path)
        if predicate(detail): return detail
        time.sleep(.4)
    raise AssertionError('Expected repair state was not reached: ' + str((detail['state'], detail.get('blockerCode'), [
        (node['name'], node['state'], node.get('check', {}).get('status'))
        for stage in detail['stages'] for node in stage['nodes']
    ])))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--java', type=Path, required=True)
    parser.add_argument('--jar', type=Path, default=JAR)
    parser.add_argument('--browser', action='store_true')
    args = parser.parse_args()
    cli = shutil.which('playwright-cli')
    if args.browser and not cli: parser.error('playwright-cli is required for Chrome verification')
    with tempfile.TemporaryDirectory(prefix='repair-pipeline-', dir=WORKSPACE) as folder:
        scratch = Path(folder)
        with postgres(WORKSPACE / 'tools' / 'pg17' / 'bin', scratch) as dbport:
            port, bridge_port, key = free_port(), free_port(), secrets.token_urlsafe(40)
            with platform(args.java, args.jar, scratch, dbport, port, key, 'initial') as origin:
                owner = Browser(origin)
                create_account(owner, account('repair_pipeline', 988))
                project = owner.get('/api/projects')['items'][0]['id']
                requirement = owner.post('/api/objects/requirements', {'name': 'Repair pipeline fixture',
                    'data': {'projectId': project, 'description': 'Synthetic repair loop'}}, 201)
                flow, check_id = create_flow(owner)
                code = owner.post('/api/devices/pair', expected=201)['code']
                with executor(args.java, args.jar, scratch, origin, bridge_port, code, execute_agents=True):
                    proof = bridge(origin, bridge_port, '/proof', owner.post('/api/devices/challenge', expected=201))
                    receipt = owner.post('/api/runs', {'requirementId': requirement['id'], 'requirementVersion': requirement['version'],
                        'workflowId': flow['id'], 'workflowVersion': flow['workflowVersion'], 'workType': 'feature',
                        'githubNamespace': 'fixture', 'deviceProof': proof}, 201)
                    path = '/api/runs/' + receipt['runId']
                    check = lambda value: value['stages'][0]['nodes'][0].get('check', {})
                    paused = wait_for(owner, path, lambda value: check(value).get('status') == 'limit_reached', 110)
                    status = check(paused)
                    assert status['checkWave'] == 3 and status['automaticRepairCount'] == 2 and status['manualRepairCount'] == 0
                    assert [wave['outcome'] for wave in status['history']] == ['repair'] * 3
                    assert [wave.get('repairRound', {}).get('number') for wave in status['history']] == [1, 2, None]
                    assert len({wave['testedCommit'] for wave in status['history']}) == 3
                    assert not paused['stages'][1]['nodes'][0]['tasks'] and paused['stages'][-1]['nodes'][0]['state'] == 'blocked'
                    print('PASS real Java worker runs two cross-stage repairs with different candidates and pauses only at limit')
                    if args.browser:
                        test_chrome(cli, origin, scratch, [('repair_pipeline.browser.js', 'agentShip-repair-pipeline-ok',
                            'real repair history, mobile view, tab competition, release and one manual round')])
                    else:
                        tab = str(uuid4())
                        lease = owner.post(path + '/chat', {'action': 'acquire', 'tabId': tab})
                        owner.post(path + '/actions', {'action': 'repair', 'targetId': check_id, 'wave': 3,
                            'tabId': tab, 'epoch': lease['epoch'], 'leaseCredential': lease['credential']})
                    done = wait_for(owner, path, lambda value: value['state'] == 'completed', 65)
                    status = check(done)
                    assert status['status'] == 'pass' and status['checkWave'] == 4
                    assert status['automaticRepairCount'] == 2 and status['manualRepairCount'] == 1
                    assert status['history'][2]['repairRound']['kind'] == 'manual'
                    assert done['stages'][1]['nodes'][0]['state'] == 'complete' and done['stages'][-1]['nodes'][0]['state'] == 'complete'
                    print('PASS one manual round rechecks the repaired candidate and releases the pass route to end')
            with platform(args.java, args.jar, scratch, dbport, port, key, 'restart') as origin:
                restored = Browser(origin, owner.cookies).get(path)
                assert check(restored) == check(done)
                print('PASS check and repair history survives platform restart')


if __name__ == '__main__':
    main()
