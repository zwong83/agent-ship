"""Java Git worker boundary test: fake platform and GitHub HTTP, real local Git."""
import argparse, json, os, subprocess, tempfile, threading, time
from urllib.parse import unquote
from pathlib import Path
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from uuid import uuid4
from datetime import datetime, timedelta, timezone
from verify_first_batch import JAR, WORKSPACE, free_port


def deadline(): return (datetime.now(timezone.utc)+timedelta(seconds=60)).isoformat().replace('+00:00','Z')

class Platform:
    def __init__(self):
        self.job=None; self.sent=False; self.events=[]; self.auth=[]; self.device=str(uuid4()); self.failure=None; self.event_keys={}; self.drop_ack=False; self.event_requests=[]; self.expire_grant=False; self.force_reconcile=False; self.deny_authorization=False; self.operation_states={}
    def handler(self):
        outer=self
        class Handler(BaseHTTPRequestHandler):
            def log_message(self,*args): pass
            def do_POST(self):
                body=json.loads(self.rfile.read(int(self.headers.get('Content-Length',0))))
                if self.path=='/api/worker/pair': result={'deviceId':outer.device,'token':'synthetic-device-token','protocolVersion':'1'}
                elif self.path=='/api/worker/poll':
                    jobs=[]
                    if outer.job and not outer.sent and body['availableSlots']>0:
                        jobs=[{**outer.job,'deadlineAt':deadline()}]; outer.sent=True
                    result={'jobs':jobs,'renewed':[{**k,'deadlineAt':deadline()} for k in body['active']], 'inbox':[],'pollAfterMillis':100}
                elif self.path.endswith('/authorize-external'):
                    outer.auth.append(body)
                    if outer.deny_authorization and len(outer.auth)>1:
                        data=json.dumps({'error':{'code':'FORBIDDEN'}}).encode();self.send_response(403);self.send_header('Content-Length',str(len(data)));self.end_headers();self.wfile.write(data);return
                    state=outer.operation_states.get(body['operationKey'])
                    decision='reconcile' if outer.force_reconcile else 'already_succeeded' if state=='succeeded' else 'reconcile' if state=='dispatching' else 'dispatch'
                    if decision=='dispatch':outer.operation_states[body['operationKey']]='dispatching'
                    result={**body,'decision':decision,'expiresAt':'2000-01-01T00:00:00Z' if outer.expire_grant else deadline()}
                elif self.path.endswith('/event'):
                    key=self.headers.get('Idempotency-Key'); outer.event_requests.append((key,body))
                    if key not in outer.event_keys:
                        outer.event_keys[key]=body; outer.events.append(body)
                        external=body['result'].get('external')
                        if external and external['outcome']=='confirmed_success':outer.operation_states[external['operationKey']]='succeeded'
                    else: assert outer.event_keys[key]==body
                    if outer.drop_ack:
                        outer.drop_ack=False; self.close_connection=True; self.connection.close(); return
                    result={'accepted':True}
                else: self.send_error(404); return
                data=json.dumps(result).encode(); self.send_response(201 if self.path.endswith('/pair') else 200)
                self.send_header('Content-Type','application/json'); self.send_header('Content-Length',str(len(data))); self.end_headers(); self.wfile.write(data)
        return Handler
    def prepare(self):
        req,run,task,attempt=(str(uuid4()) for _ in range(4)); repo='fixture/agentship-'+req
        self.job={'taskId':task,'attemptId':attempt,'epoch':1,'kind':'git','runId':run,
           'input':{'requirementId':req,'requirementName':'Synthetic Git requirement','workType':'feature','githubNamespace':'fixture',
             'gitPlan':{'repositoryName':repo,'createRepository':True,'workBranch':'feature/'+run,'ensureDev':True},
             'gitOperations':[{'operationKey':'git:demo:requirement:'+req+':repository','effect':'create_repository','targetId':repo,'state':'planned'},
                {'operationKey':'git:demo:run:'+run+':base','effect':'create_base_branch','targetId':repo+'#refs/heads/dev','state':'planned'},
                {'operationKey':'git:demo:run:'+run+':work','effect':'create_work_branch','targetId':repo+'#refs/heads/feature/'+run,'state':'planned'}]}}
        return self.job



