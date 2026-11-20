"""Verify persisted dashboard activity against a local dashboard_preview.py fixture.

Reads only fixture runs. Creates an unrelated test account to verify access isolation.
"""
import json
import secrets
from pathlib import Path

import psycopg
from verify_first_batch import Browser, TEST_PASSWORD


def main():
    local = Path(__file__).resolve().parents[2] / '.agentship'
    fixture = json.loads((local / 'dashboard-preview.json').read_text())
    browser = Browser('http://127.0.0.1:4173')
    browser.login(fixture['username'])
    with psycopg.connect(host='127.0.0.1', port=55432, dbname='agentship', user='agentship_dev',
                         password=(local / 'postgres-password').read_text().strip()) as db:
        event_count = 0
        for run in fixture['runs']:
            path = '/api/runs/' + run['id']
            events = browser.get(path)['recentActivity']
            expected = db.execute("""
                SELECT id,kind,recorded_at FROM (
                  SELECT e.id::text id,e.event_type kind,e.created_at recorded_at
                  FROM agentship_design.task_event e JOIN agentship_design.role_task t ON t.id=e.task_id WHERE t.run_id=%s
                  UNION ALL SELECT id::text || ':started','started',created_at FROM agentship_design.run WHERE id=%s
                  UNION ALL SELECT id::text || ':finished',state,finished_at FROM agentship_design.run WHERE id=%s AND finished_at IS NOT NULL
                ) recorded ORDER BY recorded_at DESC,id DESC LIMIT 30
                """, (run['id'], run['id'], run['id'])).fetchall()
            assert len(events) == len(expected) <= 30
            for actual, recorded in zip(events, expected):
                from datetime import datetime
                assert actual['id'] == recorded[0] and actual['kind'] == recorded[1]
                assert datetime.fromisoformat(actual['time'].replace('Z', '+00:00')) == recorded[2]
            assert browser.get(path)['recentActivity'] == events, 'Polling must not invent timestamps'
            event_count += len(events)
    assert event_count > 0
    outsider = Browser(browser.origin)
    path = '/api/runs/' + fixture['runs'][0]['id']
    outsider.get(path, expected=401)
    username = 'activity_isolation_' + secrets.token_hex(4)
    outsider.post('/api/register', {'name': 'Activity isolation test', 'username': username,
                  'email': None, 'phone': None, 'password': TEST_PASSWORD, 'confirmPassword': TEST_PASSWORD}, 202)
    outsider.login(username)
    outsider.get(path, expected=404)
    print(f'PASS {event_count} persisted events: exact database timestamps, stable polling, anonymous and cross-account isolation')


if __name__ == '__main__':
    main()
