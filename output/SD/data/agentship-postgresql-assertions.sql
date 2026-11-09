-- Synthetic, disposable test data. Load DDL and DML in the same psql session first.
-- All fixture rows and temporary helper definitions roll back. Sequences can have gaps.
BEGIN;
SET LOCAL search_path TO agentship_design, pg_catalog;
CREATE FUNCTION pg_temp.test_id(n bigint) RETURNS uuid LANGUAGE sql IMMUTABLE AS $fn$
    SELECT ('00000000-0000-0000-0000-' || lpad(n::text,12,'0'))::uuid
$fn$;

INSERT INTO account (id,display_name,username,username_key,email,email_login_key,phone,password_hash,status,email_verified_at,phone_verified_at)
SELECT pg_temp.test_id(n),'Fixture ' || n,'fixture_' || n,'fixture_' || n,
       'fixture_' || n || '@example.invalid','fixture_' || n || '@example.invalid','+1202555010' || n,
       'synthetic-hash-not-an-account-credential','active',statement_timestamp(),statement_timestamp()
FROM generate_series(1,3) AS n;
INSERT INTO account_session (id,account_id,token_digest,expires_at)
SELECT pg_temp.test_id(10+n),pg_temp.test_id(n),decode(repeat(lpad(n::text,2,'0'),32),'hex'),
       statement_timestamp()+interval '1 hour'
FROM generate_series(1,3) AS n;
DO $test$
BEGIN
    BEGIN
        INSERT INTO account (id,display_name,username,username_key,email,email_login_key,phone,password_hash,status)
        VALUES (pg_temp.test_id(4),'Fixture duplicate','FIXTURE_1','fixture_1','case@example.invalid','case@example.invalid',
                '+12025550104','synthetic-hash-not-an-account-credential','pending');
        RAISE EXCEPTION 'case-insensitive username duplicate accepted';
    EXCEPTION WHEN unique_violation THEN NULL;
    END;
    BEGIN
        INSERT INTO account (id,display_name,username,username_key,email,email_login_key,phone,password_hash,status)
        VALUES (pg_temp.test_id(4),'Fixture oversized',repeat('a',101),repeat('a',101),'long@example.invalid','long@example.invalid',
                '+12025550104','synthetic-hash-not-an-account-credential','pending');
        RAISE EXCEPTION 'oversized username accepted';
    EXCEPTION WHEN check_violation THEN NULL;
    END;
END
$test$;
INSERT INTO project (id,name) VALUES (pg_temp.test_id(21),'Fixture project');
INSERT INTO project_permission (project_id,account_id,capability,granted_by)
VALUES (pg_temp.test_id(21),pg_temp.test_id(1),'create_requirement',pg_temp.test_id(1));

EXECUTE create_requirement(pg_temp.test_id(21),pg_temp.test_id(1),pg_temp.test_id(11),
                           pg_temp.test_id(31),'Fixture requirement','fixture requirement','Scope');
EXECUTE lock_configuration(pg_temp.test_id(31));
EXECUTE change_deputy(pg_temp.test_id(31),pg_temp.test_id(1),pg_temp.test_id(11),1,
                      pg_temp.test_id(3),'add_deputy');
EXECUTE change_deputy(pg_temp.test_id(31),pg_temp.test_id(1),pg_temp.test_id(11),2,
                      pg_temp.test_id(3),'remove_deputy');
EXECUTE update_requirement(pg_temp.test_id(31),pg_temp.test_id(3),pg_temp.test_id(13),3,
                           'Forbidden rewrite','forbidden rewrite','Must not persist');

INSERT INTO configuration (id,kind,owner_id,version)
VALUES (pg_temp.test_id(32),'workflow',pg_temp.test_id(1),1);
INSERT INTO workflow (id,name) VALUES (pg_temp.test_id(32),'Fixture workflow');
INSERT INTO agent_definition (id,role_key,source) VALUES (pg_temp.test_id(41),'fixture:coordinator','builtin');
INSERT INTO agent_version (agent_id,version,display_name,instruction)
VALUES (pg_temp.test_id(41),1,'Fixture coordinator','Synthetic instructions');
INSERT INTO workflow_version (workflow_id,version,saved_by,schema_version)
VALUES (pg_temp.test_id(32),1,pg_temp.test_id(1),1);
INSERT INTO workflow_stage (workflow_id,workflow_version,stage_id,name,ordinal)
VALUES (pg_temp.test_id(32),1,pg_temp.test_id(35),'Validation',1);
INSERT INTO workflow_node (workflow_id,workflow_version,node_id,stage_id,name,ordinal,kind,purpose)
SELECT pg_temp.test_id(32),1,pg_temp.test_id(id),pg_temp.test_id(35),kind || ' ' || id,ordinal,kind,purpose
FROM (VALUES (36,1,'check',NULL),(37,2,'work',NULL),(38,3,'work','repair'),(39,4,'publish',NULL),
             (155,5,'work','requirement'),(156,6,'work','other'),(157,7,'work','other'),(40,8,'end',NULL))
    n(id,ordinal,kind,purpose);
INSERT INTO workflow_role (workflow_id,workflow_version,node_id,node_kind,agent_id,agent_version,role,ordinal)
SELECT pg_temp.test_id(32),1,pg_temp.test_id(id),kind,pg_temp.test_id(41),1,'coordinator',1
FROM (VALUES (36,'check'),(38,'work'),(155,'work'),(156,'work'),(157,'work')) n(id,kind);
INSERT INTO workflow_dependency (workflow_id,workflow_version,node_id,prerequisite_node_id)
VALUES (pg_temp.test_id(32),1,pg_temp.test_id(156),pg_temp.test_id(38));
INSERT INTO workflow_check (workflow_id,workflow_version,check_node_id,pass_entry_node_id,repair_entry_node_id,automatic_repair_limit)
VALUES (pg_temp.test_id(32),1,pg_temp.test_id(36),pg_temp.test_id(37),pg_temp.test_id(38),1);
INSERT INTO workflow_route_node (workflow_id,workflow_version,check_node_id,node_id,outcome)
VALUES (pg_temp.test_id(32),1,pg_temp.test_id(36),pg_temp.test_id(37),'pass'),
       (pg_temp.test_id(32),1,pg_temp.test_id(36),pg_temp.test_id(38),'repair');
