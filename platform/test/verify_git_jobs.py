"""Bound Git leases, authorization journals and evidence through real HTTP/PostgreSQL."""
import argparse
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import secrets
import sys
import tempfile
from uuid import uuid4
from urllib.request import Request, build_opener, ProxyHandler
from urllib.error import HTTPError
from verify_first_batch import Browser, JAR, WORKSPACE, account, create_account, free_port, platform, postgres


def call(origin,token,path,body,expected=200,key=None):
    headers={'Origin':origin,'Content-Type':'application/json','Authorization':'Bearer '+token,'Idempotency-Key':key or str(uuid4())}
    request=Request(origin+path,headers=headers,data=json.dumps(body).encode(),method='POST')
    try: response=build_opener(ProxyHandler({})).open(request,timeout=8)
    except HTTPError as error: response=error
    with response:
        value=json.loads(response.read())
        assert response.status==expected, (path,response.status,value.get('error',{}).get('code'),expected)
        return value


def fixture(owner,connect,origin,mode='demo',shared=None):
    actor=owner.get('/api/me')['user']['id']; project=owner.get('/api/projects')['items'][0]['id']
    req=owner.post('/api/objects/requirements',{'name':'Git '+str(uuid4()),'data':{'projectId':project,'description':'Synthetic'}},201)
    flow=owner.post('/api/objects/flows',{'name':'End '+str(uuid4()),'data':{'stages':[{'id':str(uuid4()),'name':'End','nodes':[{'id':str(uuid4()),'name':'End','type':'end','dependencies':[]}]}]}},201)
    device,run,task,attempt=map(str,[uuid4(),uuid4(),uuid4(),uuid4()]); token=secrets.token_urlsafe(32)
    if shared: device,token=shared['device'],shared['token']
    with connect() as db:
        if not shared: db.execute("INSERT INTO agentship_design.device(id,account_id,display_name,mode,protocol_version,paired_origin,token_digest,proof_public_key,codex_status,last_seen_at) VALUES(%s,%s,'Fixture',%s,'1',%s,%s,%s,%s,statement_timestamp())",(device,actor,mode,origin,hashlib.sha256(token.encode()).digest(),b'fixture-public-key','not_required' if mode=='demo' else 'available'))
        db.execute("INSERT INTO agentship_design.run(id,project_id,requirement_id,workflow_id,workflow_version,initiator_id,device_id,mode,work_type,github_namespace,state,current_revision,state_version,reason_code) VALUES(%s,%s,%s,%s,1,%s,%s,%s,'feature','fixture','queued',1,1,'GIT_PREPARATION_PENDING')",(run,project,req['id'],flow['id'],actor,device,mode))
        db.execute("INSERT INTO agentship_design.run_requirement_revision(run_id,revision,requirement_version,title,description,recorded_by) VALUES(%s,1,1,'Git fixture','Synthetic',%s)",(run,actor))
        db.execute("INSERT INTO agentship_design.role_task(id,run_id,device_id,kind,requirement_revision,current_attempt) VALUES(%s,%s,%s,'git',1,1)",(task,run,device))
        db.execute("INSERT INTO agentship_design.task_attempt(task_id,attempt_number,attempt_id,device_id,state,available_at) VALUES(%s,1,%s,%s,'queued',statement_timestamp())",(task,attempt,device))
        repo='fixture/agentship-'+req['id']
        for effect,target in [('create_repository',repo),('create_base_branch',repo+'#refs/heads/dev'),('create_work_branch',repo+'#refs/heads/feature/'+run)]:
            db.execute("INSERT INTO agentship_design.run_external_grant(run_id,effect,target_key,approved_by,policy_ref,approved_at,expires_at) VALUES(%s,%s,%s,%s,'run-start-git-v1',statement_timestamp(),statement_timestamp()+interval '24 hours')",(run,effect,target,actor))
    return {'actor':actor,'requirement':req['id'],'device':device,'run':run,'task':task,'attempt':attempt,'token':token,'mode':mode}