class GitHub:
    def __init__(self,job,scenario):
        self.job=job; self.scenario=scenario; self.posts=[]; self.refs={}; self.repo=None
        self.name=job['input']['gitPlan']['repositoryName']; self.req=job['input']['requirementId']; self.dropped=False
        if scenario in ('collision','hotfix','ref_conflict','linked_feature','refactor','fix'):
            self.repo=self.metadata(); self.refs['master' if scenario=='hotfix' else 'main']='1'*40
        if scenario in ('linked_feature','refactor','fix'):self.refs['dev']='3'*40
        if scenario=='collision': self.repo['description']='Unrelated repository'
        if scenario=='ref_conflict':
            self.refs['dev']='1'*40;self.refs[job['input']['gitPlan']['workBranch']]='2'*40
    def metadata(self):return {'id':12345,'full_name':self.name,'description':'AgentShip requirement '+self.req,'private':False,'default_branch':'master' if self.scenario=='hotfix' else 'main'}
    def handler(self):
        outer=self
        class Handler(BaseHTTPRequestHandler):
            def log_message(self,*args):pass
            def respond(self,status,data):
                raw=json.dumps(data).encode();self.send_response(status);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(raw)));self.end_headers();self.wfile.write(raw)
            def do_GET(self):
                path=unquote(self.path)
                if path=='/user':return self.respond(200,{'login':'fixture'})
                if path.startswith('/users/'):return self.respond(200,{'type':'Organization'})
                if '/git/ref/heads/' in path:
                    if outer.scenario=='ref_denied':return self.respond(403,{})
                    branch=path.split('/git/ref/heads/')[1]
                    if branch not in outer.refs:return self.respond(404,{})
                    return self.respond(200,{'ref':'refs/heads/'+branch,'object':{'type':'commit','sha':outer.refs[branch]}})
                if path=='/repos/'+outer.name and outer.scenario=='post_write_read_denied' and outer.repo:return self.respond(403,{})
                if path=='/repos/'+outer.name and outer.scenario=='stalled_body':
                    self.send_response(200);self.send_header('Content-Length','100');self.end_headers();self.wfile.flush();time.sleep(15);return
                if path=='/repos/'+outer.name:return self.respond(200,outer.repo) if outer.repo else self.respond(404,{})
                self.respond(404,{})
            def do_POST(self):
                body=json.loads(self.rfile.read(int(self.headers['Content-Length'])));outer.posts.append((self.path,body))
                assert self.headers['Authorization']=='Bearer synthetic-github-token'
                assert self.headers['X-GitHub-Api-Version']=='2022-11-28'
                if outer.scenario=='denied':return self.respond(403,{})
                if self.path.endswith('/repos'):
                    assert body['private'] is False and body['auto_init'] is True
                    if outer.scenario!='unknown':outer.repo=outer.metadata();outer.refs['main']='1'*40
                elif self.path.endswith('/git/refs'):
                    outer.refs[body['ref'].removeprefix('refs/heads/')]=body['sha']
                else:return self.respond(404,{})
                if outer.scenario=='restart' and not outer.dropped:
                    outer.dropped=True;time.sleep(3);self.close_connection=True;self.connection.close();return
                if outer.scenario in ('lost_response','unknown') and not outer.dropped:
                    outer.dropped=True;self.close_connection=True;self.connection.close();return
                self.respond(201,outer.repo or {})
        return Handler