INSERT INTO workflow_publication (workflow_id,workflow_version,node_id,target_ref)
VALUES (pg_temp.test_id(32),1,pg_temp.test_id(39),'fixture:target');
EXECUTE seal_workflow_version(pg_temp.test_id(32),1);
INSERT INTO device (id,account_id,display_name,mode,protocol_version,paired_origin,token_digest,proof_public_key,codex_status,last_seen_at)
VALUES (pg_temp.test_id(81),pg_temp.test_id(1),'Fixture device','codex','1','http://127.0.0.1:4173',
        decode(repeat('ad',32),'hex'),decode('ff','hex'),'available',statement_timestamp());
INSERT INTO device_challenge (id,account_id,session_id,nonce,platform_origin,expires_at)
VALUES (pg_temp.test_id(91),pg_temp.test_id(1),pg_temp.test_id(11),decode(repeat('be',32),'hex'),
        'http://127.0.0.1:4173',statement_timestamp()+interval '5 minutes');

EXECUTE reserve_command_receipt('account',pg_temp.test_id(1),NULL,'start','fixture-start',decode(repeat('ca',32),'hex'));
EXECUTE lock_start_inputs(pg_temp.test_id(31),pg_temp.test_id(32));
EXECUTE lock_device_proof(pg_temp.test_id(91),pg_temp.test_id(1),pg_temp.test_id(11),pg_temp.test_id(81),'http://127.0.0.1:4173');
-- The fixture bypasses cryptographic verification only to exercise DB persistence.
EXECUTE start_run(pg_temp.test_id(52),pg_temp.test_id(1),pg_temp.test_id(11),pg_temp.test_id(31),3,
                  pg_temp.test_id(32),1,pg_temp.test_id(81),pg_temp.test_id(91),'feature',
                  statement_timestamp()-interval '1 minute',pg_temp.test_id(62),pg_temp.test_id(72),NULL);
EXECUTE start_run(pg_temp.test_id(51),pg_temp.test_id(1),pg_temp.test_id(11),pg_temp.test_id(31),3,
                  pg_temp.test_id(32),1,pg_temp.test_id(81),pg_temp.test_id(91),'feature',
                  statement_timestamp()-interval '1 minute',pg_temp.test_id(61),pg_temp.test_id(71),'fixture-namespace');
EXECUTE finish_command_receipt('account',pg_temp.test_id(1),'start','fixture-start','run',pg_temp.test_id(51));
EXECUTE reserve_command_receipt('account',pg_temp.test_id(1),NULL,'start','fixture-start',decode(repeat('ca',32),'hex'));
EXECUTE start_run(pg_temp.test_id(52),pg_temp.test_id(1),pg_temp.test_id(11),pg_temp.test_id(31),3,
                  pg_temp.test_id(32),1,pg_temp.test_id(81),pg_temp.test_id(91),'feature',
                  statement_timestamp()-interval '1 minute',pg_temp.test_id(62),pg_temp.test_id(72),'different-namespace');

DO $test$
BEGIN
    IF (SELECT name FROM requirement WHERE id=pg_temp.test_id(31)) <> 'Fixture requirement'
       OR (SELECT version FROM configuration WHERE id=pg_temp.test_id(31)) <> 3 THEN
        RAISE EXCEPTION 'revoked deputy changed configuration';
    END IF;
    IF (SELECT count(*) FROM run) <> 1 OR
       (SELECT github_namespace FROM run WHERE id=pg_temp.test_id(51)) IS DISTINCT FROM 'fixture-namespace' OR
       (SELECT count(*) FROM command_receipt WHERE accepted_at IS NOT NULL AND result_id=pg_temp.test_id(51)) <> 1 THEN
        RAISE EXCEPTION 'startup replay consumed a challenge twice or lost its receipt';
    END IF;
    BEGIN
        UPDATE run SET github_namespace='forbidden' WHERE id=pg_temp.test_id(51);
        RAISE EXCEPTION 'run GitHub namespace was mutable';
    EXCEPTION WHEN SQLSTATE '55000' THEN NULL;
    END;
    BEGIN
        UPDATE run_requirement_revision SET title='forbidden';
        RAISE EXCEPTION 'run snapshot was mutable';
    EXCEPTION WHEN SQLSTATE '55000' THEN NULL;
    END;
    BEGIN
        INSERT INTO workflow_stage (workflow_id,workflow_version,stage_id,name,ordinal)
        VALUES (pg_temp.test_id(32),1,pg_temp.test_id(111),'forbidden',2);
        RAISE EXCEPTION 'sealed workflow accepted a new child';
    EXCEPTION WHEN SQLSTATE '55000' THEN NULL;
    END;
END
$test$;

EXECUTE change_deputy(pg_temp.test_id(31),pg_temp.test_id(1),pg_temp.test_id(11),3,
                      pg_temp.test_id(3),'add_deputy');
