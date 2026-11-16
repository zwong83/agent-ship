"""Verify explicit permissions, workflow behavior, and upgrades from a pre-V8 jar."""
import argparse
from copy import deepcopy
from pathlib import Path
from contextlib import contextmanager
import subprocess
import os
import zipfile
import secrets
import tempfile
from uuid import uuid4

import psycopg
from verify_first_batch import Browser, JAR, account, create_account, free_port, platform
from verify_flow_config import nested_routes
from verify_node_jobs import fixture, poll, complete, run_state, serial, parallel, checks


@contextmanager
def postgres(tools, scratch):
    port, data = free_port(), scratch / 'db'
    with (scratch / 'postgres-control.log').open('wb') as log:
        subprocess.run([tools / 'initdb', '-D', data, '-A', 'trust', '--no-locale', '--encoding=UTF8',
                        '-U', 'design_check'], check=True, stdout=log, stderr=log, stdin=subprocess.DEVNULL)
        subprocess.run([tools / 'pg_ctl', '-D', data, '-l', scratch / 'postgres.log',
                        '-o', f'-h 127.0.0.1 -p {port} -c unix_socket_directories=', '-w', 'start'],
                       check=True, stdout=log, stderr=log, stdin=subprocess.DEVNULL)
        try:
            yield port
        finally:
            subprocess.run([tools / 'pg_ctl', '-D', data, '-m', 'fast', '-w', 'stop'],
                           check=True, stdout=log, stderr=log, stdin=subprocess.DEVNULL)


def save(browser, item, data):
    return browser.call('PATCH', '/api/objects/' + ('agents/' if 'roleKey' in data else 'flows/') + item['id'],
                        expected=200, body={'name': item['name'], 'expectedVersion': item['version'], 'data': data})[2]


def seed(browser):
    roles = [browser.post('/api/objects/agents', {'name': f'Permission role {i}',
              'data': {'roleKey': f'permission.role.{i}', 'description': 'Synthetic permissions test'}}, 201)
             for i in range(4)]
    nodes = []
    for purpose in ('requirement', 'product', 'frontend', 'backend', 'test', 'repair', 'other'):
        nodes.append({'id': str(uuid4()), 'name': purpose, 'type': 'work', 'purpose': purpose,
                      'dependencies': [nodes[-1]['id']] if nodes else [], 'coordinatorId': roles[0]['id'],
                      'agentIds': [r['id'] for r in roles[1:]], 'agentOrder': 'parallel'})
    nodes.append({'id': str(uuid4()), 'name': 'End', 'type': 'end', 'dependencies': [nodes[-1]['id']]})
    flows = [browser.post('/api/objects/flows', {'name': 'Every legacy purpose',
             'data': {'stages': [{'id': str(uuid4()), 'name': 'Sequence', 'nodes': nodes}]}}, 201)]
    check = nested_routes(roles)
    for node in check['stages'][0]['nodes']:
        if node['type'] != 'end':
            node['purpose'] = 'frontend'
    flows.append(browser.post('/api/objects/flows', {'name': 'Check permissions', 'data': check}, 201))
    return roles, flows


def assignments(connect, workflow, version):
    with connect() as db:
        return db.execute('SELECT node_id,agent_id,role,workspace_access FROM agentship_design.workflow_role '
                          'WHERE workflow_id=%s AND workflow_version=%s ORDER BY node_id,agent_id',
                          (workflow, version)).fetchall()


def verify(browser, connect, roles, flows):
    for flow in flows:
        current = browser.get('/api/objects/flows/' + flow['id'])
        nodes = {n['id']: n for s in current['data']['stages'] for n in s['nodes']}
        before = assignments(connect, current['id'], 1)
        for node, agent, role, access in before:
            n = nodes[str(node)]
            expected = 'read_only' if n['type'] == 'check' and role == 'coordinator' else (
                'write' if role == 'coordinator' or n.get('purpose') in ('frontend', 'backend', 'repair') else 'read_only')
            assert access == expected, (n['name'], role, access, expected)
        for node in nodes.values():
            assert node['collectRequirements'] == (node.get('purpose') == 'requirement')
            node.pop('purpose', None)
        updated = save(browser, current, current['data'])
        assert assignments(connect, updated['id'], 2) == before, 'Resaving changed legacy permissions'
        assert assignments(connect, updated['id'], 1) == before, 'Historical permissions changed'
        with connect() as db:
            try:
                db.execute("UPDATE agentship_design.workflow_role SET workspace_access='write' WHERE workflow_id=%s", (flow['id'],))
            except psycopg.Error:
                db.rollback()
            else:
                raise AssertionError('Historical workflow guard was not restored')
    print('PASS migration and resave preserve every purpose, check coordinators, and historical guards', flush=True)

    for index, role in enumerate(roles):
        current = browser.get('/api/objects/agents/' + role['id'])
        assert current['data']['workspaceAccess'] == 'legacy'
        data = {**current['data'], 'workspaceAccess': 'read_only' if index == 0 else 'write'}
        roles[index] = save(browser, current, data)
        # Older clients omitting the new field must not reset explicit access.
        data.pop('workspaceAccess')
        preserved = save(browser, roles[index], data)
        assert preserved['data']['workspaceAccess'] == ('read_only' if index == 0 else 'write')
        roles[index] = preserved
    for flow in flows:
        current = browser.get('/api/objects/flows/' + flow['id'])
        saved = save(browser, current, current['data'])
        for node, agent, role, access in assignments(connect, saved['id'], saved['workflowVersion']):
            assert access == ('read_only' if role == 'coordinator' else 'write')
    # Even an explicitly writable coordinator cannot write in a check node.
    coordinator = roles[0]
    roles[0] = save(browser, coordinator, {**coordinator['data'], 'workspaceAccess': 'write'})
    current = browser.get('/api/objects/flows/' + flows[1]['id'])
    saved = save(browser, current, current['data'])
    checks = {n['id'] for s in saved['data']['stages'] for n in s['nodes'] if n['type'] == 'check'}
    for node, agent, role, access in assignments(connect, saved['id'], saved['workflowVersion']):
        assert access == ('read_only' if str(node) in checks and role == 'coordinator' else 'write')
    print('PASS explicit read/write permissions, old-client edits, version pinning and read-only checks', flush=True)

    current = browser.get('/api/objects/flows/' + flows[0]['id'])
    data = deepcopy(current['data'])
    first = data['stages'][0]['nodes'][0]
    first['purpose'], first['collectRequirements'] = 'requirement', False
    saved = save(browser, current, data)
    assert saved['data']['stages'][0]['nodes'][0]['collectRequirements'] is False
    data = deepcopy(saved['data'])
    first = data['stages'][0]['nodes'][0]
    first.pop('purpose')
    first['collectRequirements'] = True
    saved = save(browser, saved, data)
    assert saved['data']['stages'][0]['nodes'][0]['collectRequirements'] is True
    for value in (True, 'false', None):
        invalid = deepcopy(saved['data'])
        invalid['stages'][0]['nodes'][-1]['collectRequirements'] = value
        browser.call('PATCH', '/api/objects/flows/' + saved['id'], expected=400,
                     body={'name': saved['name'], 'expectedVersion': saved['version'], 'data': invalid})
    browser.post('/api/objects/agents', {'name': 'Invalid access', 'data': {
        'roleKey': 'invalid.access', 'description': '', 'workspaceAccess': 'admin'}}, 400)
    print('PASS explicit gathering overrides old purpose; end-node and permission validation', flush=True)