def github_case(args,folder,scenario):
    scratch=Path(folder)/scenario;scratch.mkdir();platform=Platform();job=platform.prepare();platform.drop_ack=scenario=='lost_response'
    if scenario=='organization':
        old=job['input']['gitPlan']['repositoryName'];new=old.replace('fixture/','fixture-org/');job['input']['gitPlan']['repositoryName']=new;job['input']['githubNamespace']='fixture-org'
        for operation in job['input']['gitOperations']:operation['targetId']=operation['targetId'].replace(old,new)
    if scenario in ('hotfix','ref_conflict','linked_feature','refactor','fix'):
        plan=job['input']['gitPlan'];plan['createRepository']=False
        job['input']['repository']={'provider':'github','repositoryId':'12345','displayName':plan['repositoryName']}
        job['input']['gitOperations']=job['input']['gitOperations'][1:]
        if scenario in ('linked_feature','refactor','fix'):
            kind='feature' if scenario=='linked_feature' else scenario;plan['workBranch']=kind+'/'+job['runId'];job['input']['workType']=kind
            job['input']['gitOperations'][-1]['targetId']=plan['repositoryName']+'#refs/heads/'+plan['workBranch']
        if scenario=='hotfix':
            plan['ensureDev']=False;plan['workBranch']='hotfix/'+job['runId'];job['input']['workType']='hotfix'
            job['input']['gitOperations']=job['input']['gitOperations'][-1:]
            job['input']['gitOperations'][0]['targetId']=plan['repositoryName']+'#refs/heads/'+plan['workBranch']
    if scenario=='authorization_revoked':platform.deny_authorization=True
    if scenario=='expired_grant':platform.expire_grant=True
    if scenario=='reconcile_only':platform.force_reconcile=True
    github=GitHub(job,scenario)
    servers=[ThreadingHTTPServer(('127.0.0.1',0),handler) for handler in (platform.handler(),github.handler())]
    for server in servers:threading.Thread(target=server.serve_forever,daemon=True).start()
    origin=f'http://127.0.0.1:{servers[0].server_port}'
    command=[str(args.java),'-Dagentship.test.allow-fake-github=true',f'-Dagentship.test.github-api=http://127.0.0.1:{servers[1].server_port}',
        '-jar',str(args.jar),'--worker','--platform',origin,'--state-dir',str(scratch/'worker'),
        '--pair-code','synthetic-code','--port',str(free_port()),'--execute-git','--mode','codex','--git-provider','github']
    with (scratch/'worker.log').open('wb') as log:
        process=subprocess.Popen(command,stdout=log,stderr=subprocess.STDOUT,env={**os.environ,'AGENTSHIP_GITHUB_TOKEN':'synthetic-github-token'})
        try:
            if scenario=='restart':
                until=time.monotonic()+15
                while not github.repo and time.monotonic()<until:time.sleep(.05)
                assert github.repo, 'restart fixture did not reach repository mutation'
                process.terminate();process.wait(timeout=5)
                job['epoch']=2;job['input']['gitOperations'][0]['state']='dispatching';platform.sent=False
                restart=command.copy();index=restart.index('--pair-code');del restart[index:index+2]
                process=subprocess.Popen(restart,stdout=log,stderr=subprocess.STDOUT,env={**os.environ,'AGENTSHIP_GITHUB_TOKEN':'synthetic-github-token'})
            end=time.monotonic()+35
            while time.monotonic()<end and process.poll() is None:
                if any(e['type'] in ('complete','failure') for e in platform.events):break
                time.sleep(.1)
            assert process.poll() is None, 'GitHub worker exited'
            final=platform.events[-1] if platform.events else None
            assert final, 'GitHub worker produced no terminal event'
            if scenario in ('lost_response','hotfix','organization','linked_feature','refactor','fix','restart'):
                assert final['type']=='complete',final
                assert len(github.posts)==(1 if scenario in ('hotfix','linked_feature','refactor','fix') else 3),github.posts
                if scenario=='hotfix':assert final['result']['external']['git']['baseBranch']=='master'
                elif scenario=='restart':assert all(event['epoch']==2 for event in platform.events)
                elif scenario=='organization':assert github.posts[0][0]=='/orgs/fixture-org/repos'
                elif scenario in ('linked_feature','refactor','fix'):
                    assert final['result']['external']['git']['baseCommit']=='3'*40
                    assert final['result']['external']['git']['baseBranch']=='dev'
                else:
                    assert len(platform.event_requests)>len(platform.events),'lost event ACK did not retry'
                    assert len({key for key,body in platform.event_requests})==len(platform.events)
            else:
                assert final['type']=='failure',final
                expected={'collision':'REPOSITORY_CONFLICT','denied':'GITHUB_ACCESS_DENIED','unknown':'GIT_RESULT_UNKNOWN',
                    'stalled_body':'GITHUB_RESULT_UNKNOWN','post_write_read_denied':'GIT_RESULT_UNKNOWN','authorization_revoked':'GIT_AUTHORIZATION_REJECTED','ref_denied':'GITHUB_ACCESS_DENIED','ref_conflict':'BRANCH_CONFLICT','expired_grant':'EXTERNAL_AUTHORIZATION_EXPIRED','reconcile_only':'GIT_RESULT_UNKNOWN'}[scenario]
                assert final['result']['reasonCode']==expected,final
                assert len(github.posts)==(1 if scenario in ('denied','unknown','ref_denied','authorization_revoked','post_write_read_denied') else 0),github.posts
                if scenario in ('ref_denied','authorization_revoked'):assert 'external' not in final['result'],final
                if scenario=='post_write_read_denied':assert final['result']['external']['outcome']=='unknown' and final['result']['retryable'] is True
                if scenario=='denied':assert final['result']['retryable'] is False and final['result']['external']['outcome']=='confirmed_failure'
            assert [e['sequence'] for e in platform.events]==list(range(1,len(platform.events)+1))
            print('PASS fake GitHub '+scenario+' with exact writes, ordered evidence and safe retry boundary')
        finally:
            process.terminate();process.wait(timeout=5)
            for server in servers:server.shutdown();server.server_close()