INSERT INTO run_permission (run_id,account_id,capability,granted_by)
VALUES (pg_temp.test_id(51),pg_temp.test_id(3),'chat',pg_temp.test_id(1));
EXECUTE lock_run_configuration(pg_temp.test_id(51));
EXECUTE lock_run(pg_temp.test_id(51));
EXECUTE find_chat_guest(pg_temp.test_id(51),pg_temp.test_id(1),pg_temp.test_id(11),'FIXTURE_2');
EXECUTE change_run_chat_grant(pg_temp.test_id(51),pg_temp.test_id(1),pg_temp.test_id(11),pg_temp.test_id(2),'grant');
EXECUTE acquire_chat(pg_temp.test_id(51),pg_temp.test_id(3),pg_temp.test_id(13),pg_temp.test_id(103),15);
EXECUTE acquire_chat(pg_temp.test_id(51),pg_temp.test_id(1),pg_temp.test_id(11),pg_temp.test_id(101),15);
EXECUTE acquire_chat(pg_temp.test_id(51),pg_temp.test_id(2),pg_temp.test_id(12),pg_temp.test_id(102),15);
EXECUTE release_chat(pg_temp.test_id(51),pg_temp.test_id(1),pg_temp.test_id(11),pg_temp.test_id(104),1);
DO $test$
BEGIN
    IF NOT holds_active_chat(pg_temp.test_id(51),pg_temp.test_id(1),pg_temp.test_id(11),pg_temp.test_id(101),1)
       OR can_chat(pg_temp.test_id(51),pg_temp.test_id(3)) THEN
        RAISE EXCEPTION 'chat grant, second user, or second tab bypassed ownership';
    END IF;
END
$test$;
EXECUTE release_chat(pg_temp.test_id(51),pg_temp.test_id(1),pg_temp.test_id(11),pg_temp.test_id(101),1);
EXECUTE acquire_chat(pg_temp.test_id(51),pg_temp.test_id(2),pg_temp.test_id(12),pg_temp.test_id(102),15);
EXECUTE release_chat(pg_temp.test_id(51),pg_temp.test_id(1),pg_temp.test_id(11),pg_temp.test_id(101),1);
DO $test$
BEGIN
    IF NOT holds_active_chat(pg_temp.test_id(51),pg_temp.test_id(2),pg_temp.test_id(12),pg_temp.test_id(102),2) THEN
        RAISE EXCEPTION 'late release displaced the new lease';
    END IF;
END
$test$;

-- Independent queued work remains eligible while another attempt requires attention.
UPDATE run SET state='needs_attention' WHERE id=pg_temp.test_id(51);
EXECUTE claim_tasks(pg_temp.test_id(81),1,30);
DO $test$
DECLARE
    epoch bigint;
    new_epoch bigint;
    affected bigint;
BEGIN
    SELECT lease_epoch INTO STRICT epoch FROM task_attempt WHERE task_id=pg_temp.test_id(61);
    IF epoch IS NULL THEN RAISE EXCEPTION 'attention state stranded a queued task'; END IF;

    EXECUTE format('EXECUTE accept_task_event(pg_temp.test_id(81),pg_temp.test_id(61),pg_temp.test_id(71),%s,2,%L,pg_temp.test_id(114),%L,NULL,NULL,NULL)',
                   epoch,'progress','event-gap');
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 0 THEN RAISE EXCEPTION 'accepted event sequence gap'; END IF;

    UPDATE task_attempt SET lease_deadline=statement_timestamp()-interval '1 second'
    WHERE task_id=pg_temp.test_id(61);
    EXECUTE 'EXECUTE claim_tasks(pg_temp.test_id(81),1,30)';
    SELECT lease_epoch INTO STRICT new_epoch FROM task_attempt WHERE task_id=pg_temp.test_id(61);
    IF new_epoch <= epoch THEN RAISE EXCEPTION 'reclaimed task did not advance epoch'; END IF;
    EXECUTE format('EXECUTE accept_task_event(pg_temp.test_id(81),pg_temp.test_id(61),pg_temp.test_id(71),%s,1,%L,pg_temp.test_id(115),%L,NULL,NULL,NULL)',
                   epoch,'complete','stale-epoch');
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 0 THEN RAISE EXCEPTION 'old lease completion was accepted'; END IF;
    EXECUTE format('EXECUTE accept_task_event(pg_temp.test_id(81),pg_temp.test_id(61),pg_temp.test_id(71),%s,1,%L,pg_temp.test_id(116),%L,NULL,NULL,NULL)',
                   new_epoch,'complete','fresh-epoch');
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 1 THEN RAISE EXCEPTION 'current lease completion rejected'; END IF;
END
$test$;

-- Seed the scheduler result for check and publication node execution.
INSERT INTO node_execution (id,run_id,workflow_id,workflow_version,node_id,wave,requirement_revision,state,started_at)
VALUES (pg_temp.test_id(121),pg_temp.test_id(51),pg_temp.test_id(32),1,pg_temp.test_id(36),1,1,'running',statement_timestamp()),
       (pg_temp.test_id(122),pg_temp.test_id(51),pg_temp.test_id(32),1,pg_temp.test_id(39),1,1,'blocked',NULL);
INSERT INTO role_task (id,run_id,device_id,execution_id,workflow_id,workflow_version,node_id,
                       agent_id,agent_version,role,kind,requirement_revision,current_attempt)
VALUES (pg_temp.test_id(123),pg_temp.test_id(51),pg_temp.test_id(81),pg_temp.test_id(121),
        pg_temp.test_id(32),1,pg_temp.test_id(36),pg_temp.test_id(41),1,'coordinator','coordinator',1,1);
INSERT INTO task_attempt (task_id,attempt_number,attempt_id,device_id,state,available_at,session_ref)
VALUES (pg_temp.test_id(123),1,pg_temp.test_id(124),pg_temp.test_id(81),'queued',statement_timestamp(),'fixture-thread');
EXECUTE claim_tasks(pg_temp.test_id(81),1,30);
DO $test$
DECLARE
    epoch bigint;
    affected bigint;
