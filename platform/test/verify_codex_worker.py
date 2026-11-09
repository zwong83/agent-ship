"""Java role worker boundary tests using loopback HTTP, Git and Codex stdio fixtures."""
import argparse
import json
import hashlib
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import time
from uuid import uuid4
from http.server import BaseHTTPRequestHandler, SimpleHTTPRequestHandler, ThreadingHTTPServer

from verify_first_batch import JAR, WORKSPACE, free_port
from verify_git_worker import deadline


class Platform:
    def __init__(self, jobs, coordinator=None, drop_ack=False, conversation=None):
        self.jobs = jobs
        self.events = []
        self.polls = []
        self.keys = {}
        self.requests = []
        self.coordinator = coordinator
        self.drop_ack = drop_ack
        self.conversation = conversation
        self.chat_job = jobs[0]
        self.inbox = None
        self.delivered = set()
        self.unknown = set()

    def record_chat(self, task, event):
        if not self.conversation or task != self.chat_job['taskId']:
            return
        result = event['result']
        self.delivered.update(result.get('deliveredInboxIds', []))
        self.unknown.update(result.get('unknownInboxIds', []))
        if self.inbox is not None:
            return
        kind = None
        if self.conversation in ('chat-message', 'chat-lost-steer-ack', 'chat-unknown-steer') and event['type'] == 'progress' and result.get('turnId'):
            kind = 'message'
        elif event['type'] == 'question' and self.conversation in ('chat-answer', 'chat-cancel', 'chat-lost-answer-ack'):
            kind = 'continue_without_answer' if self.conversation == 'chat-cancel' else 'answer'
            self.jobs.append({**self.chat_job, 'epoch': 2})
        if kind:
            self.inbox = {'id': str(uuid4()), 'taskId': task, 'kind': kind,
                          'sessionRef': result.get('sessionRef', result.get('threadId')),
                          'text': {'answer': 'Synthetic acceptance threshold 12', 'message': 'Synthetic scoped adjustment',
                                   'continue_without_answer': '请根据已有信息继续。'}[kind]}

    def handler(self):
        platform = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *_):
                pass

            def do_POST(self):
                body = json.loads(self.rfile.read(int(self.headers.get('Content-Length', 0))))
                if self.path == '/api/worker/pair':
                    result = {'deviceId': str(uuid4()), 'token': 'synthetic-role-worker-token', 'protocolVersion': '1'}
                elif self.path == '/api/worker/poll':
                    platform.polls.append(body)
                    jobs = []
                    if body.get('acceptsAgentJobs'):
                        for _ in range(min(body['availableSlots'], len(platform.jobs))):
                            jobs.append({**platform.jobs.pop(0), 'deadlineAt': deadline()})
                    inbox = []
                    if platform.inbox and platform.inbox['id'] not in platform.delivered | platform.unknown:
                        inbox = [platform.inbox, {**platform.inbox, 'id': str(uuid4()), 'sessionRef': 'wrong-session'}]
                    result = {'jobs': jobs, 'inbox': inbox, 'pollAfterMillis': 100,
                              'renewed': [{**key, 'deadlineAt': deadline()} for key in body['active']]}
                elif self.path.endswith('/event'):
                    key = self.headers['Idempotency-Key']
                    platform.requests.append((key, body))
                    if key not in platform.keys:
                        platform.keys[key] = body
                        task = self.path.split('/')[-2]
                        platform.events.append((task, body))
                        platform.record_chat(task, body)
                    else:
                        assert platform.keys[key] == body
                    if platform.coordinator and body['type'] == 'complete' and len(
                            [event for _, event in platform.events if event['type'] == 'complete']) == 2:
                        coordinator = platform.coordinator
                        coordinator['input']['siblingArtifacts'] = [event['result']['artifacts'][0]
                            for _, event in platform.events if event['type'] == 'complete']
                        platform.jobs.append(coordinator)
                        platform.coordinator = None
                    if platform.drop_ack and body['type'] == 'complete':
                        platform.drop_ack = False
                        self.close_connection = True
                        self.connection.close()
                        return
                    result = {'accepted': True}
                else:
                    self.send_error(404)
                    return
                encoded = json.dumps(result).encode()
                self.send_response(201 if self.path.endswith('/pair') else 200)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', str(len(encoded)))
                self.end_headers()
                self.wfile.write(encoded)
        return Handler