def main():
    p=argparse.ArgumentParser(); p.add_argument('--java',type=Path,required=True); p.add_argument('--jar',type=Path,default=JAR);args=p.parse_args()
    with tempfile.TemporaryDirectory(prefix='git-worker-',dir=WORKSPACE) as folder:
        scratch=Path(folder); platform=Platform(); job=platform.prepare()
        server=ThreadingHTTPServer(('127.0.0.1',0),platform.handler()); threading.Thread(target=server.serve_forever,daemon=True).start()
        origin=f'http://127.0.0.1:{server.server_port}'
        command=[str(args.java),'-jar',str(args.jar),'--worker','--platform',origin,'--state-dir',str(scratch/'worker'),
                 '--pair-code','synthetic-code','--port',str(free_port()),'--execute-git']
        with (scratch/'worker.log').open('wb') as log:
            process=subprocess.Popen(command,stdout=log,stderr=subprocess.STDOUT)
            try:
                end=time.monotonic()+35
                while time.monotonic()<end and process.poll() is None:
                    if any(e['type'] in ('complete','failure') for e in platform.events):break
                    time.sleep(.1)
                assert process.poll() is None, 'worker exited before executing Git job'
                final=platform.events[-1] if platform.events else None
                assert final and final['type']=='complete', f'Git job did not complete: {final}'
                assert [e['sequence'] for e in platform.events]==list(range(1,len(platform.events)+1))
                assert len(platform.auth)==3
                git=final['result']['external']['git']; assert git['baseBranch']=='dev' and git['workBranch']==job['input']['gitPlan']['workBranch']
                assert git['repository']['provider']=='demo'
                repos=list((scratch/'worker'/'repositories').glob('*'))
                assert len(repos)==1
                refs=subprocess.check_output(['git','--git-dir',str(repos[0]),'for-each-ref','--format=%(refname)'],text=True)
                assert 'refs/heads/dev' in refs and 'refs/heads/'+git['workBranch'] in refs
                print('PASS real Java worker executes authorized local Git repository/dev/work refs with ordered evidence')
            finally:
                process.terminate(); process.wait(timeout=5);server.shutdown();server.server_close()
        for scenario in ('lost_response','collision','denied','unknown','hotfix','ref_conflict','expired_grant','reconcile_only','stalled_body','ref_denied','organization','linked_feature','refactor','fix','authorization_revoked','restart','post_write_read_denied'):
            github_case(args,folder,scenario)

if __name__=='__main__':main()
