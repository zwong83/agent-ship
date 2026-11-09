"""Verify AgentShip design SQL against a fresh disposable localhost PostgreSQL."""

from argparse import ArgumentParser
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import time

parser = ArgumentParser(description=__doc__)
parser.add_argument('--pg-bin', type=Path, required=True, help='Directory with postgres, initdb and pg_ctl')
parser.add_argument('--psycopg-path', type=Path, help='Optional directory containing an existing psycopg installation')
args = parser.parse_args()
if args.psycopg_path:
    sys.path.insert(0, str(args.psycopg_path.resolve()))
import psycopg

project = Path(__file__).resolve().parents[3]
work = project / '.agentship' / 'verification'
work.mkdir(parents=True, exist_ok=True)
tools = args.pg_bin.resolve()
folder = Path(tempfile.mkdtemp(prefix='pg-v05-', dir=work))
data = folder / 'db'
sql_dir = Path(__file__).resolve().parent

def source(label):
    return (sql_dir / f'agentship-postgresql-{label}.sql').read_text()

def fixture_uuid(n):
    return f'00000000-0000-0000-0000-{n:012}'

def wait_for_backend_lock(observer, pid):
    deadline = time.monotonic() + 5
    while time.monotonic() < deadline:
        wait = observer.execute(
            'SELECT wait_event_type FROM pg_stat_activity WHERE pid = %s', (pid,)
        ).fetchone()
        if wait == ('Lock',):
            return
        time.sleep(0.02)
    raise AssertionError('authorization session did not wait on the run lock')

with socket.socket() as reserved_port:
    reserved_port.bind(('127.0.0.1', 0))
    port = reserved_port.getsockname()[1]
subprocess.run(
    [tools / 'initdb', '-D', data, '-A', 'trust', '--no-locale', '--encoding=UTF8', '-U', 'design_check'],
    check=True,
    capture_output=True,
)
subprocess.run(
    [tools / 'pg_ctl', '-D', data, '-l', folder / 'server.log',
     '-o', f'-h 127.0.0.1 -p {port} -c unix_socket_directories=', '-w', 'start'],
    check=True,
)
try:
    def connect():
        return psycopg.connect(
            host='127.0.0.1', port=port, user='design_check', dbname='postgres',
            autocommit=True, cursor_factory=psycopg.ClientCursor,
        )

    with connect() as holder, connect() as contender:
        holder.execute(source('ddl'))
        holder.execute(source('dml'))
        cursor = holder.execute(source('assertions'))
        results = []
        while True:
            if cursor.description:
                results.extend(cursor.fetchall())
            if cursor.nextset() is None:
                break
        assert ('AgentShip data assertions passed',) in results
        tables = holder.execute(
            "SELECT count(*) FROM information_schema.tables WHERE table_schema='agentship_design' AND table_type='BASE TABLE'"
        ).fetchone()[0]
        statements = holder.execute('SELECT count(*) FROM pg_prepared_statements').fetchone()[0]
        print(f'PostgreSQL {holder.info.server_version}: {tables} base tables, {statements} prepared statements; fixture assertions passed')
        fixture, marker, tail = source('assertions').partition('-- Begin single-connection assertions')
        assert marker and tail
        holder.execute(fixture + '\nCOMMIT;')
        contender.execute('SET statement_timeout = 5000')
        contender.execute("SET search_path TO agentship_design, pg_catalog")
        contender.execute(source('dml'))
        run_id = fixture_uuid(51)
        device_id = fixture_uuid(81)
        holder.execute('BEGIN')
        holder.execute('EXECUTE lock_run(%s)', (run_id,))
        cap = holder.execute('EXECUTE mark_repair_limit(%s,%s)', (run_id, fixture_uuid(36))).fetchall()
        assert len(cap) == 1
        # The run-locked claim is skipped rather than taking a stale route snapshot.
        assert contender.execute('EXECUTE claim_tasks(%s,10,30)', (device_id,)).fetchall() == []

        def attempt_external():
            with contender.transaction():
                contender.execute('EXECUTE lock_run_configuration(%s)', (run_id,))
                contender.execute('EXECUTE lock_run(%s)', (run_id,))
                return contender.execute(
                    "EXECUTE authorize_external_effect(%s,%s,%s,%s,900001,'push_code','fixture:branch',statement_timestamp()+interval '1 minute',NULL,NULL)",
                    (fixture_uuid(180), device_id, fixture_uuid(172), fixture_uuid(175)),
                ).fetchall()

        with ThreadPoolExecutor(max_workers=1) as pool:
            pending = pool.submit(attempt_external)
            wait_for_backend_lock(holder, contender.info.backend_pid)
            holder.execute('COMMIT')
            assert pending.result(timeout=5) == []

        claimed = contender.execute('EXECUTE claim_tasks(%s,10,30)', (device_id,)).fetchall()
        assert [str(row[1]) for row in claimed] == [fixture_uuid(174)]
        with contender.transaction():
            contender.execute('EXECUTE lock_run_configuration(%s)', (run_id,))
            contender.execute('EXECUTE lock_run(%s)', (run_id,))
            admitted = contender.execute(
                "EXECUTE authorize_external_effect(%s,%s,%s,%s,%s,'push_code','fixture:branch',statement_timestamp()+interval '1 minute',NULL,NULL)",
                (fixture_uuid(181), device_id, fixture_uuid(174), fixture_uuid(177), claimed[0][3]),
            ).fetchall()
            assert len(admitted) == 1
        print('Two connections: locked claim skipped, competing external grant waited then rejected; independent claim and grant accepted')
finally:
    subprocess.run([tools / 'pg_ctl', '-D', data, '-m', 'fast', '-w', 'stop'], check=True)