def job(kind, run_id, repo, commit):
    return {'kind': kind, 'taskId': str(uuid4()), 'attemptId': str(uuid4()), 'epoch': 1,
            'runId': run_id, 'nodeId': str(uuid4()), 'wave': 1,
            'input': {'requirementId': str(uuid4()), 'requirementName': 'Synthetic requirement',
                      'requirementRevision': 1, 'workflowVersion': 1, 'workType': 'feature',
                      'roleId': 'selected-role', 'roleInstruction': 'Frozen role instruction',
                      'node': {'name': 'Synthetic node', 'type': 'work'},
                      'upstreamArtifacts': [], 'siblingArtifacts': [],
                      'git': {'repository': repo, 'baseBranch': 'dev', 'workBranch': 'feature/' + run_id,
                              'baseCommit': commit, 'headCommit': commit}}}


def run_worker(args, scratch, platform, extra=(), environment=None, expect=1, jvm=(), expect_ack_retry=False, restart=None):
    server = ThreadingHTTPServer(('127.0.0.1', 0), platform.handler())
    threading.Thread(target=server.serve_forever, daemon=True).start()
    command = [str(args.java), *jvm, '-jar', str(args.jar), '--worker', '--platform',
               f'http://127.0.0.1:{server.server_port}', '--state-dir', str(scratch / 'worker'),
               '--pair-code', 'synthetic-code', '--port', str(free_port()), '--execute-git', '--execute-agents', *extra]
    worker = subprocess.Popen(command, env=environment, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        if restart:
            until = time.monotonic() + 15
            checkpoint = None
            while time.monotonic() < until and worker.poll() is None:
                checkpoint = next((event['result'] for _, event in platform.events
                                   if event['type'] == 'progress' and event['result'].get('turnId')), None)
                if checkpoint:
                    break
                time.sleep(.1)
            assert checkpoint is not None, 'worker never persisted original turn'
            worker.terminate()
            worker.wait(timeout=5)
            platform.jobs.append({**restart, 'epoch': 2, 'checkpoint': checkpoint})
            pair = command.index('--pair-code')
            worker = subprocess.Popen(command[:pair] + command[pair + 2:], env=environment,
                                      stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        until = time.monotonic() + 30
        while time.monotonic() < until and worker.poll() is None:
            terminals = [event for _, event in platform.events if event['type'] in ('complete', 'failure', 'question')]
            if len(terminals) >= expect:
                complete_requests = [key for key, event in platform.requests if event['type'] == 'complete']
                if not expect_ack_retry or len(complete_requests) > len(set(complete_requests)):
                    return terminals
            time.sleep(.1)
        assert platform.polls and platform.polls[0].get('acceptsAgentJobs'), 'worker did not advertise role execution'
        raise AssertionError('Worker did not send terminal results')
    finally:
        worker.terminate()
        try:
            worker.wait(timeout=5)
        except subprocess.TimeoutExpired:
            worker.kill()
            worker.wait(timeout=5)
        server.shutdown()
        server.server_close()


def demo(args, scratch, repair_waves=False):
    scratch.mkdir(exist_ok=True)
    run_id = str(uuid4())
    name = 'fixture/role-worker'
    repo = {'provider': 'demo', 'repositoryId': 'demo:' + name, 'displayName': name, 'defaultBranch': 'main'}
    root = scratch / 'worker'
    root.mkdir(mode=0o700)
    repo_path = root / 'repositories' / (hashlib.sha256(name.encode()).hexdigest() + '.git')
    repo_path.parent.mkdir(mode=0o700)
    subprocess.run(['git', 'init', '--bare', '--initial-branch=main', str(repo_path)], check=True, capture_output=True)
    git = ['git', '--git-dir', str(repo_path)]
    tree = subprocess.check_output(git + ['mktree'], input=b'').decode().strip()
    commit = subprocess.check_output(git + ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid',
                                             'commit-tree', tree, '-m', 'Synthetic baseline']).decode().strip()
    subprocess.run(git + ['update-ref', 'refs/heads/feature/' + run_id, commit], check=True)
    if repair_waves:
        tasks = [job('coordinator', run_id, repo, commit) for _ in range(3)]
        candidate = {'commit': commit, 'version': f'git:{repo["repositoryId"]}@{commit}'}
        for wave, task in enumerate(tasks, 1):
            task['wave'] = wave
            task['input']['node']['type'] = 'check'
            task['input']['roleInstruction'] += ' [demo:repair-until=2]'
            task['input']['checkCandidate'] = candidate
        platform = Platform(tasks.copy())
        run_worker(args, scratch, platform, expect=3)
        results = {task: event for task, event in platform.events if event['type'] == 'complete'}
        reports = [results[task['taskId']]['result']['check'] for task in tasks]
        assert [report['outcome'] for report in reports] == ['repair', 'repair', 'pass'], reports
        assert all(report['testedCommit'] == commit for report in reports)
        print('PASS demo repair threshold changes verdict on the next check wave')
        return
    task = job('coordinator', run_id, repo, commit)
    platform = Platform([task])
    result, = run_worker(args, scratch, platform)
    assert result['type'] == 'complete', result
    claim, = result['result']['artifacts']
    path = root / 'agent-jobs' / run_id / task['taskId'] / task['attemptId'] / 'workspace'
    artifact = '.agentship-results/' + task['attemptId'] + '/result.md'
    content = subprocess.check_output(['git', '-C', str(path), 'show', claim['commit'] + ':' + artifact])
    assert claim['kind'] == 'product'
    assert claim['sourceRef'] == f"local-git:{run_id}/{task['taskId']}/{task['attemptId']}@{claim['commit']}:{artifact}"
    assert claim['contentDigest'] == 'sha256:' + hashlib.sha256(content).hexdigest()
    print('PASS local demo role dispatch archives verified immutable Git artifact')


def codex(args, scratch, scenario):
    scratch.mkdir()
    run_id = str(uuid4())
    name = 'fixture/codex-worker'
    repo = {'provider': 'github', 'repositoryId': '12345', 'displayName': name, 'defaultBranch': 'main'}
    remote = scratch / 'remote'
    bare = remote / (name + '.git')
    bare.parent.mkdir(parents=True)
    seed = scratch / 'seed'
    subprocess.run(['git', 'init', '--initial-branch=main', str(seed)], check=True, capture_output=True)
    (seed / 'shared.txt').write_text('Synthetic baseline\n')
    git = ['git', '-C', str(seed), '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid']
    subprocess.run(git + ['add', 'shared.txt'], check=True)
    if scenario.startswith('check-maven'):
        (seed / 'pom.xml').write_text('<project/>\n')
        subprocess.run(git + ['add', 'pom.xml'], check=True)
    subprocess.run(git + ['commit', '-m', 'Synthetic base'], check=True, capture_output=True)
    commit = subprocess.check_output(git + ['rev-parse', 'HEAD'], text=True).strip()
    subprocess.run(['git', 'clone', '--bare', str(seed), str(bare)], check=True, capture_output=True)
    subprocess.run(['git', '--git-dir', str(bare), 'update-server-info'], check=True)

    class RepoHandler(SimpleHTTPRequestHandler):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, directory=str(remote), **kwargs)

        def log_message(self, *_):
            pass

        def do_GET(self):
            if self.path == '/repos/' + name:
                encoded = json.dumps({'id': 12345, 'full_name': name, 'default_branch': 'main'}).encode()
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', str(len(encoded)))
                self.end_headers()
                self.wfile.write(encoded)
            else:
                assert self.headers.get('Authorization') is None
                super().do_GET()

    github = ThreadingHTTPServer(('127.0.0.1', 0), RepoHandler)
    threading.Thread(target=github.serve_forever, daemon=True).start()
    bin_dir, store = scratch / 'bin', scratch / 'codex-state'
    bin_dir.mkdir()
    store.mkdir()
    executable = bin_dir / 'codex'
    fd = os.open(executable, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o700)
    with os.fdopen(fd, 'wb') as fixture:
        fixture.write(Path(__file__).with_name('codex_app_server_fixture.py').read_bytes())
    env = {'PATH': str(bin_dir) + os.pathsep + os.environ['PATH'],
           'AGENTSHIP_GITHUB_TOKEN': 'synthetic-github-token', 'GITHUB_TOKEN': 'synthetic-unused-token', 'FIXTURE_CODEX_STORE': str(store),
           'FIXTURE_CODEX_SCENARIO': scenario}
    jobs = [job('agent', run_id, repo, commit)]
    if scenario.startswith('check-'):
        jobs = [job('coordinator', run_id, repo, commit)]
        configure_check(scratch, seed, git, jobs[0], scenario)
    coordinator = None
    multi_role = scenario == 'normal' or scenario.startswith('conflict')
    if multi_role:
        jobs.append(job('agent', run_id, repo, commit))
        coordinator = job('coordinator', run_id, repo, commit)
        for task, marker in zip([*jobs, coordinator], ['Role A marker', 'Role B marker', 'Coordinator marker']):
            task['input']['node']['purpose'] = 'backend'
            task['input']['roleInstruction'] += ' ' + marker
    platform = Platform(jobs.copy(), coordinator, drop_ack=scenario == 'normal',
                        conversation=scenario if scenario.startswith('chat-') else None)
    question_case = scenario in ('chat-answer', 'chat-cancel', 'chat-lost-answer-ack')
    restart = jobs[0] if scenario == 'worker-restart' else None
    try:
        results = run_worker(args, scratch, platform, ['--mode', 'codex', '--git-provider', 'github'],
                             environment=env, expect=3 if multi_role else 2 if question_case else 1,
                             jvm=['-Dagentship.test.allow-fake-github=true',
                                  f'-Dagentship.test.github-api=http://127.0.0.1:{github.server_port}'],
                             expect_ack_retry=scenario == 'normal', restart=restart)
    finally:
        github.shutdown()
        github.server_close()

    if scenario == 'chat-unknown-steer':
        assert results[0]['type'] == 'failure' and results[0]['result']['reasonCode'] == 'AGENT_RESUME_REQUIRED', results
        assert platform.unknown == {platform.inbox['id']} and not platform.delivered
        assert len(list(store.glob('*.steer'))) == 1, 'unverified input was sent again'
    elif scenario.startswith('chat-'):
        assert results[-1]['type'] == 'complete', results
        assert platform.delivered == {platform.inbox['id']}, platform.delivered
        replies = [event['result'] for _, event in platform.events if event['type'] == 'message']
        assert replies == [{'sessionRef': platform.inbox['sessionRef'], 'inReplyToInboxId': platform.inbox['id'],
                            'text': 'Synthetic reply to selected input'}], replies
        assert len(list(store.glob('*.json'))) == 1, 'continuation started a different thread'
        turns = json.loads(next(store.glob('*.json')).read_text())
        assert len(turns) == (2 if question_case else 1), turns
        if question_case:
            assert results[0]['type'] == 'question' and results[-1]['epoch'] == 2
    elif scenario.startswith('check-'):
        expected = {'check-clean': 'pass', 'check-dirty': 'repair', 'check-mismatch': 'unresolved',
                    'check-false-model-pass': 'unresolved', 'check-maven-pass': 'pass', 'check-maven-fail': 'repair',
                    'check-maven-skipped': 'unresolved', 'check-maven-unavailable': 'unresolved'}[scenario]
        assert results[0]['type'] == 'complete', results
        report = results[0]['result']['check']
        assert report['outcome'] == expected, report
        candidate = jobs[0]['input']['checkCandidate']
        if expected != 'unresolved':
            assert report['testedCommit'] == candidate['commit']
            assert report['testedArtifactVersion'] == candidate['version']
        else:
            assert 'testedCommit' not in report and 'testedArtifactVersion' not in report
        assert len(list(store.glob('*.start'))) == (1 if scenario == 'check-false-model-pass' else 0)
    elif scenario == 'question':
        assert results[0]['type'] == 'question', results
        assert results[0]['result']['text'] == 'What is the acceptance threshold?'
        assert any(event['result'].get('threadId') == results[0]['result']['sessionRef'] for _, event in platform.events)
    elif scenario == 'missing-artifact':
        assert results[0]['result']['reasonCode'] == 'AGENT_ARTIFACT_REQUIRED', results
    elif scenario == 'conflict-unresolved':
        assert results[-1]['result']['reasonCode'] == 'AGENT_ARTIFACT_CONFLICT', results
        assert len(list(store.glob('*.start'))) == 3
    else:
        assert all(event['type'] == 'complete' for event in results), results
        assert len(list(store.glob('*.start'))) == (3 if multi_role else 1)
        if multi_role:
            artifacts = [event['result']['artifacts'][0] for event in results]
            assert [artifact['kind'] for artifact in artifacts] == ['other', 'other', 'product']
            workspace = scratch / 'worker' / 'agent-jobs' / run_id / coordinator['taskId'] / coordinator['attemptId'] / 'workspace'
            if scenario == 'normal':
                assert (workspace / 'a.txt').exists() and (workspace / 'b.txt').exists()
                assert len(platform.polls) >= 2 and platform.polls[0]['availableSlots'] == 4
            else:
                assert (workspace / 'shared.txt').read_text() == 'Both roles combined\n'
        elif scenario == 'worker-restart':
            assert results[0]['epoch'] == 2
            checkpoint = [event for _, event in platform.events if event['result'].get('turnId')]
            assert len(checkpoint) == 2 and checkpoint[0]['result']['turnId'] == checkpoint[1]['result']['turnId']
            assert checkpoint[1]['sequence'] == 1
        else:
            assert len([event for _, event in platform.events if event['result'].get('turnId')]) == 1
    print('PASS Java Codex stdio fixture ' + scenario)


