"""Local Java worker, HTTP device proof and isolated PostgreSQL integration."""
import argparse
import base64
from contextlib import contextmanager
import json
from pathlib import Path
import secrets
import socket
import subprocess
import sys
import tempfile
import time
from urllib.request import Request, build_opener, ProxyHandler
from urllib.error import HTTPError, URLError
from verify_first_batch import Browser, JAR, WORKSPACE, account, create_account, free_port, platform, postgres


def bridge(origin, port, path, body=None, expected=200, headers_extra=None, method=None):
    headers = {'Origin': origin, 'Accept': 'application/json'}
    if body is not None: headers['Content-Type'] = 'application/json'
    headers.update(headers_extra or {})
    req = Request(f'http://127.0.0.1:{port}{path}', headers=headers, method=method,
                  data=json.dumps(body).encode() if body is not None else None)
    try: response = build_opener(ProxyHandler({})).open(req, timeout=4)
    except HTTPError as error: response = error
    with response:
        assert response.status == expected, f'bridge {path}: {response.status}, expected {expected}'
        data = response.read()
        if expected == 204:
            assert response.headers['Access-Control-Allow-Origin'] == origin
            assert response.headers['Access-Control-Allow-Headers'] == 'Content-Type'
        return json.loads(data) if data else None


@contextmanager
def worker(java, jar, scratch, origin, port, code=None):
    args = [str(java), '-jar', str(jar), '--worker', '--platform', origin,
            '--state-dir', str(scratch / 'worker'), '--port', str(port), '--name', 'Fixture computer']
    if code: args += ['--pair-code', code]
    with (scratch / 'worker-output.log').open('wb') as output:
        process = subprocess.Popen(args, stdout=output, stderr=subprocess.STDOUT)
        try:
            deadline = time.monotonic() + 15
            while time.monotonic() < deadline and process.poll() is None:
                try:
                    status = bridge(origin, port, '/status')
                    if status.get('connectivity') == 'online': break
                except (OSError, URLError, AssertionError): time.sleep(.1)
            else: raise AssertionError('Java worker did not become ready')
            yield status
        finally:
            process.terminate()
            try: process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill(); process.wait(timeout=5)



def worker_call(origin, path, body, token=None, expected=200):
    headers = {'Origin': origin, 'Content-Type': 'application/json'}
    if token: headers['Authorization'] = 'Bearer ' + token
    req = Request(origin + path, headers=headers, data=json.dumps(body).encode(), method='POST')
    try: response = build_opener(ProxyHandler({})).open(req, timeout=5)
    except HTTPError as error: response = error
    with response:
        assert response.status == expected, f'worker {path}: {response.status}, expected {expected}'
        return json.loads(response.read())


def pair_negatives(owner, origin, connect, public_key, used_code):
    payload = {'code': used_code, 'name': 'Other computer', 'mode': 'demo', 'protocolVersion': '1',
               'proofPublicKey': public_key}
    worker_call(origin, '/api/worker/pair', payload, expected=409)
    expired = owner.post('/api/devices/pair', expected=201)
    with connect() as conn:
        conn.execute("UPDATE agentship_design.device_pairing SET expires_at=statement_timestamp()-interval '1 second' WHERE consumed_at IS NULL")
    worker_call(origin, '/api/worker/pair', {**payload, 'code': expired['code']}, expected=409)
    fresh = owner.post('/api/devices/pair', expected=201)
    worker_call(origin, '/api/worker/pair', {**payload, 'code': fresh['code'], 'proofPublicKey': 'not_valid'}, expected=400)
    worker_call(origin, '/api/worker/pair', {**payload, 'code': fresh['code'], 'protocolVersion': '2'}, expected=400)
    paired = worker_call(origin, '/api/worker/pair', {**payload, 'code': fresh['code']}, expected=201)
    before_poll = next(device for device in owner.get('/api/devices')['items'] if device['id'] == paired['deviceId'])
    assert before_poll['connectivity'] == 'offline' and 'lastSeenAt' not in before_poll
    poll = {'protocolVersion': '1', 'availableSlots': 0, 'active': [], 'codexStatus': 'not_required'}
    worker_call(origin, '/api/worker/poll', poll, expected=401)
    worker_call(origin, '/api/worker/poll', poll, token='invalid-token', expected=401)
    assert worker_call(origin, '/api/worker/poll', poll, paired['token'])['jobs'] == []
    after_poll = next(device for device in owner.get('/api/devices')['items'] if device['id'] == paired['deviceId'])
    assert after_poll['connectivity'] == 'online' and after_poll['lastSeenAt']
    worker_call(origin, '/api/worker/poll', {**poll, 'codexStatus': 'available'}, paired['token'], expected=400)
    # Active leases are now supported; an entry missing required identity is malformed.
    worker_call(origin, '/api/worker/poll', {**poll, 'active': [{}]}, paired['token'], expected=400)
    with connect() as conn:
        conn.execute('UPDATE agentship_design.device SET revoked_at=statement_timestamp() WHERE id=%s',(paired['deviceId'],))
    worker_call(origin, '/api/worker/poll', poll, paired['token'], expected=401)
    other_session = Browser(origin)
    other_session.login('device_owner')
    logged_out = other_session.post('/api/devices/pair', expected=201)
    other_session.post('/api/logout', expected=200)
    worker_call(origin, '/api/worker/pair', {**payload, 'code': logged_out['code']}, expected=401)
    print('PASS pair expiry/replay/session revocation, malformed key/protocol, bearer and revoked-device guards')