BEGIN
    SELECT lease_epoch INTO STRICT epoch FROM task_attempt WHERE task_id=pg_temp.test_id(123);
    EXECUTE format('EXECUTE accept_task_event(pg_temp.test_id(81),pg_temp.test_id(123),pg_temp.test_id(124),%s,1,%L,pg_temp.test_id(125),%L,NULL,%L,NULL)',
                   epoch,'question','fixture-question','fixture-thread');
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 1 THEN RAISE EXCEPTION 'current question event was not recorded'; END IF;
END
$test$;
EXECUTE record_question(pg_temp.test_id(126),pg_temp.test_id(125),'Fixture question?');
UPDATE device SET last_seen_at=statement_timestamp()-interval '10 minutes' WHERE id=pg_temp.test_id(81);
EXECUTE resolve_question(pg_temp.test_id(51),pg_temp.test_id(126),pg_temp.test_id(2),pg_temp.test_id(12),
    pg_temp.test_id(102),2,'cancel',NULL,pg_temp.test_id(127));
EXECUTE resolve_question(pg_temp.test_id(51),pg_temp.test_id(126),pg_temp.test_id(2),pg_temp.test_id(12),
    pg_temp.test_id(102),2,'reply','Fixture answer',pg_temp.test_id(127));
EXECUTE resolve_question(pg_temp.test_id(51),pg_temp.test_id(126),pg_temp.test_id(2),pg_temp.test_id(12),
    pg_temp.test_id(102),2,'reply','Duplicate answer',pg_temp.test_id(128));
DO $test$
BEGIN
    IF (SELECT answer FROM question_resolution WHERE question_id=pg_temp.test_id(126)) IS DISTINCT FROM 'Fixture answer'
       OR (SELECT count(*) FROM agent_inbox WHERE question_id=pg_temp.test_id(126)) <> 1
       OR (SELECT session_ref FROM agent_inbox WHERE question_id=pg_temp.test_id(126)) IS DISTINCT FROM 'fixture-thread' THEN
        RAISE EXCEPTION 'offline answer was lost, rerouted, canceled by non-initiator or duplicated';
    END IF;
END
$test$;

-- Seed persisted evidence for exact candidate and test-result checks.
INSERT INTO artifact (id,run_id,execution_id,task_id,attempt_id,requirement_revision,kind,mode,title,source_ref,
                      commit_id,candidate_ref,test_outcome)
VALUES (pg_temp.test_id(131),pg_temp.test_id(51),pg_temp.test_id(121),pg_temp.test_id(123),pg_temp.test_id(124),
        1,'test','codex','Test A','fixture:report-a','same-sha','artifact-a','passed'),
       (pg_temp.test_id(132),pg_temp.test_id(51),pg_temp.test_id(121),pg_temp.test_id(123),pg_temp.test_id(124),
        1,'test','codex','Test B','fixture:report-b','same-sha','artifact-a','failed');
INSERT INTO check_cycle (run_id,workflow_id,workflow_version,check_node_id,current_wave,state)
VALUES (pg_temp.test_id(51),pg_temp.test_id(32),1,pg_temp.test_id(36),1,'pass');
INSERT INTO check_wave (run_id,check_node_id,wave,requirement_revision,checked_commit,checked_artifact_version,
                        outcome,completed_at,report_artifact_id)
VALUES (pg_temp.test_id(51),pg_temp.test_id(36),1,1,'same-sha','artifact-a','pass',statement_timestamp(),pg_temp.test_id(131));
INSERT INTO publication_gate (id,run_id,execution_id,requirement_revision,candidate_commit,artifact_version,target_ref,
                              policy_ref,gate_state,required_checks,test_required,approval_required,test_evidence_id)
SELECT pg_temp.test_id(gate),pg_temp.test_id(51),pg_temp.test_id(122),1,'same-sha',candidate,'fixture:target',
       'fixture:policy','allowed',1,test_needed,false,pg_temp.test_id(report)
FROM (VALUES (141,'artifact-a',true,131),(142,'artifact-b',false,131),(143,'artifact-a',true,132)) g(gate,candidate,test_needed,report);
INSERT INTO publication_check_evidence (gate_id,run_id,check_node_id,wave)
SELECT pg_temp.test_id(gate),pg_temp.test_id(51),pg_temp.test_id(36),1
FROM (VALUES (141),(142),(143)) g(gate);

DO $test$
BEGIN
    IF NOT publication_gate_valid(pg_temp.test_id(141),pg_temp.test_id(51),'same-sha','artifact-a','fixture:target')
       OR publication_gate_valid(pg_temp.test_id(142),pg_temp.test_id(51),'same-sha','artifact-b','fixture:target')
       OR publication_gate_valid(pg_temp.test_id(143),pg_temp.test_id(51),'same-sha','artifact-a','fixture:target') THEN
        RAISE EXCEPTION 'gate did not require exact candidate and passed mandatory tests';
    END IF;
END
$test$;

-- BRD changes update source and run together and retain already pinned input.
UPDATE task_attempt SET state='succeeded' WHERE task_id=pg_temp.test_id(123);
UPDATE node_execution SET state='complete' WHERE id=pg_temp.test_id(121);
INSERT INTO node_execution (id,run_id,workflow_id,workflow_version,node_id,wave,requirement_revision,state)
SELECT pg_temp.test_id(execution),pg_temp.test_id(51),pg_temp.test_id(32),1,pg_temp.test_id(node),1,1,'ready'
FROM (VALUES (160,155),(161,157)) planned(execution,node);
INSERT INTO role_task (id,run_id,device_id,execution_id,workflow_id,workflow_version,node_id,
                       agent_id,agent_version,role,kind,requirement_revision,current_attempt)
SELECT pg_temp.test_id(task),pg_temp.test_id(51),pg_temp.test_id(81),n.id,n.workflow_id,n.workflow_version,n.node_id,
       pg_temp.test_id(41),1,'coordinator','coordinator',n.requirement_revision,1