def configure_check(scratch, seed, git, task, scenario):
    run_id = task['runId']
    input = task['input']
    input['node']['type'] = 'check'
    if scenario.startswith('check-maven'):
        input['roleInstruction'] += ' [check:maven-test]'
    elif scenario != 'check-false-model-pass':
        input['roleInstruction'] += ' [check:git-diff]'
    (seed / 'shared.txt').write_text('Changed line \n' if scenario == 'check-dirty' else 'Changed line\n')
    subprocess.run(git + ['add', '--', 'shared.txt'], check=True)
    worker_state = scratch / 'worker'
    worker_state.mkdir(mode=0o700)
    if scenario.startswith('check-maven'):
        (worker_state / 'maven-repository').mkdir(mode=0o700)

    def local_artifact(content):
        source_task, source_attempt = str(uuid4()), str(uuid4())
        artifact_path = f'.agentship-results/{source_attempt}/result.md'
        report = seed / artifact_path
        report.parent.mkdir(parents=True)
        report.write_bytes(content)
        subprocess.run(git + ['add', '--', artifact_path], check=True)
        subprocess.run(git + ['commit', '-m', 'Synthetic report'], check=True, capture_output=True)
        commit = subprocess.check_output(git + ['rev-parse', 'HEAD'], text=True).strip()
        workspace = worker_state / 'agent-jobs' / run_id / source_task / source_attempt / 'workspace'
        workspace.parent.mkdir(parents=True, mode=0o700)
        subprocess.run(['git', 'clone', str(seed), str(workspace)], check=True, capture_output=True)
        return {'commit': commit,
                'sourceRef': f'local-git:{run_id}/{source_task}/{source_attempt}@{commit}:{artifact_path}',
                'contentDigest': 'sha256:' + hashlib.sha256(content).hexdigest()}

    candidate = local_artifact(b'Synthetic candidate report \n')
    input['upstreamArtifacts'] = [candidate]
    input['checkCandidate'] = {'commit': candidate['commit'], 'version': candidate['sourceRef']}
    if scenario == 'check-mismatch':
        input['checkCandidate']['version'] += '.wrong'
    if scenario == 'check-clean':
        input['siblingArtifacts'] = [local_artifact(b'Read-only check sub-role report \n')]


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--java', type=Path, required=True)
    parser.add_argument('--jar', type=Path, default=JAR)
    parser.add_argument('--checks-only', action='store_true')
    parser.add_argument('--chat-only', action='store_true')
    parser.add_argument('--maven-only', action='store_true')
    args = parser.parse_args()
    with tempfile.TemporaryDirectory(prefix='role-worker-', dir=WORKSPACE) as folder:
        if args.chat_only:
            for scenario in ('chat-answer', 'chat-cancel', 'chat-message', 'chat-lost-answer-ack', 'chat-lost-steer-ack', 'chat-unknown-steer'):
                codex(args, Path(folder) / scenario, scenario)
            sys.exit(0)
        if args.maven_only:
            for scenario in ('check-maven-pass', 'check-maven-fail', 'check-maven-skipped', 'check-maven-unavailable'):
                codex(args, Path(folder) / scenario, scenario)
            sys.exit(0)
        if not args.checks_only:
            demo(args, Path(folder))
            for scenario in ('normal', 'lost-turn-ack', 'worker-restart', 'question', 'missing-artifact', 'conflict-resolved', 'conflict-unresolved'):
                codex(args, Path(folder) / scenario, scenario)
        for scenario in ('check-clean', 'check-dirty', 'check-mismatch', 'check-false-model-pass'):
            codex(args, Path(folder) / scenario, scenario)
        demo(args, Path(folder) / 'demo-repair', repair_waves=True)