def verify_https_transport(java, jar, scratch):
    # No external endpoint or credentials are needed to verify TLS negotiation.
    with socket.socket() as listener:
        listener.bind(('127.0.0.1', 0))
        listener.listen()
        listener.settimeout(5)
        origin = f'https://127.0.0.1:{listener.getsockname()[1]}'
        command = [str(java), '-jar', str(jar), '--worker', '--platform', origin, '--pair-code', 'synthetic',
                   '--state-dir', str(scratch / 'tls-probe'), '--port', str(free_port())]
        with subprocess.Popen(command, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL) as process:
            try:
                conn, _ = listener.accept()
                with conn:
                    conn.settimeout(2)
                    first = conn.recv(5, socket.MSG_WAITALL)
                    assert first[:2] == b'\x16\x03', 'worker did not initiate a TLS handshake'
                listener.close()
                assert process.wait(timeout=5) == 1, 'worker accepted a peer without a valid TLS response'
            finally:
                if process.poll() is None: process.kill()
    assert not (scratch / 'tls-probe' / 'device-state.json').exists()
    print('PASS explicit HTTPS origin uses TLS and rejects an unauthenticated peer')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--java', type=Path, required=True)
    parser.add_argument('--jar', type=Path, default=JAR)
    args = parser.parse_args()
    sys.path.insert(0, str(WORKSPACE / 'pg-python'))
    import psycopg
    with tempfile.TemporaryDirectory(prefix='device-proof-', dir=WORKSPACE) as folder:
        scratch = Path(folder)
        verify_https_transport(args.java, args.jar, scratch)
        with postgres(WORKSPACE / 'tools' / 'pg17' / 'bin', scratch) as database_port:
            def connect(): return psycopg.connect(host='127.0.0.1', port=database_port, user='design_check', dbname='postgres')
            key, port, bridge_port = secrets.token_urlsafe(40), free_port(), free_port()
            with platform(args.java, args.jar, scratch, database_port, port, key, 'initial') as origin:
                owner, outsider = Browser(origin), Browser(origin)
                create_account(owner, account('device_owner', 811))
                create_account(outsider, account('device_outsider', 812))
                pairing = owner.post('/api/devices/pair', expected=201)
                assert pairing['code'] and pairing['expiresAt']
                with worker(args.java, args.jar, scratch, origin, bridge_port, pairing['code']) as status:
                    device_id = status['deviceId']
                    devices = owner.get('/api/devices')['items']
                    assert len(devices) == 1 and devices[0]['id'] == device_id
                    assert devices[0]['connectivity'] == 'online' and devices[0]['mode'] == 'demo'
                    assert outsider.get('/api/devices')['items'] == []
                    challenge = owner.post('/api/devices/challenge', expected=201)
                    proof = bridge(origin, bridge_port, '/proof', challenge)
                    assert set(proof) == {'deviceId', 'challengeId', 'signature'}
                    assert proof['deviceId'] == device_id and proof['challengeId'] == challenge['challengeId']
                    bridge(origin, bridge_port, '/proof', expected=204, method='OPTIONS', headers_extra={
                        'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type'})
                    bridge(origin, bridge_port, '/proof', expected=403, method='OPTIONS', headers_extra={
                        'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization'})
                    bridge(origin, bridge_port, '/status', expected=403, headers_extra={'Host': 'rebind.example.invalid'})
                    bridge('http://127.0.0.1:1', bridge_port, '/status', expected=403)
                    bridge('http://127.0.0.1:1', bridge_port, '/proof', challenge, expected=403)
                    with connect() as conn:
                        stored = conn.execute('SELECT consumed_at,code_digest FROM agentship_design.device_pairing').fetchone()
                        assert stored[0] is not None and pairing['code'].encode() != bytes(stored[1])
                        assert conn.execute('SELECT count(*) FROM agentship_design.device').fetchone()[0] == 1
                    assert (scratch / 'worker' / 'device-state.json').stat().st_mode & 0o777 == 0o600
                    duplicate = subprocess.run([str(args.java), '-jar', str(args.jar), '--worker', '--platform', origin,
                        '--state-dir', str(scratch / 'worker'), '--port', str(free_port())], capture_output=True, timeout=5)
                    assert duplicate.returncode == 1, 'same device state allowed two worker processes'
                    bridge(origin, bridge_port, '/proof', {**challenge, 'expiresAt': '2000-01-01T00:00:00Z'}, expected=400)
                    bridge(origin, bridge_port, '/proof', {**challenge, 'nonce': 'invalid!'}, expected=400)
                    bridge(origin, bridge_port, '/proof', {**challenge, 'nonce': 'a'*17000}, expected=413)
                    with connect() as conn:
                        public_key = base64.urlsafe_b64encode(bytes(conn.execute(
                            'SELECT proof_public_key FROM agentship_design.device WHERE id=%s',(device_id,)).fetchone()[0])).decode().rstrip('=')
                    pair_negatives(owner, origin, connect, public_key, pairing['code'])
                print('PASS Java worker pairing, local proof, strict origin, visibility and protected state')
                with worker(args.java, args.jar, scratch, origin, bridge_port) as restored:
                    assert restored['deviceId'] == device_id
                    assert len(owner.get('/api/devices')['items']) == 1
                print('PASS Java worker restart retains original device identity')
            with platform(args.java, args.jar, scratch, database_port, port, key, 'restart') as origin:
                restored = Browser(origin, owner.cookies)
                assert restored.get('/api/devices')['items'][0]['id'] == device_id
            print('PASS device pairing persists across platform restart')

if __name__ == '__main__': main()