FROM (VALUES (164,160),(165,161)) f(task,execution) JOIN node_execution n ON n.id=pg_temp.test_id(f.execution);
INSERT INTO task_attempt (task_id,attempt_number,attempt_id,device_id,state,available_at)
VALUES (pg_temp.test_id(164),1,pg_temp.test_id(166),pg_temp.test_id(81),'queued',statement_timestamp()),
       (pg_temp.test_id(165),1,pg_temp.test_id(167),pg_temp.test_id(81),'queued',statement_timestamp()+interval '1 hour');
EXECUTE claim_tasks(pg_temp.test_id(81),1,30);
EXECUTE create_run_change(pg_temp.test_id(51),pg_temp.test_id(160),pg_temp.test_id(162),pg_temp.test_id(2),
    pg_temp.test_id(12),pg_temp.test_id(102),2,1,4,'Fixture revised','fixture revised','Revised scope');
EXECUTE confirm_run_change(pg_temp.test_id(51),pg_temp.test_id(162),pg_temp.test_id(2),pg_temp.test_id(12),
    pg_temp.test_id(102),2,1,4);
EXECUTE change_run_chat_grant(pg_temp.test_id(51),pg_temp.test_id(1),pg_temp.test_id(11),pg_temp.test_id(2),'revoke');
DO $test$
BEGIN
    IF can_chat(pg_temp.test_id(51),pg_temp.test_id(2))
       OR (SELECT holder_account_id FROM chat_lease WHERE run_id=pg_temp.test_id(51)) IS NOT NULL THEN
        RAISE EXCEPTION 'guest revocation did not clear the held lease';
    END IF;
END
$test$;
EXECUTE acquire_chat(pg_temp.test_id(51),pg_temp.test_id(1),pg_temp.test_id(11),pg_temp.test_id(101),15);
EXECUTE confirm_run_change(pg_temp.test_id(51),pg_temp.test_id(162),pg_temp.test_id(1),pg_temp.test_id(11),
    pg_temp.test_id(101),3,1,3);
DO $test$
BEGIN
    IF (SELECT current_revision FROM run WHERE id=pg_temp.test_id(51)) <> 1
       OR (SELECT name FROM requirement WHERE id=pg_temp.test_id(31)) <> 'Fixture requirement'
       OR (SELECT state FROM requirement_change WHERE id=pg_temp.test_id(162)) IS DISTINCT FROM 'pending' THEN
        RAISE EXCEPTION 'invalid confirmer or stale source version changed BRD';
    END IF;
    IF (SELECT input_requirement_revision FROM node_revision_projection WHERE execution_id=pg_temp.test_id(161)) IS NOT NULL THEN
        RAISE EXCEPTION 'ready node exposed an unpinned input revision';
    END IF;
END
$test$;
EXECUTE confirm_run_change(pg_temp.test_id(51),pg_temp.test_id(162),pg_temp.test_id(1),pg_temp.test_id(11),
    pg_temp.test_id(101),3,1,4);
UPDATE task_attempt SET available_at=statement_timestamp() WHERE task_id=pg_temp.test_id(165);
EXECUTE claim_tasks(pg_temp.test_id(81),1,30);
DO $test$
BEGIN
    IF (SELECT current_revision FROM run WHERE id=pg_temp.test_id(51)) <> 2
       OR (SELECT name FROM requirement WHERE id=pg_temp.test_id(31)) <> 'Fixture revised'
       OR (SELECT version FROM configuration WHERE id=pg_temp.test_id(31)) <> 5
       OR (SELECT requirement_version FROM run_requirement_revision WHERE run_id=pg_temp.test_id(51) AND revision=2) <> 5
       OR (SELECT state FROM requirement_change WHERE id=pg_temp.test_id(162)) IS DISTINCT FROM 'confirmed' THEN
        RAISE EXCEPTION 'valid BRD confirmation did not advance both authorities';
    END IF;
    IF (SELECT input_requirement_revision FROM node_revision_projection WHERE execution_id=pg_temp.test_id(160)) <> 1
       OR NOT (SELECT based_on_older_requirement_revision FROM node_revision_projection WHERE execution_id=pg_temp.test_id(160))
       OR (SELECT input_requirement_revision FROM node_revision_projection WHERE execution_id=pg_temp.test_id(161)) <> 2
       OR (SELECT requirement_revision FROM role_task WHERE id=pg_temp.test_id(165)) <> 2
       OR (SELECT based_on_older_requirement_revision FROM node_revision_projection WHERE execution_id=pg_temp.test_id(161)) THEN
        RAISE EXCEPTION 'execution pin or old-revision projection is incorrect';
    END IF;
    BEGIN
        UPDATE node_execution SET requirement_revision=2 WHERE id=pg_temp.test_id(160);
        RAISE EXCEPTION 'in-flight execution input was mutable';
    EXCEPTION WHEN SQLSTATE '55000' THEN NULL;
    END;
END
$test$;
DO $test$
DECLARE
    history record;
    affected bigint;
BEGIN
    EXECUTE 'EXECUTE read_run_attempt_history(pg_temp.test_id(51),pg_temp.test_id(155),pg_temp.test_id(164),NULL,NULL,5)'
    INTO STRICT history;
    IF history.input_requirement_revision <> 1 OR NOT history.based_on_older_requirement_revision
       OR history.role_display_name IS DISTINCT FROM 'Fixture coordinator' THEN
        RAISE EXCEPTION 'filtered history lost pinned input or frozen role label';
    END IF;
    EXECUTE 'EXECUTE read_run_attempt_history(pg_temp.test_id(51),pg_temp.test_id(157),pg_temp.test_id(164),NULL,NULL,5)';
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 0 THEN RAISE EXCEPTION 'history accepted mismatched node and task filters'; END IF;
    EXECUTE 'EXECUTE read_run_attempt_history(pg_temp.test_id(51),pg_temp.test_id(155),pg_temp.test_id(164),pg_temp.test_id(164),1,5)';
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 0 THEN RAISE EXCEPTION 'history repeated its exclusive cursor'; END IF;
END
$test$;
UPDATE task_attempt SET state='succeeded' WHERE task_id IN (pg_temp.test_id(164),pg_temp.test_id(165));
UPDATE node_execution SET state='complete' WHERE id IN (pg_temp.test_id(160),pg_temp.test_id(161));