def main():
    parser=argparse.ArgumentParser(); parser.add_argument('--java',type=Path,required=True); parser.add_argument('--jar',type=Path,default=JAR); args=parser.parse_args()
    sys.path.insert(0,str(WORKSPACE/'pg-python')); import psycopg
    with tempfile.TemporaryDirectory(prefix='git-jobs-',dir=WORKSPACE) as folder:
        scratch=Path(folder)
        with postgres(WORKSPACE/'tools'/'pg17'/'bin',scratch) as dbport:
            def connect(): return psycopg.connect(host='127.0.0.1',port=dbport,user='design_check',dbname='postgres')
            with platform(args.java,args.jar,scratch,dbport,free_port(),secrets.token_urlsafe(40),'initial') as origin:
                owner=Browser(origin); create_account(owner,account('git_owner',861))
                data=fixture(owner,connect,origin)
                poll=call(origin,data['token'],'/api/worker/poll',{'protocolVersion':'1','availableSlots':1,'active':[],'codexStatus':'not_required'})
                assert len(poll['jobs'])==1, 'queued Git task was not claimed'
                verify(owner,connect,origin,data,poll['jobs'][0])



def poll(origin,data,slots=1,active=None):
    return call(origin,data['token'],'/api/worker/poll',{'protocolVersion':'1','availableSlots':slots,'active':active or [],'codexStatus':'not_required' if data['mode']=='demo' else 'available'})


class Driver:
    def __init__(self,origin,data,job): self.origin,self.data,self.job,self.sequence=origin,data,job,0
    def authorize(self,operation,expected=200,key=None,**overrides):
        body={k:self.job[k] for k in ['taskId','attemptId','epoch']}
        body.update({k:operation[k] for k in ['operationKey','effect','targetId']}); body.update(overrides)
        return call(self.origin,self.data['token'],'/api/worker/jobs/'+self.job['taskId']+'/authorize-external',body,expected,key)
    def event(self,kind,result,expected=200,key=None,sequence=None,epoch=None):
        body={'type':kind,'attemptId':self.job['attemptId'],'epoch':epoch or self.job['epoch'],
              'sequence':sequence if sequence is not None else self.sequence+1,'result':result}
        value=call(self.origin,self.data['token'],'/api/worker/jobs/'+self.job['taskId']+'/event',body,expected,key)
        if expected==200 and not value.get('duplicate'): self.sequence+=1
        return value
    def evidence(self,operation,outcome='confirmed_success'):
        repo={'provider':'demo' if self.data['mode']=='demo' else 'github',
              'repositoryId':'demo-'+self.data['requirement'] if self.data['mode']=='demo' else str(int(self.data['requirement'].replace('-','')[:12],16)),
              'displayName':self.job['input']['gitPlan']['repositoryName'],'defaultBranch':'main'}
        evidence={'operationKey':operation['operationKey'],'kind':'repository' if operation['effect']=='create_repository' else 'branch',
                  'outcome':outcome,'observedAt':datetime.now(timezone.utc).isoformat(),'targetId':operation['targetId']}
        if outcome=='confirmed_success':
            evidence.update({'providerResultId':repo['repositoryId'],'repository':repo})
            if operation['effect']!='create_repository':
                evidence['providerResultId']='a'*40
                evidence['git']={'repository':deepcopy(repo),'baseBranch':'main' if operation['effect']=='create_base_branch' or self.job['input']['workType']=='hotfix' else 'dev',
                    'workBranch':operation['targetId'].split('#refs/heads/')[1],'baseCommit':'a'*40,'headCommit':'a'*40}
        return evidence
    def success(self):
        final=None
        for operation in self.job['input']['gitOperations']:
            self.authorize(operation)
            final=self.evidence(operation)
            self.event('progress',{'external':final})
        self.event('complete',{'artifacts':[],'external':final})


