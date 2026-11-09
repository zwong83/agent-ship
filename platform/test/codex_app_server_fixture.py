#!/usr/bin/env python3
"""Local Codex App Server protocol fixture. It never invokes a model."""
import json
import os
from pathlib import Path
import sys
from uuid import uuid4

if '--version' in sys.argv:
    print('codex-cli fixture')
    sys.exit(0)

assert 'AGENTSHIP_GITHUB_TOKEN' not in os.environ
assert 'GITHUB_TOKEN' not in os.environ
assert '--listen' in sys.argv and 'stdio://' in sys.argv
store = Path(os.environ['FIXTURE_CODEX_STORE'])
scenario = os.environ.get('FIXTURE_CODEX_SCENARIO', 'normal')


def send(message):
    print(json.dumps(message), flush=True)


def respond(request, result):
    send({'id': request['id'], 'result': result})


def notification(method, params):
    send({'method': method, 'params': params})


def chat_turn(request):
    params = request['params']
    thread = params['threadId']
    path = store / (thread + '.json')
    turns = json.loads(path.read_text()) if path.exists() else []
    prompt = params['input'][0]['text']
    assert params['clientUserMessageId']
    assert 'wrong-session' not in prompt
    message = {'id': str(uuid4()), 'type': 'userMessage', 'clientId': params['clientUserMessageId'],
               'content': params['input']}
    steering_case = scenario in ('chat-message', 'chat-lost-steer-ack', 'chat-unknown-steer')
    if request['method'] == 'turn/steer':
        assert steering_case and len(turns) == 1
        turn = turns[0]
        assert turn['id'] == params['expectedTurnId'] and turn['status'] == 'inProgress'
        assert 'Synthetic scoped adjustment' in prompt
        (store / (str(uuid4()) + '.steer')).write_text('synthetic steer attempt')
        if scenario == 'chat-unknown-steer':
            sys.exit(0)
        turn['items'].append(message)
        if scenario != 'chat-lost-steer-ack':
            respond(request, {'turnId': turn['id']})
    else:
        assert params['sandboxPolicy']['networkAccess'] is False
        turn = {'id': str(uuid4()), 'status': 'inProgress', 'items': [message]}
        turns.append(turn)
        if steering_case and len(turns) == 1:
            path.write_text(json.dumps(turns))
            respond(request, {'turn': turn})
            return
        if len(turns) == 2:
            assert 'Synthetic acceptance threshold 12' in prompt if scenario != 'chat-cancel' else '已有信息' in prompt
    output = {'status': 'complete', 'artifact': 'Verified conversation continuation', 'question': '', 'verdict': 'none',
              'reply': 'Synthetic reply to selected input'}
    if not steering_case and len(turns) == 1:
        output = {'status': 'question', 'artifact': '', 'question': 'What is the acceptance threshold?', 'verdict': 'none', 'reply': ''}
    item = {'type': 'agentMessage', 'text': json.dumps(output)}
    turn['status'] = 'completed'
    turn['items'].append(item)
    path.write_text(json.dumps(turns))
    if scenario == 'chat-lost-answer-ack' and len(turns) == 2:
        sys.exit(0)
    if scenario == 'chat-lost-steer-ack' and request['method'] == 'turn/steer':
        sys.exit(0)
    if request['method'] == 'turn/start':
        respond(request, {'turn': {'id': turn['id'], 'status': 'inProgress'}})
    notification('item/completed', {'threadId': thread, 'turnId': turn['id'], 'item': item})
    notification('turn/completed', {'threadId': thread, 'turn': turn})