-- Start queued and leased work before the cap transition to exercise both guards.
INSERT INTO node_execution (id,run_id,workflow_id,workflow_version,node_id,wave,requirement_revision,state,started_at)
VALUES (pg_temp.test_id(170),pg_temp.test_id(51),pg_temp.test_id(32),1,pg_temp.test_id(38),1,2,'running',statement_timestamp()),
       (pg_temp.test_id(171),pg_temp.test_id(51),pg_temp.test_id(32),1,pg_temp.test_id(156),1,2,'running',statement_timestamp()),
       (pg_temp.test_id(169),pg_temp.test_id(51),pg_temp.test_id(32),1,pg_temp.test_id(157),2,2,'running',statement_timestamp());
INSERT INTO role_task (id,run_id,device_id,execution_id,workflow_id,workflow_version,node_id,
                       agent_id,agent_version,role,kind,requirement_revision,current_attempt)
SELECT pg_temp.test_id(task),pg_temp.test_id(51),pg_temp.test_id(81),n.id,n.workflow_id,n.workflow_version,n.node_id,
       pg_temp.test_id(41),1,'coordinator','coordinator',n.requirement_revision,1
FROM (VALUES (172,170),(173,171),(174,169)) f(task,execution) JOIN node_execution n ON n.id=pg_temp.test_id(f.execution);
INSERT INTO task_attempt (task_id,attempt_number,attempt_id,device_id,state,available_at,lease_epoch,lease_deadline,session_ref)
VALUES (pg_temp.test_id(172),1,pg_temp.test_id(175),pg_temp.test_id(81),'leased',statement_timestamp(),900001,
        statement_timestamp()+interval '10 minutes','repair-session'),
       (pg_temp.test_id(173),1,pg_temp.test_id(176),pg_temp.test_id(81),'queued',statement_timestamp(),NULL,NULL,NULL),
       (pg_temp.test_id(174),1,pg_temp.test_id(177),pg_temp.test_id(81),'queued',statement_timestamp(),NULL,NULL,'independent-session');
UPDATE check_wave SET outcome='repair' WHERE run_id=pg_temp.test_id(51) AND check_node_id=pg_temp.test_id(36) AND wave=1;
UPDATE check_cycle SET state='repair',automatic_repair_count=1
WHERE run_id=pg_temp.test_id(51) AND check_node_id=pg_temp.test_id(36);
INSERT INTO run_external_grant (run_id,effect,target_key,approved_by,policy_ref,approved_at,expires_at)
VALUES (pg_temp.test_id(51),'push_code','fixture:branch',pg_temp.test_id(1),'fixture:policy',statement_timestamp(),statement_timestamp()+interval '1 hour');
INSERT INTO external_operation (id,requirement_id,run_id,provider,mode,effect,operation_key,target_key,state)
SELECT pg_temp.test_id(op),pg_temp.test_id(31),pg_temp.test_id(51),'fixture','codex','push_code',op_key,'fixture:branch','intended'
FROM (VALUES (180,'fixture:blocked-push'),(181,'fixture:independent-push')) f(op,op_key);

-- Begin single-connection assertions for the same fixture used by the race check.

-- Contact projection is tied to the current account and session.
-- Neither project nor unrelated account rights are treated as configuration use.
INSERT INTO configuration (id,kind,owner_id,version)
VALUES (pg_temp.test_id(901),'agent',pg_temp.test_id(1),1);
DO $test$
DECLARE
    result record;
BEGIN
    EXECUTE 'EXECUTE read_self_contact(pg_temp.test_id(1),pg_temp.test_id(11))' INTO result;
    IF result.email IS DISTINCT FROM 'fixture_1@example.invalid'
       OR result.phone IS DISTINCT FROM '+12025550101' THEN RAISE EXCEPTION 'self contact projection failed'; END IF;
    EXECUTE 'EXECUTE read_self_contact(pg_temp.test_id(1),pg_temp.test_id(12))' INTO result;
    IF result.email IS NOT NULL THEN RAISE EXCEPTION 'cross-account contact disclosed'; END IF;
    IF NOT configuration_can_use(pg_temp.test_id(32),pg_temp.test_id(1))
       OR NOT configuration_can_use(pg_temp.test_id(901),pg_temp.test_id(1))
       OR configuration_can_use(pg_temp.test_id(32),pg_temp.test_id(2))
       OR configuration_can_use(pg_temp.test_id(901),pg_temp.test_id(2))
       OR configuration_can_use(pg_temp.test_id(31),pg_temp.test_id(1)) THEN
        RAISE EXCEPTION 'configuration owner use scope incorrect';
    END IF;
END
$test$;
INSERT INTO configuration_deputy (configuration_id,account_id,granted_by)
VALUES (pg_temp.test_id(32),pg_temp.test_id(2),pg_temp.test_id(1)),
       (pg_temp.test_id(901),pg_temp.test_id(2),pg_temp.test_id(1));
DO $test$
BEGIN
    IF NOT configuration_can_use(pg_temp.test_id(32),pg_temp.test_id(2))
       OR NOT configuration_can_use(pg_temp.test_id(901),pg_temp.test_id(2)) THEN
        RAISE EXCEPTION 'active deputy cannot use configuration';
    END IF;