def verify(owner,connect,origin,data,job):
    driver=Driver(origin,data,job)
    assert job['taskId']==data['task'] and job['kind']=='git'
    lease={key:job[key] for key in ['taskId','attemptId','epoch']}
    assert poll(origin,data,0,[lease])['renewed'][0]['taskId']==data['task']
    call(origin,data['token'],'/api/worker/poll',{'protocolVersion':'1','availableSlots':5,'active':[],'codexStatus':'not_required'},400)
    driver.event('progress',{},409,sequence=2)
    driver.event('progress',{},409,epoch=job['epoch']+1)
    operations=job['input']['gitOperations']; repo,base,work=operations
    driver.authorize(repo,403,targetId='attacker/other')
    auth_key=str(uuid4())
    assert driver.authorize(repo,key=auth_key)['decision']=='dispatch'
    assert driver.authorize(repo,key=auth_key)['decision']=='reconcile'
    driver.authorize(repo,409,key=auth_key,targetId='attacker/other')
    original=driver.evidence(repo); event_key=str(uuid4())
    ack=driver.event('progress',{'external':original},key=event_key)
    duplicate=driver.event('progress',{'external':original},key=event_key,sequence=1)
    assert duplicate['duplicate'] and duplicate['receiptId']==ack['receiptId']
    driver.event('progress',{'workspaceRevision':'changed'},409,key=event_key,sequence=1)
    driver.authorize(base)
    invalid=driver.evidence(base); invalid['repository']['repositoryId']='wrong-id'; invalid['git']['repository']=deepcopy(invalid['repository'])
    driver.event('progress',{'external':invalid},409)
    invalid=driver.evidence(base); invalid['git']['headCommit']='b'*40
    driver.event('progress',{'external':invalid},409)
    invalid=driver.evidence(base); invalid['providerResultId']='b'*40
    driver.event('progress',{'external':invalid},409)
    driver.event('progress',{'external':driver.evidence(base)})
    driver.authorize(work)
    final=driver.evidence(work)
    driver.event('progress',{'external':final})
    altered=deepcopy(final); altered['git']['baseCommit']='b'*40; altered['git']['headCommit']='b'*40; altered['providerResultId']='b'*40
    driver.event('complete',{'artifacts':[],'external':altered},409)
    final_key=str(uuid4())
    driver.event('complete',{'artifacts':[],'external':final},key=final_key)
    assert driver.event('complete',{'artifacts':[],'external':final},key=final_key,sequence=4)['duplicate']
    driver.event('progress',{},409)
    detail=owner.get('/api/runs/'+data['run'])
    assert detail['state']=='waiting' and detail['blockerCode']=='AGENT_EXECUTION_PENDING'
    assert detail['gitPreparation']['state']=='ready' and all(x['state']=='succeeded' for x in detail['gitPreparation']['steps'])
    assert detail['git']['repository']['provider']=='demo' and detail['git']['repository']['defaultBranch']=='main'
    assert detail['git']['workBranch']=='feature/'+data['run'] and detail['gitPlan']['defaultBranch']=='main'
    with connect() as db:
        assert db.execute('SELECT repository_id FROM agentship_design.requirement WHERE id=%s',(data['requirement'],)).fetchone()[0] is None
        assert db.execute('SELECT count(*) FROM agentship_design.operation_evidence').fetchone()[0]==3
    print('PASS lease renewal/fencing, exact-scope write journal, event dedup/order, immutable repository/commit evidence and demo Git readiness')

    unknown=fixture(owner,connect,origin); unknown_job=poll(origin,unknown)['jobs'][0]; recovery=Driver(origin,unknown,unknown_job)
    operation=unknown_job['input']['gitOperations'][0]; recovery.authorize(operation)
    failed={'reasonCode':'GIT_OUTCOME_UNKNOWN','message':'Synthetic network loss','retryable':True,'external':recovery.evidence(operation,'unknown')}
    failure_key=str(uuid4()); recovery.event('failure',failed,key=failure_key)
    assert poll(origin,unknown)['jobs']==[]
    with connect() as db: db.execute("UPDATE agentship_design.task_attempt SET available_at=statement_timestamp()-interval '1 second' WHERE task_id=%s",(unknown['task'],))
    reclaimed=poll(origin,unknown)['jobs'][0]
    assert reclaimed['epoch']>unknown_job['epoch'] and reclaimed['attemptId']==unknown_job['attemptId']
    recovery.event('progress',{},409)
    assert recovery.event('failure',failed,key=failure_key,sequence=1)['duplicate']
    resumed=Driver(origin,unknown,reclaimed)
    assert resumed.authorize(operation)['decision']=='reconcile'
    resumed.success()
    assert owner.get('/api/runs/'+unknown['run'])['gitPreparation']['state']=='ready'
    print('PASS unknown operation delayed read-only reconciliation, new epoch and old identical receipt replay')

    failed_data=fixture(owner,connect,origin); failed_job=poll(origin,failed_data)['jobs'][0]; failed_driver=Driver(origin,failed_data,failed_job)
    operation=failed_job['input']['gitOperations'][0]; failed_driver.authorize(operation)
    failed_driver.event('failure',{'reasonCode':'GITHUB_ACCESS_DENIED','message':'Do not expose provider diagnostic','retryable':False,'external':failed_driver.evidence(operation,'confirmed_failure')})
    with connect() as db: db.execute("UPDATE agentship_design.task_attempt SET available_at=statement_timestamp()-interval '1 second' WHERE task_id=%s",(failed_data['task'],))
    assert poll(origin,failed_data)['jobs']==[]
    detail=owner.get('/api/runs/'+failed_data['run'])
    assert detail['state']=='needs_attention' and 'provider diagnostic' not in json.dumps(detail)
    assert detail['gitPreparation']['reasonCode']=='GIT_PERMISSION_DENIED'
    print('PASS confirmed failures stay in manual attention and provider diagnostics are not exposed')

    real=fixture(owner,connect,origin,'codex'); real_job=poll(origin,real)['jobs'][0]; real_driver=Driver(origin,real,real_job)
    real_driver.success()
    with connect() as db:
        saved=db.execute('SELECT r.repository_id,c.version FROM agentship_design.requirement r JOIN agentship_design.configuration c ON c.id=r.id WHERE r.id=%s',(real['requirement'],)).fetchone()
        assert saved[0] is not None and saved[1]==2
        assert db.execute('SELECT git_default_branch FROM agentship_design.run WHERE id=%s',(real['run'],)).fetchone()[0]=='main'
    print('PASS real-mode synthetic provider evidence links requirement once and freezes verified Git default branch')

    denied=fixture(owner,connect,origin); denied_job=poll(origin,denied)['jobs'][0]; denied_driver=Driver(origin,denied,denied_job)
    with connect() as db: db.execute('UPDATE agentship_design.run_external_grant SET revoked_at=statement_timestamp() WHERE run_id=%s',(denied['run'],))
    denied_driver.authorize(denied_job['input']['gitOperations'][0],403)
    other=fixture(owner,connect,origin)
    call(origin,other['token'],'/api/worker/jobs/'+denied['task']+'/event',{'type':'progress','attemptId':denied['attempt'],'epoch':denied_job['epoch'],'sequence':1,'result':{}},404)
    with connect() as db: db.execute('UPDATE agentship_design.device SET revoked_at=statement_timestamp() WHERE id=%s',(denied['device'],))
    call(origin,denied['token'],'/api/worker/poll',{'protocolVersion':'1','availableSlots':1,'active':[],'codexStatus':'not_required'},401)
    print('PASS grant revocation, cross-device task isolation and revoked device rejection')

    parallel_a=fixture(owner,connect,origin)
    parallel_b=fixture(owner,connect,origin,shared=parallel_a)
    with ThreadPoolExecutor(max_workers=2) as pool:
        responses=list(pool.map(lambda _:poll(origin,parallel_a),range(2)))
    jobs=[job for response in responses for job in response['jobs']]
    assert {job['taskId'] for job in jobs}=={parallel_a['task'],parallel_b['task']}
    expiry_job=next(job for job in jobs if job['taskId']==parallel_a['task'])
    expiry_driver=Driver(origin,parallel_a,expiry_job)
    expiry_driver.event('progress',{'workspaceRevision':'saved-checkpoint'})
    with connect() as db:
        db.execute("UPDATE agentship_design.task_attempt SET lease_deadline=statement_timestamp()-interval '1 second' WHERE task_id=%s",(parallel_a['task'],))
    reclaimed=poll(origin,parallel_a)['jobs'][0]
    assert reclaimed['epoch']>expiry_job['epoch'] and reclaimed['checkpoint']['workspaceRevision']=='saved-checkpoint'
    expiry_driver.event('progress',{},409)
    print('PASS parallel polls on one device avoid lock-upgrade deadlocks and expired leases preserve checkpoints')

    shared=fixture(owner,connect,origin)
    shared_copy=clone_run(connect,shared)
    shared_jobs=poll(origin,shared,2)['jobs']
    first=Driver(origin,shared,next(job for job in shared_jobs if job['taskId']==shared['task']))
    second=Driver(origin,shared_copy,next(job for job in shared_jobs if job['taskId']==shared_copy['task']))
    first_repo=first.job['input']['gitOperations'][0]; second_repo=second.job['input']['gitOperations'][0]
    assert first_repo['operationKey']==second_repo['operationKey']
    assert first.authorize(first_repo)['decision']=='dispatch'
    assert second.authorize(second_repo)['decision']=='reconcile'
    first.event('progress',{'external':first.evidence(first_repo)})
    assert second.authorize(second_repo)['decision']=='already_succeeded'
    second.success()
    mismatch=clone_run(connect,shared,namespace='different-owner')
    assert poll(origin,mismatch)['jobs']==[]
    detail=owner.get('/api/runs/'+mismatch['run'])
    assert detail['gitPreparation']['reasonCode']=='GIT_TARGET_CONFLICT'
    with connect() as db:
        assert db.execute("SELECT count(*) FROM agentship_design.external_operation WHERE requirement_id=%s AND effect='create_repository'",(shared['requirement'],)).fetchone()[0]==1
    print('PASS parallel runs share one repository intent and reject conflicting namespace instead of reusing wrong target')


