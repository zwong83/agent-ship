"""Local-only synthetic dashboard data; does not execute agents or touch user runs.

Run against scripts/start-local.ps1. Create .agentship/stop-dashboard-preview to
retire this process's runs. Credentials remain in the ignored local directory.
"""
import json
import secrets
import time
from pathlib import Path

import psycopg

from verify_first_batch import Browser, TEST_PASSWORD
from verify_node_jobs import create_flow, end, fixture, poll, stage, work
from verify_git_jobs import Driver


def main():
    root = Path(__file__).resolve().parents[2]
    local = root / '.agentship'
    stop = local / 'stop-dashboard-preview'
    stop.unlink(missing_ok=True)
    origin = 'http://127.0.0.1:4173'
    password = (local / 'postgres-password').read_text().strip()

    def connect():
        return psycopg.connect(host='127.0.0.1', port=55432, user='agentship_dev',
                               password=password, dbname='agentship')

    browser = Browser(origin)
    username = 'dashboard_review_' + secrets.token_hex(4)
    browser.post('/api/register', {'name': 'Dashboard preview', 'username': username,
                 'email': None, 'phone': None, 'password': TEST_PASSWORD,
                 'confirmPassword': TEST_PASSWORD}, 202)
    browser.login(username)
    first = work('Define acceptance', 'Delivery coordinator', children=['Product agent'])
    second = work('Implement delivery', 'Delivery coordinator', [first['id']],
                  children=['Frontend engineer', 'Backend engineer'])
    flow, _ = create_flow(browser, [stage('Define', first), stage('Build', second, end(second['id']))],
                           ['Delivery coordinator', 'Product agent', 'Frontend engineer', 'Backend engineer'])
    fixtures = []
    retire_ids = []
    metadata = {'username': username, 'requirements': [], 'runs': []}
    try:
        names = ['API delivery', 'Data platform', 'Orbital interface', 'Quality gates',
                 'Release verification', 'Service rollout', 'Waiting deployment']
        for index, name in enumerate(names):
            name += ' ' + username[-4:]
            data = fixture(browser, connect, origin, flow)
            retire_ids.append(data['run'])
            fixtures.append((data, []))
            detail = browser.get('/api/runs/' + data['run'])
            requirement = browser.get('/api/objects/requirements/' + detail['requirementId'])
            browser.call('PATCH', '/api/objects/requirements/' + requirement['id'], expected=200,
                         body={'name': name, 'data': requirement['data'], 'expectedVersion': requirement['version']})
            metadata['requirements'].append({'id': requirement['id'], 'name': name})
            metadata['runs'].append({'id': data['run'], 'name': name})
            if index == 6:
                with connect() as db:
                    db.execute("UPDATE agentship_design.run SET state='queued',reason_code=NULL,state_version=state_version+1 WHERE id=%s", (data['run'],))
                continue
            # Recorded fixture progress, not an assertion about actual agent execution.
            if index % 2 == 0:
                with connect() as db:
                    db.execute("UPDATE agentship_design.node_execution SET state='complete',started_at=statement_timestamp() WHERE run_id=%s AND node_id=%s", (data['run'], first['id']))
            jobs = poll(origin, data, 2)['jobs']
            active = fixtures[-1][1]
            for job_index, job in enumerate(jobs):
                if index == 4 and job_index == 0:
                    driver = Driver(origin, data, job)
                    driver.event('progress', {'threadId': 'dashboard-review-question'})
                    driver.event('question', {'text': 'Which acceptance criteria should this release verify?',
                                             'sessionRef': 'dashboard-review-question'})
                else:
                    active.append({key: job[key] for key in ('taskId', 'attemptId', 'epoch')})
        historical = fixture(browser, connect, origin, flow)
        retire_ids.append(historical['run'])
        history_detail = browser.get('/api/runs/' + historical['run'])
        history_requirement = browser.get('/api/objects/requirements/' + history_detail['requirementId'])
        history_name = 'Archived handoff ' + username[-4:]
        browser.call('PATCH', '/api/objects/requirements/' + history_requirement['id'], expected=200,
                     body={'name': history_name, 'data': history_requirement['data'],
                           'expectedVersion': history_requirement['version']})
        with connect() as db:
            db.execute("UPDATE agentship_design.node_execution SET state='complete',started_at=statement_timestamp() WHERE run_id=%s", (historical['run'],))
            db.execute("UPDATE agentship_design.run SET state='completed',finished_at=statement_timestamp(),state_version=state_version+1 WHERE id=%s", (historical['run'],))
        metadata['requirements'].append({'id': history_requirement['id'], 'name': history_name})
        metadata['runs'].append({'id': historical['run'], 'name': history_name})
        project = browser.get('/api/projects')['items'][0]['id']
        for index in range(1, 5):
            requirement = browser.post('/api/objects/requirements', {
                'name': f'Upcoming requirement {index} {username[-4:]}',
                'data': {'projectId': project, 'description': 'Synthetic unstarted dashboard requirement'}}, 201)
            metadata['requirements'].append({'id': requirement['id'], 'name': requirement['name']})
        (local / 'dashboard-preview.json').write_text(json.dumps(metadata, indent=2))
        print('READY: ' + username + '; 12 synthetic requirements, 7 operational runs, one blocked, one completed.', flush=True)
        deadline = time.monotonic() + 1800
        while time.monotonic() < deadline and not stop.exists():
            for index, (data, active) in enumerate(fixtures):
                if index == 6:
                    with connect() as db:
                        db.execute('UPDATE agentship_design.device SET last_seen_at=statement_timestamp() WHERE id=%s', (data['device'],))
                    continue
                poll(origin, data, slots=0, active=active)
            time.sleep(5)
    finally:
        with connect() as db:
            for run_id in retire_ids:
                db.execute("UPDATE agentship_design.run SET state='stopped',finished_at=statement_timestamp(),state_version=state_version+1 WHERE id=%s AND finished_at IS NULL", (run_id,))
        print('STOPPED: only this preview account runs retired.', flush=True)


if __name__ == '__main__':
    main()