END
$test$;
UPDATE configuration_deputy SET revoked_at=statement_timestamp()
WHERE account_id=pg_temp.test_id(2) AND configuration_id IN (pg_temp.test_id(32),pg_temp.test_id(901));
DO $test$
BEGIN
    IF configuration_can_use(pg_temp.test_id(32),pg_temp.test_id(2))
       OR configuration_can_use(pg_temp.test_id(901),pg_temp.test_id(2)) THEN
        RAISE EXCEPTION 'revoked deputy kept use permission';
    END IF;
END
$test$;


-- A partially verified expired registration cannot activate, and all three
-- normalized identifiers can be registered again. Old proof is account-bound.
EXECUTE register_account(pg_temp.test_id(6),'Expired fixture','expired_6','expired_6',
                         'Expired@example.invalid','expired@example.invalid','+12025550106','fixture-hash');
EXECUTE lock_registration_account(pg_temp.test_id(6));
EXECUTE record_contact_verification(pg_temp.test_id(6),'email','expired@example.invalid');
UPDATE account SET created_at = statement_timestamp() - interval '24 hours' WHERE id = pg_temp.test_id(6);
EXECUTE record_contact_verification(pg_temp.test_id(6),'phone','+12025550106');
DO $test$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM account WHERE id=pg_temp.test_id(6) AND status='pending'
                   AND email_verified_at IS NOT NULL AND phone_verified_at IS NULL) THEN
        RAISE EXCEPTION 'proof accepted at or after expiration';
    END IF;
END
$test$;
EXECUTE reclaim_expired_registration_keys('expired_6','expired@example.invalid','+12025550106');
EXECUTE register_account(pg_temp.test_id(7),'Renewed fixture','EXPIRED_6','expired_6',
                         'expired@example.invalid','expired@example.invalid','+12025550106','fixture-hash');
EXECUTE record_contact_verification(pg_temp.test_id(6),'phone','+12025550106');
EXECUTE reclaim_expired_registration_keys('expired_6','expired@example.invalid','+12025550106');
EXECUTE reclaim_expired_registration_keys('fixture_1','fixture_1@example.invalid','+12025550101');
DO $test$
BEGIN
    IF EXISTS (SELECT 1 FROM account WHERE id=pg_temp.test_id(6))
       OR NOT EXISTS (SELECT 1 FROM account WHERE id=pg_temp.test_id(7) AND status='pending'
                      AND email_verified_at IS NULL AND phone_verified_at IS NULL)
       OR NOT EXISTS (SELECT 1 FROM account WHERE id=pg_temp.test_id(1) AND status='active') THEN
        RAISE EXCEPTION 'registration reclaim or isolation failed';
    END IF;
END
$test$;


EXECUTE register_account(pg_temp.test_id(8),'Cleanup fixture','cleanup_8','cleanup_8',
                         'cleanup@example.invalid','cleanup@example.invalid','+12025550108','fixture-hash');
UPDATE account SET created_at = statement_timestamp() - interval '24 hours' WHERE id = pg_temp.test_id(8);
EXECUTE purge_expired_registrations(1);
DO $test$
BEGIN
    IF EXISTS (SELECT 1 FROM account WHERE id=pg_temp.test_id(8))
       OR NOT EXISTS (SELECT 1 FROM account WHERE id=pg_temp.test_id(7) AND status='pending') THEN
        RAISE EXCEPTION 'cleanup removed live pending registration or missed expired account';
    END IF;
END
$test$;

EXECUTE register_account(pg_temp.test_id(4),'Pending fixture','pending_4','pending_4',
                         'Mixed@example.invalid','mixed@example.invalid','+12025550104','fixture-hash');
DO $test$
DECLARE
    result record;
BEGIN
    BEGIN
        EXECUTE 'EXECUTE register_account(pg_temp.test_id(5),''Duplicate email'',''duplicate_5'',''duplicate_5'',''MIXED@example.invalid'',''mixed@example.invalid'',''+12025550105'',''fixture-hash'')';
        RAISE EXCEPTION 'normalized duplicate email accepted';
    EXCEPTION WHEN unique_violation THEN NULL;
    END;
    BEGIN
        EXECUTE 'EXECUTE register_account(pg_temp.test_id(5),''Duplicate phone'',''duplicate_5'',''duplicate_5'',''other@example.invalid'',''other@example.invalid'',''+12025550104'',''fixture-hash'')';
        RAISE EXCEPTION 'normalized duplicate phone accepted';
    EXCEPTION WHEN unique_violation THEN NULL;
    END;
    EXECUTE 'EXECUTE lookup_login(''pending_4'',''username'')' INTO result;
    IF result.id IS NOT NULL THEN RAISE EXCEPTION 'pending account can log in'; END IF;
    EXECUTE 'EXECUTE record_contact_verification(pg_temp.test_id(4),''phone'',''+12025550105'')' INTO result;
    IF result.id IS NOT NULL THEN RAISE EXCEPTION 'verification accepted a different phone'; END IF;
    EXECUTE 'EXECUTE record_contact_verification(pg_temp.test_id(4),''phone'',''+12025550104'')' INTO result;
    IF result.status IS DISTINCT FROM 'pending' OR result.phone_verified IS DISTINCT FROM true
       OR result.email_verified IS DISTINCT FROM false THEN RAISE EXCEPTION 'phone alone activated account'; END IF;
    EXECUTE 'EXECUTE lookup_login(''mixed@example.invalid'',''email'')' INTO result;
    IF result.id IS NOT NULL THEN RAISE EXCEPTION 'partially verified account can log in'; END IF;
    EXECUTE 'EXECUTE record_contact_verification(pg_temp.test_id(4),''email'',''mixed@example.invalid'')' INTO result;
    IF result.status IS DISTINCT FROM 'active' OR result.email_verified IS DISTINCT FROM true
       OR result.phone_verified IS DISTINCT FROM true THEN RAISE EXCEPTION 'second proof did not activate account'; END IF;
    EXECUTE 'EXECUTE lookup_login(''mixed@example.invalid'',''email'')' INTO result;
    IF result.id IS DISTINCT FROM pg_temp.test_id(4) THEN RAISE EXCEPTION 'activated account lookup failed'; END IF;