for line in sys.stdin:
    request = json.loads(line)
    method = request.get('method')
    params = request.get('params', {})
    if method == 'initialize':
        respond(request, {'userAgent': 'fixture'})
    elif method == 'initialized':
        continue
    elif method == 'thread/start':
        thread = str(uuid4())
        assert params['approvalPolicy'] == 'never' and params['ephemeral'] is False
        assert Path(params['cwd']).resolve() == Path.cwd()
        respond(request, {'thread': {'id': thread}})
    elif method == 'thread/resume':
        thread = params['threadId']
        assert (store / (thread + '.json')).is_file()
        respond(request, {'thread': {'id': thread}})
    elif method == 'thread/read':
        thread = params['threadId']
        turn = json.loads((store / (thread + '.json')).read_text())
        respond(request, {'thread': {'id': thread, 'turns': turn if isinstance(turn, list) else [turn]}})
    elif method in ('turn/start', 'turn/steer') and scenario.startswith('chat-'):
        chat_turn(request)
    elif method == 'command/exec' and scenario.startswith('check-maven'):
        command = params['command']
        assert command[0] == 'mvn' and command[-1] == 'test'
        assert '-o' in command and '-B' in command and '-DfailIfNoTests=true' in command
        assert '-DskipTests=false' in command and '-Dmaven.test.skip=false' in command
        assert Path(command[command.index('-s') + 1]).is_file() and Path(command[command.index('-gs') + 1]).is_file()
        assert params['sandboxPolicy']['type'] == 'workspaceWrite' and params['sandboxPolicy']['networkAccess'] is False
        assert Path(params['cwd']).resolve() == Path.cwd()
        failures = int(scenario == 'check-maven-fail')
        skipped = 4 if scenario == 'check-maven-skipped' else 0
        unavailable = scenario == 'check-maven-unavailable'
        stdout = 'No cached dependency; private diagnostic omitted.' if unavailable else (
            f'[INFO] Tests run: 4, Failures: {failures}, Errors: 0, Skipped: {skipped}\n'
            + ('[INFO] BUILD FAILURE\n' if failures else '[INFO] BUILD SUCCESS\n'))
        respond(request, {'exitCode': 1 if failures or unavailable else 0, 'stdout': stdout, 'stderr': ''})
    elif method == 'turn/start':
        thread = params['threadId']
        prompt = params['input'][0]['text']
        assert 'Frozen role instruction' in prompt
        assert params['approvalPolicy'] == 'never'
        assert params['sandboxPolicy']['networkAccess'] is False
        assert Path(params['cwd']).resolve() == Path.cwd()
        assert params['clientUserMessageId']
        if 'Resolve all conflict markers' in prompt:
            assert 'shared.txt' in prompt
            assert params['sandboxPolicy']['type'] == 'workspaceWrite'
            assert '<<<<<<< ' in Path('shared.txt').read_text()
            if scenario != 'conflict-unresolved':
                Path('shared.txt').write_text('Both roles combined\n')
            content = 'Coordinator reconciled selected-role reports'
        elif 'Coordinator marker' in prompt:
            assert 'Role A report' in prompt and 'Role B report' in prompt
            assert Path('a.txt').read_text() == 'Role A code\n'
            assert Path('b.txt').read_text() == 'Role B code\n'
            content = 'Coordinator received selected-role reports and code'
        elif 'Role A marker' in prompt or 'Role B marker' in prompt:
            role = 'A' if 'Role A marker' in prompt else 'B'
            assert params['sandboxPolicy']['type'] == 'workspaceWrite'
            if scenario.startswith('conflict'):
                Path('shared.txt').write_text('Role ' + role + ' conflicting change\n')
            else:
                Path(role.lower() + '.txt').write_text('Role ' + role + ' code\n')
            content = 'Role ' + role + ' report'
        else:
            assert params['sandboxPolicy']['type'] == 'readOnly'
            content = 'Original confirmed Codex result'
        output = {'status': 'complete', 'artifact': content, 'question': '', 'verdict': 'none'}
        if scenario == 'question':
            output = {'status': 'question', 'artifact': '', 'question': 'What is the acceptance threshold?', 'verdict': 'none'}
        if scenario == 'missing-artifact':
            output['artifact'] = ''
        if scenario == 'check-false-model-pass':
            output['verdict'] = 'pass'
        turn = {'id': str(uuid4()), 'status': 'completed',
                'items': [{'type': 'agentMessage', 'text': json.dumps(output)}]}
        (store / (thread + '.json')).write_text(json.dumps(turn))
        (store / (thread + '.start')).write_text(prompt)
        if scenario == 'lost-turn-ack':
            sys.exit(0)
        respond(request, {'turn': {'id': turn['id'], 'status': 'inProgress'}})
        if scenario == 'worker-restart':
            continue
        notification('item/completed', {'threadId': thread, 'turnId': turn['id'], 'item': turn['items'][0]})
        notification('turn/completed', {'threadId': thread, 'turn': turn})
    elif 'id' in request:
        send({'id': request['id'], 'error': {'code': -32601, 'message': 'Unsupported fixture method'}})