def clone_run(connect,original,namespace='fixture'):
    result={**original,'run':str(uuid4()),'task':str(uuid4()),'attempt':str(uuid4())}
    with connect() as db:
        db.execute("""INSERT INTO agentship_design.run(id,project_id,requirement_id,workflow_id,workflow_version,initiator_id,device_id,mode,work_type,github_namespace,state,current_revision,state_version,reason_code)
            SELECT %s,project_id,requirement_id,workflow_id,workflow_version,initiator_id,device_id,mode,work_type,%s,'queued',1,1,'GIT_PREPARATION_PENDING' FROM agentship_design.run WHERE id=%s""",(result['run'],namespace,original['run']))
        db.execute("""INSERT INTO agentship_design.run_requirement_revision(run_id,revision,requirement_version,title,description,recorded_by)
            SELECT %s,1,requirement_version,title,description,recorded_by FROM agentship_design.run_requirement_revision WHERE run_id=%s AND revision=1""",(result['run'],original['run']))
        db.execute("INSERT INTO agentship_design.role_task(id,run_id,device_id,kind,requirement_revision,current_attempt) VALUES(%s,%s,%s,'git',1,1)",(result['task'],result['run'],result['device']))
        db.execute("INSERT INTO agentship_design.task_attempt(task_id,attempt_number,attempt_id,device_id,state,available_at) VALUES(%s,1,%s,%s,'queued',statement_timestamp())",(result['task'],result['attempt'],result['device']))
        repo=namespace+'/agentship-'+result['requirement']
        for effect,target in [('create_repository',repo),('create_base_branch',repo+'#refs/heads/dev'),('create_work_branch',repo+'#refs/heads/feature/'+result['run'])]:
            db.execute("INSERT INTO agentship_design.run_external_grant(run_id,effect,target_key,approved_by,policy_ref,approved_at,expires_at) VALUES(%s,%s,%s,%s,'run-start-git-v1',statement_timestamp(),statement_timestamp()+interval '24 hours')",(result['run'],effect,target,result['actor']))
    return result

if __name__=='__main__': main()
