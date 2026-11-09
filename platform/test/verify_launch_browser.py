"""Verify startup in Chrome against the packaged platform, Java companion and isolated PostgreSQL."""

import argparse
from pathlib import Path
import secrets
import shutil
import sys
import tempfile
from uuid import uuid4

from verify_first_batch import Browser, JAR, WORKSPACE, account, create_account, free_port, platform, postgres, test_chrome
from verify_device import worker


def fixtures(owner, connect):
    project = owner.get('/api/projects')['items'][0]['id']
    agent = owner.post('/api/objects/agents', {
        'name': '启动协调 Agent', 'data': {'roleKey': 'launch.coordinator', 'description': 'Synthetic startup role'},
    }, 201)
    for name, purpose in [('启动含需求流程', 'requirement'), ('启动前补齐说明流程', 'backend')]:
        node = {'id': str(uuid4()), 'name': '需求梳理' if purpose == 'requirement' else '后端实现',
                'type': 'work', 'purpose': purpose, 'dependencies': [], 'coordinatorId': agent['id'],
                'agentIds': [], 'agentOrder': 'parallel'}
        end = {'id': str(uuid4()), 'name': '交付结束', 'type': 'end', 'dependencies': [node['id']]}
        owner.post('/api/objects/flows', {'name': name, 'data': {'stages': [
            {'id': str(uuid4()), 'name': '准备交付', 'nodes': [node, end]},
        ]}}, 201)
    linked = owner.post('/api/objects/requirements', {
        'name': '已关联仓库需求', 'data': {'projectId': project, 'description': 'Synthetic existing repository requirement'},
    }, 201)
    with connect() as connection:
        repository = str(uuid4())
        connection.execute("INSERT INTO agentship_design.repository(id,provider,provider_repository_id,display_name) VALUES(%s,'github','fixture-repository','fixture-team/existing')", (repository,))
        connection.execute('UPDATE agentship_design.requirement SET repository_id=%s WHERE id=%s', (repository, linked['id']))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--java', type=Path, required=True)
    parser.add_argument('--jar', type=Path, default=JAR)
    args = parser.parse_args()
    cli = shutil.which('playwright-cli')
    if not cli:
        parser.error('playwright-cli and Chrome are required')
    sys.path.insert(0, str(WORKSPACE / 'pg-python'))
    import psycopg

    with tempfile.TemporaryDirectory(prefix='launch-browser-', dir=WORKSPACE) as folder:
        scratch = Path(folder)
        with postgres(WORKSPACE / 'tools' / 'pg17' / 'bin', scratch) as database_port:
            def connect():
                return psycopg.connect(host='127.0.0.1', port=database_port, user='design_check', dbname='postgres')
            app_port, key = free_port(), secrets.token_urlsafe(40)
            with platform(args.java, args.jar, scratch, database_port, app_port, key, 'initial') as origin:
                owner = Browser(origin)
                create_account(owner, account('launch_owner', 919))
                fixtures(owner, connect)
                code = owner.post('/api/devices/pair', expected=201)['code']
                with worker(args.java, args.jar, scratch, origin, 4781, code):
                    test_chrome(cli, origin, scratch, [('launch_browser.js', 'agentShip-launch-ok',
                        'real Java companion proof, requirement selection, four work types, launch, frozen roles and responsive board')])
                runs = owner.get('/api/runs')['items']
                assert len(runs) == 2, 'Browser must create exactly two runs'
                run_ids = {run['id'] for run in runs}
                assert {run['workType'] for run in runs} == {'feature', 'hotfix'}
                for run in runs:
                    detail = owner.get('/api/runs/' + run['id'])
                    assert detail['state'] == 'queued' and 'git' not in detail
                    assert detail['stages'][0]['nodes'][0]['selectedRoles'][0]['displayName'] == '启动协调 Agent'
                print('PASS two actual browser starts persist without fake Git or Agent completion')
            with platform(args.java, args.jar, scratch, database_port, app_port, key, 'restart') as origin:
                restored = Browser(origin, owner.cookies)
                assert {run['id'] for run in restored.get('/api/runs')['items']} == run_ids
                for run_id in run_ids:
                    assert restored.get('/api/runs/' + run_id)['workflowVersion'] == 1
                print('PASS browser-created runs and pinned workflow survive platform restart')


if __name__ == '__main__':
    main()