def runtime(browser, connect, origin):
    roles = [browser.post('/api/objects/agents', {'name': access, 'data': {
        'roleKey': 'runtime.' + access, 'description': 'Permission test', 'workspaceAccess': access}}, 201)
        for access in ('read_only', 'write')]
    node = {'id': str(uuid4()), 'name': 'Gather', 'type': 'work', 'collectRequirements': True,
            'dependencies': [], 'coordinatorId': roles[0]['id'], 'agentIds': [roles[1]['id']]}
    end = {'id': str(uuid4()), 'name': 'End', 'type': 'end', 'dependencies': [node['id']]}
    flow = browser.post('/api/objects/flows', {'name': 'Explicit behavior', 'data': {
        'stages': [{'id': str(uuid4()), 'name': 'Gather', 'nodes': [node, end]}]}}, 201)
    for description, expected in [('Ready to deliver', ('completed', None)),
                                   ('', ('needs_attention', 'AGENT_REQUIREMENT_REQUIRED'))]:
        data = fixture(browser, connect, origin, flow, description)
        child, = poll(origin, data)['jobs']
        assert child['input']['permissions'] == {'workspaceAccess': 'write'}
        assert child['input']['node']['collectRequirements'] is True
        assert 'purpose' not in child['input']['node']
        complete(origin, data, child)
        coordinator, = poll(origin, data)['jobs']
        assert coordinator['input']['permissions'] == {'workspaceAccess': 'read_only'}
        complete(origin, data, coordinator)
        assert run_state(connect, data) == expected
    print('PASS actual job dispatch carries permissions; requirement gathering gates completion', flush=True)
    serial(browser, connect, origin)
    parallel(browser, connect, origin)
    checks(browser, connect, origin)


def worker_permissions(java, jar, scratch):
    with zipfile.ZipFile(jar) as archive:
        for entry in archive.namelist():
            if entry.startswith('BOOT-INF/classes/') and entry.endswith('.class') or (
                    entry.startswith('BOOT-INF/lib/jackson-') and entry.endswith('.jar')):
                archive.extract(entry, scratch)
    classpath = os.pathsep.join([str(scratch / 'BOOT-INF/classes'), str(scratch / 'BOOT-INF/lib/*')])
    subprocess.run([java, '--class-path', classpath, Path(__file__).with_name('WorkerPermissionsCheck.java')], check=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--java', type=Path, required=True)
    parser.add_argument('--postgres-bin', type=Path, required=True)
    parser.add_argument('--baseline-jar', type=Path, help='Optional pre-V8 build to verify the real upgrade')
    parser.add_argument('--jar', type=Path, default=JAR)
    args = parser.parse_args()
    with tempfile.TemporaryDirectory(prefix='agentship-permissions-') as directory:
        scratch = Path(directory)
        worker_permissions(args.java, args.jar, scratch)
        with postgres(args.postgres_bin, scratch) as port:
            def connect():
                return psycopg.connect(host='127.0.0.1', port=port, user='design_check', dbname='postgres')
            key = secrets.token_urlsafe(40)
            app_port = free_port()
            with platform(args.java, args.baseline_jar or args.jar, scratch, port, app_port, key, 'seed') as origin:
                browser = Browser(origin)
                create_account(browser, account('permission_owner', 9201))
                roles, flows = seed(browser)
            with platform(args.java, args.jar, scratch, port, app_port, key, 'upgrade') as origin:
                browser = Browser(origin)
                browser.login('permission_owner')
                verify(browser, connect, roles, flows)
                runtime(browser, connect, origin)


if __name__ == '__main__':
    main()