END
$test$;
EXECUTE mark_repair_limit(pg_temp.test_id(51),pg_temp.test_id(36));
EXECUTE claim_tasks(pg_temp.test_id(81),10,30);
EXECUTE authorize_external_effect(pg_temp.test_id(180),pg_temp.test_id(81),pg_temp.test_id(172),
    pg_temp.test_id(175),900001,'push_code','fixture:branch',statement_timestamp()+interval '1 minute',NULL,NULL);
DO $test$
DECLARE
    independent_epoch bigint;
    affected bigint;
BEGIN
    SELECT lease_epoch INTO STRICT independent_epoch FROM task_attempt WHERE task_id=pg_temp.test_id(174);
    IF independent_epoch IS NULL OR (SELECT state FROM task_attempt WHERE task_id=pg_temp.test_id(173)) <> 'queued'
       OR (SELECT state FROM external_operation WHERE id=pg_temp.test_id(180)) <> 'intended'
       OR task_route_is_open(pg_temp.test_id(51),pg_temp.test_id(37)) THEN
        RAISE EXCEPTION 'repair cap failed to isolate its dependencies from independent work';
    END IF;
    EXECUTE format('EXECUTE authorize_external_effect(pg_temp.test_id(181),pg_temp.test_id(81),pg_temp.test_id(174),pg_temp.test_id(177),%s,%L,%L,statement_timestamp()+interval ''1 minute'',NULL,NULL)',
                   independent_epoch,'push_code','fixture:branch');
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 1 THEN RAISE EXCEPTION 'repair cap blocked independent external authorization'; END IF;
    EXECUTE format('EXECUTE accept_task_event(pg_temp.test_id(81),pg_temp.test_id(174),pg_temp.test_id(177),%s,1,%L,pg_temp.test_id(182),%L,NULL,%L,NULL)',
                   independent_epoch,'message','fixture-agent-message','independent-session');
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 1 THEN RAISE EXCEPTION 'ordinary Agent message event was not accepted'; END IF;
END
$test$;
EXECUTE record_agent_message(pg_temp.test_id(183),pg_temp.test_id(182),'invalid-session','Wrong session',NULL);
EXECUTE record_agent_message(pg_temp.test_id(184),pg_temp.test_id(182),'independent-session','Fixture Agent reply',NULL);
DO $test$
BEGIN
    IF (SELECT id FROM chat_message WHERE source_event_id=pg_temp.test_id(182)) IS DISTINCT FROM pg_temp.test_id(184) THEN
        RAISE EXCEPTION 'ordinary Agent message was not projected with its source event';
    END IF;
END
$test$;
EXECUTE send_chat_message(pg_temp.test_id(51),pg_temp.test_id(1),pg_temp.test_id(11),pg_temp.test_id(101),3,
    pg_temp.test_id(169),NULL,'Fixture ordinary message',pg_temp.test_id(185),pg_temp.test_id(186));
EXECUTE send_chat_message(pg_temp.test_id(51),pg_temp.test_id(1),pg_temp.test_id(11),pg_temp.test_id(101),3,
    pg_temp.test_id(169),pg_temp.test_id(999),'Unknown explicit target',pg_temp.test_id(187),pg_temp.test_id(188));
DO $test$
DECLARE
    independent_epoch bigint;
    affected bigint;
BEGIN
    IF (SELECT target_task_id FROM chat_message WHERE id=pg_temp.test_id(185)) IS DISTINCT FROM pg_temp.test_id(174)
       OR EXISTS (SELECT 1 FROM chat_message WHERE id=pg_temp.test_id(187))
       OR (SELECT payload->>'chatMessageId' FROM agent_inbox WHERE id=pg_temp.test_id(186)) IS DISTINCT FROM pg_temp.test_id(185)::text THEN
        RAISE EXCEPTION 'default or invalid explicit chat routing was incorrect';
    END IF;
    SELECT lease_epoch INTO STRICT independent_epoch FROM task_attempt WHERE task_id=pg_temp.test_id(174);
    EXECUTE format('EXECUTE accept_task_event(pg_temp.test_id(81),pg_temp.test_id(174),pg_temp.test_id(177),%s,2,%L,pg_temp.test_id(189),%L,NULL,%L,%L)',
                   independent_epoch,'failure','fixture-agent-failure','independent-session','fixture_reason');
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 1 THEN RAISE EXCEPTION 'fixture failure not accepted'; END IF;
END
$test$;
EXECUTE skip_failed_role(pg_temp.test_id(51),pg_temp.test_id(174),pg_temp.test_id(1),pg_temp.test_id(11),pg_temp.test_id(101),3);
EXECUTE retry_failed_role(pg_temp.test_id(51),pg_temp.test_id(174),pg_temp.test_id(1),pg_temp.test_id(11),pg_temp.test_id(101),3,pg_temp.test_id(190));
DO $test$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM task_attempt WHERE task_id=pg_temp.test_id(174) AND attempt_number=1
                   AND state='failed' AND disposition='skipped' AND reason_code='fixture_reason')
       OR EXISTS (SELECT 1 FROM task_attempt WHERE task_id=pg_temp.test_id(174) AND attempt_number=2) THEN
        RAISE EXCEPTION 'skip erased failure evidence or silently retried';
    END IF;
END
$test$;

SET CONSTRAINTS ALL IMMEDIATE;
SELECT 'AgentShip data assertions passed' AS result;
ROLLBACK;
