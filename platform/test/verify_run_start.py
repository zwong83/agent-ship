"""Run startup snapshots and authorization through HTTP and isolated PostgreSQL."""
import argparse
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from uuid import uuid4
from pathlib import Path
import secrets
import sys
import tempfile
from verify_device import worker, bridge
from verify_flow_config import agent, graph
from verify_first_batch import Browser, JAR, WORKSPACE, account, create_account, free_port, platform, postgres


def verify(owner, outsider, connect, origin, bridge_port):
    project=owner.get('/api/projects')['items'][0]['id']
    roles=[agent(owner, 831+i) for i in range(3)]
    flow_data=graph(roles)
    flow=owner.post('/api/objects/flows', {'name':'Run flow', 'data':flow_data}, 201)
    req=owner.post('/api/objects/requirements', {'name':'Run requirement', 'data':{'projectId':project,'description':'Original requirement'}}, 201)
    def proof(browser=owner):
        return bridge(origin,bridge_port,'/proof',browser.post('/api/devices/challenge',expected=201))
    def command(requirement=req, workflow=flow, device_proof=None):
        return {'requirementId':requirement['id'],'requirementVersion':requirement['version'],
                'workflowId':workflow['id'],'workflowVersion':workflow['workflowVersion'],
                'workType':'feature','githubNamespace':'fixture-owner','deviceProof':device_proof or proof()}
    def count():
        with connect() as db: return db.execute('SELECT count(*) FROM agentship_design.run').fetchone()[0]
    body=command()
    # Stale requests roll back their receipt and leave the same proof usable.
    stale={**body,'requirementVersion':req['version']+1}
    assert owner.post('/api/runs',stale,409)['error']['code']=='VERSION_CONFLICT'
    assert count()==0
    with connect() as db:
        assert db.execute('SELECT consumed_at FROM agentship_design.device_challenge WHERE id=%s',(body['deviceProof']['challengeId'],)).fetchone()[0] is None
    key=str(uuid4())
    initial_body,initial_key=deepcopy(body),key
    started=owner.post('/api/runs',body,201,key=key)
    assert started['state']=='queued' and started['version']==1
    path='/api/runs/'+started['runId']
    detail=owner.get(path)
    assert detail['requirementName']=='Run requirement' and detail['sourceRequirementVersion']==req['version']
    assert detail['gitPlan']=={'provider':'github','repositoryName':'fixture-owner/agentship-'+req['id'],
        'createRepository':True,'defaultBranch':None,'baseSource':'dev','baseBranch':'dev','ensureDev':True,
        'workBranch':'feature/'+started['runId'],'visibility':'public'}
    assert 'git' not in detail and detail['blockerCode']=='GIT_PREPARATION_PENDING'
    assert detail['stages'][0]['nodes'][0]['selectedRoles'][0]['displayName']==roles[0]['name']
    for stage in detail['stages']:
        for node in stage['nodes']:
            assert node['state']=='blocked' and node['tasks']==[] and node['inputRequirementRevision'] is None
    assert owner.post('/api/runs',body,201,key=key)==started
    assert owner.post('/api/runs',{**body,'githubNamespace':'different'},409,key=key)['error']['code']=='IDEMPOTENCY_CONFLICT'
    owner.post('/api/runs',body,409)
    assert count()==1
    with connect() as db:
        assert db.execute("SELECT count(*) FROM agentship_design.role_task WHERE run_id=%s AND kind='git'",(started['runId'],)).fetchone()[0]==1
        assert db.execute('SELECT state FROM agentship_design.task_attempt').fetchone()[0]=='queued'
    outsider.get(path,404)
    assert outsider.get('/api/runs')['items']==[]
    outsider.post('/api/runs',body,404)
    print('PASS frozen queued startup, deterministic Git plan, stale rollback and idempotent proof replay')

    # Selected Agent name/version and requirement title remain frozen after configuration edits.
    owner.call('PATCH','/api/objects/agents/'+roles[0]['id'],expected=200,body={
        'name':'Renamed coordinator','expectedVersion':roles[0]['version'],'data':roles[0]['data']})
    req=owner.call('PATCH','/api/objects/requirements/'+req['id'],expected=200,body={
        'name':'Changed requirement','expectedVersion':req['version'],'data':{'projectId':project,'description':'Changed'}})[2]
    edited=deepcopy(flow_data); edited['stages'][0]['name']='Renamed stage'
    flow=owner.call('PATCH','/api/objects/flows/'+flow['id'],expected=200,body={
        'name':'Changed flow','expectedVersion':flow['version'],'data':edited})[2]
    after=owner.get(path)
    assert after['stages']==detail['stages'] and after['requirementName']==detail['requirementName']
    owner.post('/api/runs',{**command(req,flow),'workflowVersion':1},409)
    owner.post('/api/runs',{**command(req,flow),'workType':'fix'},400)
    owner.post('/api/runs',{k:v for k,v in command(req,flow).items() if k!='githubNamespace'},400)

    # Description can only be deferred by a requirement-purpose node.
    blank=owner.post('/api/objects/requirements',{'name':'Deferred requirement','data':{'projectId':project,'description':None}},201)
    owner.post('/api/runs',command(blank,flow),400)
    deferred=deepcopy(edited); deferred['stages'][0]['nodes'][0]['purpose']='requirement'
    deferred_flow=owner.post('/api/objects/flows',{'name':'Requirement-first','data':deferred},201)
    owner.post('/api/runs',command(blank,deferred_flow),201)

    # Existing repository drives all four branch plans, without an input namespace.
    with connect() as db:
        repo=str(uuid4())
        db.execute("INSERT INTO agentship_design.repository(id,provider,provider_repository_id,display_name) VALUES(%s,'github','fixture-repo','fixture/linked')",(repo,))
        db.execute('UPDATE agentship_design.requirement SET repository_id=%s WHERE id=%s',(repo,req['id']))
    owner.post('/api/runs',command(req,flow),400)
    for kind in ['feature','refactor','hotfix','fix']:
        linked=command(req,flow); del linked['githubNamespace']; linked['workType']=kind
        receipt=owner.post('/api/runs',linked,201)
        plan=owner.get('/api/runs/'+receipt['runId'])['gitPlan']
        assert not plan['createRepository'] and plan['repositoryName']=='fixture/linked'
        assert plan['ensureDev']==(kind!='hotfix') and plan['baseBranch']==(None if kind=='hotfix' else 'dev')
    assert owner.get(path)['gitPlan']['createRepository'], 'later repository link changed the saved run plan'
    print('PASS frozen roles/requirement/workflow, current versions, deferred descriptions and all four linked Git plans')

    # Both same-key and different-key proof races must create exactly one run.
    def linked_command():
        value=command(req,flow); del value['githubNamespace']; return value
    body=linked_command(); race_key=str(uuid4()); before=count()
    with ThreadPoolExecutor(max_workers=2) as pool:
        values=list(pool.map(lambda _:owner.post('/api/runs',body,201,key=race_key),range(2)))
    assert values[0]==values[1] and count()==before+1
    body=linked_command(); before=count()
    with ThreadPoolExecutor(max_workers=2) as pool:
        values=list(pool.map(lambda _:owner.call('POST','/api/runs',expected=(201,409),body=body),range(2)))
    assert sorted(v[0] for v in values)==[201,409] and count()==before+1
    bad=linked_command(); bad['deviceProof']['signature']='A'+bad['deviceProof']['signature'][1:]
    # Ensure the modified signature really changes even if its original first character was A.
    bad['deviceProof']['signature']=bad['deviceProof']['signature'][:-1]+'!'
    owner.post('/api/runs',bad,409)
    foreign=linked_command(); foreign['deviceProof']=proof(outsider)
    owner.post('/api/runs',foreign,409)
    other_session=Browser(origin); other_session.login('run_owner')
    wrong_session=linked_command(); wrong_session['deviceProof']=proof(other_session)
    owner.post('/api/runs',wrong_session,409)
    expired=linked_command()
    with connect() as db:
        db.execute("UPDATE agentship_design.device_challenge SET expires_at=statement_timestamp()-interval '1 second' WHERE id=%s",(expired['deviceProof']['challengeId'],))
    owner.post('/api/runs',expired,409)
    print('PASS concurrent same-key/different-key proof consumption, forged/foreign-session/expired proof rejection')

    # Force persistence failure after consumeProof to prove the surrounding transaction restores the proof and receipt.
    rollback=linked_command(); rollback_key=str(uuid4()); before=count()
    with connect() as db:
        db.execute("CREATE FUNCTION agentship_design.reject_fixture_run() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Synthetic persistence failure'; END $$")
        db.execute('CREATE TRIGGER reject_fixture_run BEFORE INSERT ON agentship_design.run FOR EACH ROW EXECUTE FUNCTION agentship_design.reject_fixture_run()')
    try:
        owner.post('/api/runs',rollback,500,key=rollback_key)
        assert count()==before
        with connect() as db:
            assert db.execute('SELECT consumed_at FROM agentship_design.device_challenge WHERE id=%s',(rollback['deviceProof']['challengeId'],)).fetchone()[0] is None
            assert db.execute('SELECT count(*) FROM agentship_design.command_receipt WHERE request_key=%s',(rollback_key,)).fetchone()[0]==0
    finally:
        with connect() as db:
            db.execute('DROP TRIGGER reject_fixture_run ON agentship_design.run')
            db.execute('DROP FUNCTION agentship_design.reject_fixture_run()')
    owner.post('/api/runs',rollback,201,key=rollback_key)
    print('PASS post-proof persistence failure rolls back proof, receipt and complete run atomically')

    # Current requirement deputies can view, never start; revoked Agent use prevents new starts atomically.
    req_path='/api/objects/requirements/'+req['id']
    owner.post(req_path+'/ownership',{'action':'add_deputy','username':'run_outsider','expectedVersion':req['version']})
    req=owner.get(req_path)
    outsider.get(path)
    outsider.post('/api/runs',linked_command(),403)
    owner.get('/api/runs?q=%00',400)
    page=owner.get('/api/runs?pageSize=2'); assert len(page['items'])==2 and page['nextCursor']
    next_page=owner.get('/api/runs?pageSize=2&cursor='+page['nextCursor'])
    assert not ({item['id'] for item in page['items']} & {item['id'] for item in next_page['items']})
    outsider.get('/api/runs?pageSize=2&cursor='+page['nextCursor'],410)
    owner.get('/api/runs?q=changed&cursor='+page['nextCursor'],410)
    agent_path='/api/objects/agents/'+roles[1]['id']
    current=owner.get(agent_path)
    owner.post(agent_path+'/ownership',{'action':'transfer','username':'run_outsider','expectedVersion':current['version']})
    rejected=linked_command(); before=count()
    assert owner.post('/api/runs',rejected,403)['error']['code']=='AGENT_UNAVAILABLE'
    assert count()==before
    with connect() as db:
        assert db.execute('SELECT consumed_at FROM agentship_design.device_challenge WHERE id=%s',(rejected['deviceProof']['challengeId'],)).fetchone()[0] is None
    # The original immutable receipt still replays while the requirement start grant remains current.
    assert owner.post('/api/runs',initial_body,201,key=initial_key)==started
    outsider_info=outsider.get('/api/me')['user']
    owner.post(req_path+'/ownership',{'action':'remove_deputy','userId':outsider_info['id'],'expectedVersion':req['version']})
    outsider.get(path,404)
    req=owner.get(req_path)
    owner.post(req_path+'/ownership',{'action':'transfer','username':'run_outsider','expectedVersion':req['version']})
    owner.post('/api/runs',initial_body,404,key=initial_key)
    current=outsider.get(req_path)
    outsider.post(req_path+'/ownership',{'action':'transfer','username':'run_owner','expectedVersion':current['version']})
    print('PASS requirement visibility, deputy start denial, bound pagination and selected Agent revocation rollback')
    return path,owner.get(path)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--java', type=Path, required=True)
    parser.add_argument('--jar', type=Path, default=JAR)
    args = parser.parse_args()
    sys.path.insert(0, str(WORKSPACE / 'pg-python'))
    import psycopg
    with tempfile.TemporaryDirectory(prefix='run-start-', dir=WORKSPACE) as folder:
        scratch = Path(folder)
        with postgres(WORKSPACE / 'tools' / 'pg17' / 'bin', scratch) as database_port:
            def connect(): return psycopg.connect(host='127.0.0.1', port=database_port, user='design_check', dbname='postgres')
            key, port = secrets.token_urlsafe(40), free_port()
            with platform(args.java, args.jar, scratch, database_port, port, key, 'initial') as origin:
                owner, outsider = Browser(origin), Browser(origin)
                create_account(owner, account('run_owner', 831))
                create_account(outsider, account('run_outsider', 832))
                assert owner.get('/api/runs') == {'items': [], 'nextCursor': None}
                print('PASS empty authorized run list')
                pairing=owner.post('/api/devices/pair',expected=201)
                bridge_port=free_port()
                with worker(args.java,args.jar,scratch,origin,bridge_port,pairing['code']):
                    path,saved=verify(owner,outsider,connect,origin,bridge_port)
            with platform(args.java,args.jar,scratch,database_port,port,key,'restart') as origin:
                restored=Browser(origin,owner.cookies)
                detail=restored.get(path)
                for field in ['stages','gitPlan','requirementName','sourceRequirementVersion']:
                    assert detail[field]==saved[field]
                print('PASS run snapshots persist across platform restart')

if __name__ == '__main__': main()
