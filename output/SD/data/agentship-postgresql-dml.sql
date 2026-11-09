-- SD-D01 to SD-D03. Draft prepared statements for a single PostgreSQL session.
-- Execute after DDL. No production connection, real IDs, or secrets are supplied here.
-- P1...Pn follow each PREPARE type list. See SD-AgentShip-data.md for transaction order.
-- Actor, browser session, device identity, normalized keys, proof verification and
-- content/policy evidence come from trusted platform boundaries, never arbitrary JSON.
-- Read Committed. The caller must check expected RETURNING counts and roll back the
-- whole command on missing/extra rows, failed invariants, conflicts, or any exception.
SET search_path TO agentship_design, pg_catalog;

-- UC-01. Before register_account, reclaim any expired pending accounts whose
-- normalized keys conflict with this request. Run both statements in one transaction.
-- Lock candidates in ID order. Recheck status and deadline on delete. The unique
-- indexes arbitrate any concurrent new registration, including absent key races.
PREPARE reclaim_expired_registration_keys (text,text,text) AS
WITH expired AS (
    SELECT id FROM account
    WHERE status = 'pending' AND created_at <= statement_timestamp() - interval '24 hours'
      AND (username_key = $1 OR email_login_key = $2 OR phone = $3)
    ORDER BY id FOR UPDATE
)
DELETE FROM account a USING expired e
WHERE a.id = e.id AND a.status = 'pending'
  AND a.created_at <= clock_timestamp() - interval '24 hours'
RETURNING a.id;

-- P1 validated positive cleanup batch size. Lock only expired pending rows.
PREPARE purge_expired_registrations (integer) AS
WITH expired AS (
    SELECT id FROM account
    WHERE status = 'pending' AND created_at <= statement_timestamp() - interval '24 hours'
    ORDER BY created_at,id LIMIT greatest($1,0) FOR UPDATE SKIP LOCKED
)
DELETE FROM account a USING expired e
WHERE a.id = e.id AND a.status = 'pending'
  AND a.created_at <= clock_timestamp() - interval '24 hours'
RETURNING a.id;

-- UC-01. P1 id, P2 display name, P3 username, P4 username key, P5 email,
-- P6 case-insensitive email key, P7 normalized international phone, P8 password hash.
-- Validate password length/equality in the credential boundary. Map unique violations
-- to the same safe IDENTIFIER_UNAVAILABLE response for all identifier types.
PREPARE register_account (uuid,text,text,text,text,text,text,text) AS
INSERT INTO account (id,display_name,username,username_key,email,email_login_key,phone,password_hash,status)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'pending')
RETURNING id,display_name,username,status,created_at + interval '24 hours' AS registration_expires_at;

-- Lock the account in an earlier statement to adjudicate the deadline after lock
-- acquisition. Provider checks and other external calls happen outside the lock.
PREPARE lock_registration_account (uuid) AS
SELECT id FROM account WHERE id = $1 FOR UPDATE;

-- P1 account bound to verified proof, P2 channel, P3 verified normalized destination.
-- Only call after the trusted verification adapter has validated the proof.
-- UPDATE locks the account row and re-evaluates the expression on concurrent writes.
-- Replaying accepted proof preserves timestamps. A revoked account cannot be activated.
PREPARE record_contact_verification (uuid,text,text) AS
UPDATE account
SET email_verified_at = CASE WHEN $2 = 'email' THEN coalesce(email_verified_at,statement_timestamp()) ELSE email_verified_at END,
    phone_verified_at = CASE WHEN $2 = 'phone' THEN coalesce(phone_verified_at,statement_timestamp()) ELSE phone_verified_at END,
    status = CASE WHEN ($2 = 'email' OR email_verified_at IS NOT NULL)
                   AND ($2 = 'phone' OR phone_verified_at IS NOT NULL)
                  THEN 'active' ELSE 'pending' END
WHERE id = $1 AND status IN ('pending','active')
  AND (status = 'active' OR created_at > clock_timestamp() - interval '24 hours')
  AND (($2 = 'email' AND email_login_key = $3) OR ($2 = 'phone' AND phone = $3))
RETURNING id,status,email_verified_at IS NOT NULL AS email_verified,phone_verified_at IS NOT NULL AS phone_verified;

-- P1 normalized identifier, P2 namespace (username or email). Verify password in
-- the credential boundary; this statement is never projected to browser clients.
PREPARE lookup_login (text,text) AS
SELECT id,password_hash,status FROM account
WHERE status = 'active'
  AND (($2 = 'username' AND username_key = $1) OR ($2 = 'email' AND email_login_key = $1));

-- UC-01. P1 authenticated actor, P2 validated current browser session.
-- The request supplies no target account. This is the sole contact projection.
PREPARE read_self_contact (uuid,uuid) AS
SELECT a.email,a.phone FROM account a
WHERE a.id = $1 AND active_browser_session($1,$2);

-- UC-02. Locks must be obtained before a separate authorization/write statement.
-- P1 config id.
PREPARE lock_configuration (uuid) AS
SELECT id,kind,owner_id,version FROM configuration WHERE id = $1 FOR UPDATE;

-- P1 configuration, P2 actor, P3 browser session, P4 exact entered username.
-- Do not expose contacts, credentials, UUID probing, or unrestricted search.
PREPARE find_owner_candidate (uuid,uuid,uuid,text) AS
SELECT a.id,a.username,a.display_name
FROM configuration c
JOIN account a ON a.username_key = lower($4 COLLATE "C") AND a.status = 'active'
WHERE c.id = $1 AND c.owner_id = $2 AND active_browser_session($2,$3)
  AND $4 COLLATE "C" ~ '^[A-Za-z0-9_-]{1,100}$' AND a.id <> $2;

-- P1 project, P2 authenticated account, P3 browser session, P4 config ID, P5 title,
-- P6 normalized global name key, P7 description. Check only current project grant.
PREPARE create_requirement (uuid,uuid,uuid,uuid,text,text,text) AS
WITH allowed AS (
    SELECT 1 FROM project_permission p
    WHERE p.project_id = $1 AND p.account_id = $2 AND p.capability = 'create_requirement'
      AND p.revoked_at IS NULL AND (p.expires_at IS NULL OR p.expires_at > statement_timestamp())
      AND active_browser_session($2,$3)
), parent AS (
    INSERT INTO configuration (id,kind,owner_id,version)
    SELECT $4,'requirement',$2,1 FROM allowed
    RETURNING id
)
INSERT INTO requirement (id,project_id,name,name_key,description)
SELECT id,$1,$5,$6,$7 FROM parent
RETURNING id;

-- P1 config, P2 actor, P3 session, P4 expected config version, P5 display name,
-- P6 normalized name key, P7 description. Call lock_configuration in the same tx.
PREPARE update_requirement (uuid,uuid,uuid,bigint,text,text,text) AS
WITH touched AS (
    UPDATE configuration c
    SET version = c.version + 1, updated_at = statement_timestamp()
    WHERE c.id = $1 AND c.kind = 'requirement' AND c.version = $4
      AND active_browser_session($2,$3)
      AND (c.owner_id = $2 OR EXISTS (
          SELECT 1 FROM configuration_deputy d
          WHERE d.configuration_id = c.id AND d.account_id = $2 AND d.revoked_at IS NULL
      ))
    RETURNING c.id,c.version
)
UPDATE requirement r SET name = $5,name_key = $6,description = $7
FROM touched c WHERE r.id = c.id
RETURNING r.id,c.version;

-- P1 config, P2 owner, P3 session, P4 expected version, P5 target, P6 add_deputy or remove_deputy.
-- A removal keeps a tombstone for the revoked user's safe stale-page hint.
PREPARE change_deputy (uuid,uuid,uuid,bigint,uuid,text) AS
WITH changed AS (
    UPDATE configuration c SET version = c.version + 1,updated_at = statement_timestamp()
    WHERE c.id = $1 AND c.owner_id = $2 AND c.version = $4 AND $5 <> $2
      AND active_browser_session($2,$3)
      AND $6 IN ('add_deputy','remove_deputy')
      AND EXISTS (SELECT 1 FROM account WHERE id = $5 AND status = 'active')
      AND ($6 <> 'remove_deputy' OR EXISTS (
          SELECT 1 FROM configuration_deputy d
          WHERE d.configuration_id = c.id AND d.account_id = $5 AND d.revoked_at IS NULL
      ))
    RETURNING c.id
)
INSERT INTO configuration_deputy (configuration_id,account_id,granted_by,revoked_at)
SELECT id,$5,$2,CASE WHEN $6 = 'remove_deputy' THEN statement_timestamp() END FROM changed
ON CONFLICT (configuration_id,account_id) DO UPDATE
SET revoked_at = EXCLUDED.revoked_at,
    granted_by = CASE WHEN $6 = 'add_deputy' THEN EXCLUDED.granted_by ELSE configuration_deputy.granted_by END,
    granted_at = CASE WHEN $6 = 'add_deputy' THEN statement_timestamp() ELSE configuration_deputy.granted_at END
RETURNING configuration_id,account_id,revoked_at;

-- P1 config, P2 current owner, P3 session, P4 expected version, P5 new owner.
-- Revoke both old and new owner deputy entries. Their independent grants remain
-- a separately approved policy. Current permission checks invalidate stale chat rights.
PREPARE transfer_ownership (uuid,uuid,uuid,bigint,uuid) AS
WITH changed AS (
    UPDATE configuration c SET owner_id = $5,version = c.version + 1,updated_at = statement_timestamp()
    WHERE c.id = $1 AND c.owner_id = $2 AND c.version = $4 AND $5 <> $2
      AND active_browser_session($2,$3)
      AND EXISTS (SELECT 1 FROM account WHERE id = $5 AND status = 'active')
    RETURNING c.id,c.version
), revoked AS (
    UPDATE configuration_deputy d SET revoked_at = statement_timestamp()
    FROM changed c
    WHERE d.configuration_id = c.id AND d.account_id IN ($2,$5) AND d.revoked_at IS NULL
    RETURNING d.account_id
)
SELECT id,version FROM changed;

-- Receipts. P1 actor kind, P2 account ID or NULL, P3 device ID or NULL,
-- P4 operation scope, P5 request key, P6 canonical request digest.
-- 0 rows means read_command_receipt in a new statement of the same transaction.
PREPARE reserve_command_receipt (text,uuid,uuid,text,text,bytea) AS
INSERT INTO command_receipt (actor_kind,actor_account_id,actor_device_id,scope,request_key,request_digest)
VALUES ($1,$2,$3,$4,$5,$6)
ON CONFLICT (actor_kind,actor_id,scope,request_key) DO NOTHING
RETURNING actor_id;

-- P1 actor kind, P2 authenticated actor ID, P3 scope, P4 key. Compare digest
-- using constant-time comparison, then recheck current authorization for the result.
PREPARE read_command_receipt (text,uuid,text,text) AS
SELECT request_digest,result_kind,result_id,accepted_at FROM command_receipt
WHERE actor_kind = $1 AND actor_id = $2 AND scope = $3 AND request_key = $4;

-- P1 kind, P2 actor ID, P3 scope, P4 key, P5 result kind, P6 result ID.
PREPARE finish_command_receipt (text,uuid,text,text,text,uuid) AS
UPDATE command_receipt SET result_kind = $5,result_id = $6,accepted_at = statement_timestamp()
WHERE actor_kind = $1 AND actor_id = $2 AND scope = $3 AND request_key = $4 AND accepted_at IS NULL
RETURNING result_id;

-- UC-03. P1 workflow, P2 new content version. The caller holds the configuration
-- row, validates editor rights and route semantics, then inserts version graph rows.
-- This statement invokes the database graph and immutability guard.
PREPARE seal_workflow_version (uuid,bigint) AS
UPDATE workflow_version SET sealed_at = statement_timestamp()
WHERE workflow_id = $1 AND version = $2 AND sealed_at IS NULL
RETURNING workflow_id,version;

-- UC-04. P1 requirement, P2 workflow. Always acquire in UUID order.
PREPARE lock_start_inputs (uuid,uuid) AS
SELECT id FROM configuration WHERE id IN ($1,$2) ORDER BY id FOR UPDATE;

-- P1 challenge, P2 actor, P3 session, P4 device, P5 origin.
-- Retrieve only the proof inputs required by the platform verifier. Hold the locks
-- through signature validation and execute start_run only after successful verification.
PREPARE lock_device_proof (uuid,uuid,uuid,uuid,text) AS
SELECT c.id,c.nonce,c.expires_at,d.id AS device_id,d.proof_public_key
FROM device_challenge c
JOIN device d ON d.id = $4 AND d.account_id = c.account_id
WHERE c.id = $1 AND c.account_id = $2 AND c.session_id = $3 AND c.platform_origin = $5
  AND d.paired_origin = $5 AND d.revoked_at IS NULL AND c.consumed_at IS NULL
  AND c.expires_at > statement_timestamp() AND active_browser_session($2,$3)
FOR UPDATE OF c,d;

-- P1 run, P2 actor, P3 session, P4 requirement, P5 requirement version, P6 workflow,
-- P7 sealed flow version, P8 device, P9 challenge, P10 work type, P11 accepted
-- device last-seen cutoff, P12 initial Git task ID, P13 initial Git attempt ID,
-- P14 exact GitHub account/organization name for unlinked feature or NULL.
-- Reserve receipt, lock configurations and proof, verify the signature and evaluate
-- object, role and provider policy before this call. It rechecks scope and consumes
-- the same challenge. On zero rows roll back, including receipt reservation.
PREPARE start_run (uuid,uuid,uuid,uuid,bigint,uuid,bigint,uuid,uuid,text,timestamptz,uuid,uuid,text) AS
WITH valid AS (
    SELECT q.id,q.project_id,q.name,q.description,q.repository_id,d.id AS device_id,d.mode
    FROM requirement q
    JOIN configuration c ON c.id = q.id
    JOIN configuration w ON w.id = $6 AND w.kind = 'workflow'
    JOIN workflow_version v ON v.workflow_id = w.id AND v.version = $7
    JOIN device d ON d.id = $8 AND d.account_id = $2
    WHERE q.id = $4 AND c.owner_id = $2 AND c.version = $5
      AND v.sealed_at IS NOT NULL AND v.version = (
          SELECT max(v2.version) FROM workflow_version v2 WHERE v2.workflow_id = w.id AND v2.sealed_at IS NOT NULL
      )
      AND configuration_can_use(w.id,$2)
      AND d.revoked_at IS NULL AND d.last_seen_at >= $11 AND active_browser_session($2,$3)
      AND ((q.repository_id IS NULL AND $10 = 'feature' AND NULLIF(btrim($14),'') IS NOT NULL)
        OR (q.repository_id IS NOT NULL AND $14 IS NULL))
      AND (NULLIF(btrim(q.description),'') IS NOT NULL OR EXISTS (
          SELECT 1 FROM workflow_node n
          WHERE n.workflow_id = w.id AND n.workflow_version = v.version AND n.purpose = 'requirement'
      ))
), used AS (
    UPDATE device_challenge dc SET consumed_at = statement_timestamp()
    FROM valid v
    WHERE dc.id = $9 AND dc.account_id = $2 AND dc.session_id = $3 AND dc.consumed_at IS NULL
      AND dc.expires_at > statement_timestamp()
    RETURNING dc.id
), created AS (
    INSERT INTO run (id,project_id,requirement_id,workflow_id,workflow_version,initiator_id,device_id,
                     mode,work_type,state,current_revision,state_version,repository_id,github_namespace)
    SELECT $1,v.project_id,v.id,$6,$7,$2,v.device_id,v.mode,$10,'preparing',1,1,v.repository_id,btrim($14)
    FROM valid v CROSS JOIN used RETURNING id,device_id
), revision AS (
    INSERT INTO run_requirement_revision (run_id,revision,requirement_version,title,description,recorded_by)
    SELECT c.id,1,$5,v.name,v.description,$2 FROM created c CROSS JOIN valid v
    RETURNING run_id,revision
), task AS (
    INSERT INTO role_task (id,run_id,device_id,kind,requirement_revision,current_attempt)
    SELECT $12,c.id,c.device_id,'git',r.revision,1 FROM created c JOIN revision r ON r.run_id = c.id
    RETURNING id,run_id,device_id
), attempt AS (
    INSERT INTO task_attempt (task_id,attempt_number,attempt_id,device_id,state,available_at)
    SELECT id,1,$13,device_id,'queued',statement_timestamp() FROM task
    RETURNING task_id,attempt_id
)
SELECT t.run_id,a.task_id,a.attempt_id FROM task t JOIN attempt a ON a.task_id = t.id;

-- P1 run. Lock the configuration first, then the run in a separate statement.
-- Use this pair on browser writes, and when a worker result changes requirement binding.
PREPARE lock_run_configuration (uuid) AS
SELECT c.id FROM run r JOIN configuration c ON c.id = r.requirement_id WHERE r.id = $1 FOR UPDATE OF c;
PREPARE lock_run (uuid) AS
SELECT id,initiator_id,device_id,state,current_revision,state_version FROM run WHERE id = $1 FOR UPDATE;

-- P1 run, P2 initiator, P3 active session, P4 exact username. The caller holds
-- the source requirement configuration and run locks before this lookup.
PREPARE find_chat_guest (uuid,uuid,uuid,text) AS
SELECT a.id,a.username,a.display_name
FROM run r JOIN account a ON a.username_key = lower($4 COLLATE "C") AND a.status = 'active'
WHERE r.id = $1 AND r.initiator_id = $2 AND a.id <> $2 AND active_browser_session($2,$3)
  AND $4 COLLATE "C" ~ '^[A-Za-z0-9_-]{1,100}$'
  AND NOT EXISTS (
      SELECT 1 FROM configuration_deputy d
      WHERE d.configuration_id = r.requirement_id AND d.account_id = a.id AND d.revoked_at IS NULL
  );

-- P1 run, P2 initiator, P3 active session, P4 authorized guest ID, P5 grant or revoke.
-- No chat lease is required. Revoke closes the holder in the same transaction.
PREPARE change_run_chat_grant (uuid,uuid,uuid,uuid,text) AS
WITH eligible AS (
    SELECT r.id FROM run r JOIN account a ON a.id = $4
    WHERE r.id = $1 AND r.initiator_id = $2 AND a.id <> $2 AND active_browser_session($2,$3)
      AND (($5 = 'grant' AND a.status = 'active' AND NOT EXISTS (
          SELECT 1 FROM configuration_deputy d
          WHERE d.configuration_id = r.requirement_id AND d.account_id = a.id AND d.revoked_at IS NULL
      )) OR ($5 = 'revoke' AND EXISTS (
          SELECT 1 FROM run_permission p WHERE p.run_id = r.id AND p.account_id = a.id
            AND p.capability = 'chat' AND p.revoked_at IS NULL
      )))
), updated AS (
    INSERT INTO run_permission (run_id,account_id,capability,granted_by,granted_at,revoked_at)
    SELECT id,$4,'chat',$2,statement_timestamp(),
           CASE WHEN $5 = 'revoke' THEN statement_timestamp() END
    FROM eligible
    ON CONFLICT (run_id,account_id,capability) DO UPDATE SET
        granted_by = CASE WHEN $5 = 'grant' THEN EXCLUDED.granted_by ELSE run_permission.granted_by END,
        granted_at = CASE WHEN $5 = 'grant' THEN EXCLUDED.granted_at ELSE run_permission.granted_at END,
        expires_at = CASE WHEN $5 = 'grant' THEN NULL ELSE run_permission.expires_at END,
        revoked_at = EXCLUDED.revoked_at
    RETURNING run_id,account_id,revoked_at
), closed AS (
    UPDATE chat_lease l SET holder_account_id = NULL,holder_session_id = NULL,holder_tab_id = NULL,
        heartbeat_until = NULL,grace_until = NULL
    FROM updated u WHERE l.run_id = u.run_id AND l.holder_account_id = u.account_id AND u.revoked_at IS NOT NULL
    RETURNING l.run_id
)
SELECT run_id,account_id,revoked_at FROM updated;

-- UC-06. P1 run, P2 actor, P3 session, P4 tab, P5 heartbeat window in seconds.
-- Repeated acquire by same actor/session/tab returns the same epoch. The platform
-- signs a capability scoped to the persisted session, tab and returned epoch.
PREPARE acquire_chat (uuid,uuid,uuid,uuid,integer) AS
WITH allowed AS (
    SELECT $1 AS run_id
    WHERE $5 > 0 AND active_browser_session($2,$3) AND can_chat($1,$2)
)
INSERT INTO chat_lease (run_id,epoch,holder_account_id,holder_session_id,holder_tab_id,heartbeat_until,grace_until)
SELECT run_id,1,$2,$3,$4,statement_timestamp() + make_interval(secs => $5),
       statement_timestamp() + make_interval(secs => $5) + interval '5 minutes' FROM allowed
ON CONFLICT (run_id) DO UPDATE SET
    epoch = CASE WHEN chat_lease.holder_account_id = $2 AND chat_lease.holder_session_id = $3
                     AND chat_lease.holder_tab_id = $4 AND chat_lease.grace_until > statement_timestamp()
                 THEN chat_lease.epoch ELSE chat_lease.epoch + 1 END,
    holder_account_id = $2,holder_session_id = $3,holder_tab_id = $4,
    heartbeat_until = EXCLUDED.heartbeat_until,grace_until = EXCLUDED.grace_until
WHERE chat_lease.holder_account_id IS NULL OR chat_lease.grace_until <= statement_timestamp()
   OR (chat_lease.holder_account_id = $2 AND chat_lease.holder_session_id = $3 AND chat_lease.holder_tab_id = $4)
   OR NOT active_browser_session(chat_lease.holder_account_id,chat_lease.holder_session_id)
   OR NOT can_chat(chat_lease.run_id,chat_lease.holder_account_id)
RETURNING run_id,epoch,heartbeat_until,grace_until;

-- P1 run, P2 actor, P3 session. Only eligible competitors can learn the holder name.
PREPARE read_chat_occupant (uuid,uuid,uuid) AS
SELECT a.display_name,l.grace_until
FROM chat_lease l JOIN account a ON a.id = l.holder_account_id
WHERE l.run_id = $1 AND l.grace_until > statement_timestamp()
  AND active_browser_session($2,$3) AND can_chat($1,$2)
  AND active_browser_session(l.holder_account_id,l.holder_session_id) AND can_chat($1,l.holder_account_id);

-- P1 run, P2 actor, P3 session, P4 tab, P5 verified epoch, P6 heartbeat window seconds.
-- Verify the signed lease before executing. The owner can renew during grace.
PREPARE renew_chat (uuid,uuid,uuid,uuid,bigint,integer) AS
UPDATE chat_lease SET heartbeat_until = statement_timestamp() + make_interval(secs => $6),
    grace_until = statement_timestamp() + make_interval(secs => $6) + interval '5 minutes'
WHERE run_id = $1 AND holder_account_id = $2 AND holder_session_id = $3 AND holder_tab_id = $4 AND epoch = $5
  AND grace_until > statement_timestamp() AND $6 > 0
  AND active_browser_session($2,$3) AND can_chat($1,$2)
RETURNING run_id,epoch,heartbeat_until,grace_until;

-- P1 run, P2 actor, P3 session, P4 tab, P5 verified epoch.
PREPARE release_chat (uuid,uuid,uuid,uuid,bigint) AS
UPDATE chat_lease SET holder_account_id = NULL,holder_session_id = NULL,holder_tab_id = NULL,
    heartbeat_until = NULL,grace_until = NULL
WHERE run_id = $1 AND holder_account_id = $2 AND holder_session_id = $3 AND holder_tab_id = $4 AND epoch = $5
  AND active_browser_session($2,$3)
RETURNING run_id,epoch;

-- P1 run, P2 actor, P3 session, P4 tab, P5 verified epoch, P6 current node
-- execution, P7 resolved explicit Agent ID or NULL for coordinator, P8 text,
-- P9 message ID, P10 inbox ID. Hold config/run locks and bind the resolved scope.
PREPARE send_chat_message (uuid,uuid,uuid,uuid,bigint,uuid,uuid,text,uuid,uuid) AS
WITH destination AS (
    SELECT t.id,t.run_id,a.session_ref
    FROM node_execution n JOIN role_task t ON t.execution_id = n.id
    JOIN task_attempt a ON (a.task_id,a.attempt_number) = (t.id,t.current_attempt)
    JOIN run r ON r.id = n.run_id
    WHERE n.id = $6 AND n.run_id = $1 AND n.started_at IS NOT NULL AND n.state IN ('running','waiting_reply')
      AND r.finished_at IS NULL AND t.kind IN ('agent','coordinator')
      AND (($7 IS NULL AND t.role = 'coordinator') OR ($7 IS NOT NULL AND t.agent_id = $7))
      AND a.state IN ('leased','running','waiting_reply') AND a.session_ref IS NOT NULL
      AND holds_active_chat($1,$2,$3,$4,$5)
), sent AS (
    INSERT INTO chat_message (id,run_id,message_type,actor_account_id,target_task_id,body)
    SELECT $9,run_id,'message',$2,id,$8 FROM destination
    RETURNING id,run_id,target_task_id,body
)
INSERT INTO agent_inbox (id,run_id,task_id,session_ref,kind,payload,delivery_state)
SELECT $10,m.run_id,m.target_task_id,d.session_ref,'message',
       jsonb_build_object('chatMessageId',m.id,'text',m.body),'pending'
FROM sent m JOIN destination d ON d.id = m.target_task_id
RETURNING id,run_id,task_id;

-- UC-05/08. P1 authenticated device, P2 validated batch cap, P3 lease seconds.
PREPARE claim_tasks (uuid,integer,integer) AS
SELECT * FROM claim_device_tasks($1,$2,$3);

-- P1 server-authorized run, P2 node filter, P3 task filter, P4/P5 exclusive
-- cursor pair or both NULL, P6 page cap (one extra row may indicate continuation).
-- Recheck current board read permission each page. Do not reuse chat-only access.
PREPARE read_run_attempt_history (uuid,uuid,uuid,uuid,integer,integer) AS
SELECT t.id AS task_id,a.attempt_id,a.attempt_number,t.kind,a.state,
       CASE WHEN n.id IS NULL OR n.started_at IS NOT NULL THEN t.requirement_revision END AS input_requirement_revision,
       (n.id IS NULL OR n.started_at IS NOT NULL) AND t.requirement_revision < r.current_revision AS based_on_older_requirement_revision,
       n.node_id,n.wave,t.agent_id AS role_id,v.display_name AS role_display_name,a.reason_code,a.disposition,
       ARRAY(SELECT f.id FROM artifact f WHERE f.run_id = r.id AND f.attempt_id = a.attempt_id ORDER BY f.id) AS artifact_ids
FROM run r JOIN role_task t ON t.run_id = r.id
JOIN task_attempt a ON a.task_id = t.id
LEFT JOIN node_execution n ON n.id = t.execution_id
LEFT JOIN agent_version v ON (v.agent_id,v.version) = (t.agent_id,t.agent_version)
WHERE r.id = $1 AND ($2 IS NULL OR n.node_id = $2) AND ($3 IS NULL OR t.id = $3)
  AND (($4 IS NULL AND $5 IS NULL) OR (t.id,a.attempt_number) > ($4,$5))
ORDER BY t.id,a.attempt_number
LIMIT LEAST(GREATEST($6,0),101);

-- P1 authenticated device, P2 allowed Codex status. Device is looked up by its bearer digest before calling.
PREPARE mark_device_present (uuid,text) AS
UPDATE device SET last_seen_at = statement_timestamp(),codex_status = $2
WHERE id = $1 AND revoked_at IS NULL
RETURNING id,last_seen_at;

-- P1 device, P2 task, P3 attempt UUID, P4 epoch, P5 duration in seconds.
PREPARE renew_task (uuid,uuid,uuid,bigint,integer) AS
UPDATE task_attempt a SET lease_deadline = statement_timestamp() + make_interval(secs => $5)
FROM role_task t JOIN run r ON r.id = t.run_id JOIN device d ON d.id = t.device_id
WHERE t.id = $2 AND a.task_id = t.id AND t.current_attempt = a.attempt_number
  AND a.device_id = $1 AND a.attempt_id = $3 AND a.lease_epoch = $4 AND a.lease_deadline > statement_timestamp()
  AND a.state IN ('leased','running') AND $5 > 0 AND d.revoked_at IS NULL AND r.finished_at IS NULL
RETURNING a.task_id,a.attempt_id,a.lease_epoch,a.lease_deadline;

-- P1 device, P2 task, P3 attempt UUID, P4 epoch, P5 event seq, P6 event type,
-- P7 event UUID, P8 request key, P9 checkpoint or NULL, P10 session ref or NULL,
-- P11 safe failure code or NULL. Hold the run row before event acceptance.
-- Read a prior accepted receipt before fencing so a transport replay stays idempotent.
PREPARE accept_task_event (uuid,uuid,uuid,bigint,bigint,text,uuid,text,jsonb,text,text) AS
WITH accepted AS (
    UPDATE task_attempt a SET
        last_event_sequence = $5,
        state = CASE WHEN $6 IN ('progress','message') THEN 'running' WHEN $6 = 'question' THEN 'waiting_reply'
                         WHEN $6 = 'complete' THEN 'succeeded' ELSE 'failed' END,
        checkpoint = coalesce(a.checkpoint,'{}'::jsonb) || coalesce($9,'{}'::jsonb),
        session_ref = coalesce(a.session_ref,$10),reason_code = $11
    FROM role_task t JOIN run r ON r.id = t.run_id JOIN device d ON d.id = t.device_id
    WHERE t.id = $2 AND a.task_id = t.id AND t.current_attempt = a.attempt_number
      AND a.device_id = $1 AND a.attempt_id = $3 AND a.lease_epoch = $4
      AND a.lease_deadline > statement_timestamp() AND a.state IN ('leased','running')
      AND $5 = a.last_event_sequence + 1 AND $6 IN ('progress','message','question','complete','failure')
      AND ($10 IS NULL OR a.session_ref IS NULL OR a.session_ref = $10)
      AND ($6 NOT IN ('question','message') OR coalesce(a.session_ref,$10) IS NOT NULL)
      AND r.finished_at IS NULL AND d.revoked_at IS NULL
    RETURNING a.task_id,a.attempt_number
)
INSERT INTO task_event (id,task_id,attempt_number,lease_epoch,event_sequence,event_type,request_key)
SELECT $7,task_id,attempt_number,$4,$5,$6,$8 FROM accepted
RETURNING id,task_id,attempt_number;

-- P1 message ID, P2 accepted event ID, P3 session, P4 body, P5 inbox reply ID
-- or NULL. Persist with accept_task_event and roll back the event if this fails.
PREPARE record_agent_message (uuid,uuid,text,text,uuid) AS
INSERT INTO chat_message (id,run_id,message_type,actor_task_id,source_event_id,in_reply_to_inbox_id,body)
SELECT $1,t.run_id,'message',t.id,e.id,$5,$4
FROM task_event e
JOIN role_task t ON t.id = e.task_id AND t.current_attempt = e.attempt_number
JOIN task_attempt a ON (a.task_id,a.attempt_number) = (e.task_id,e.attempt_number)
WHERE e.id = $2 AND e.event_type = 'message' AND a.session_ref = $3
  AND t.kind IN ('agent','coordinator')
  AND ($5 IS NULL OR EXISTS (
      SELECT 1 FROM agent_inbox i WHERE i.id = $5 AND i.run_id = t.run_id
        AND i.task_id = t.id AND i.session_ref = a.session_ref
  ))
RETURNING id,run_id,actor_task_id,source_event_id;

-- P1 question ID, P2 accepted question event, P3 question body.
-- Must be in the same transaction as accept_task_event for a question.
PREPARE record_question (uuid,uuid,text) AS
INSERT INTO agent_question (id,run_id,task_id,attempt_id,source_event_id,session_ref,body)
SELECT $1,t.run_id,t.id,a.attempt_id,e.id,a.session_ref,$3
FROM task_event e
JOIN role_task t ON t.id = e.task_id AND t.current_attempt = e.attempt_number
JOIN task_attempt a ON a.task_id = e.task_id AND a.attempt_number = e.attempt_number
WHERE e.id = $2 AND e.event_type = 'question' AND a.state = 'waiting_reply'
RETURNING id,task_id;

-- P1 run, P2 question, P3 actor, P4 session, P5 tab, P6 verified epoch,
-- P7 reply/cancel, P8 answer or NULL, P9 inbox ID.
-- Hold requirement and run rows. Locking the question and unique resolution/inbox
-- make simultaneous replies and cancellation mutually exclusive.
PREPARE resolve_question (uuid,uuid,uuid,uuid,uuid,bigint,text,text,uuid) AS
WITH question AS (
    SELECT q.id,q.run_id,q.task_id,q.attempt_id,q.session_ref
    FROM agent_question q JOIN run r ON r.id = q.run_id
    JOIN role_task t ON t.id = q.task_id
    JOIN task_attempt a ON a.task_id = t.id AND a.attempt_number = t.current_attempt AND a.attempt_id = q.attempt_id
    WHERE q.id = $2 AND q.run_id = $1 AND holds_active_chat($1,$3,$4,$5,$6)
      AND r.finished_at IS NULL AND a.state = 'waiting_reply'
      AND ($7 = 'reply' OR ($7 = 'cancel' AND r.initiator_id = $3))
    FOR UPDATE OF q
), resolved AS (
    INSERT INTO question_resolution (question_id,actor_id,action,answer)
    SELECT id,$3,$7,$8 FROM question ON CONFLICT (question_id) DO NOTHING
    RETURNING question_id
), enqueued AS (
    INSERT INTO agent_inbox (id,run_id,task_id,session_ref,kind,question_id,payload,delivery_state)
    SELECT $9,q.run_id,q.task_id,q.session_ref,
       CASE $7 WHEN 'reply' THEN 'answer' ELSE 'continue_without_answer' END,
       q.id,CASE $7 WHEN 'reply' THEN jsonb_build_object('text',$8) ELSE '{}'::jsonb END,'pending'
    FROM question q JOIN resolved x ON x.question_id = q.id RETURNING id,task_id
), resumed AS (
    UPDATE task_attempt a SET state = 'queued',available_at = statement_timestamp(),lease_epoch = NULL,lease_deadline = NULL
    FROM enqueued m JOIN question q ON q.task_id = m.task_id
    WHERE a.task_id = m.task_id AND a.attempt_id = q.attempt_id AND a.state = 'waiting_reply'
    RETURNING a.task_id
)
SELECT e.id,e.task_id FROM enqueued e JOIN resumed x ON x.task_id = e.task_id;

-- P1 run, P2 failed role task, P3 actor, P4 session, P5 tab, P6 epoch, P7 new attempt UUID.
-- Hold requirement and run. The original failed row and successful siblings remain.
PREPARE retry_failed_role (uuid,uuid,uuid,uuid,uuid,bigint,uuid) AS
WITH advance AS (
    UPDATE role_task t SET current_attempt = t.current_attempt + 1
    FROM task_attempt a,run r
    WHERE t.id = $2 AND t.run_id = $1 AND r.id = t.run_id AND r.finished_at IS NULL
      AND t.kind IN ('agent','coordinator') AND a.task_id = t.id AND a.attempt_number = t.current_attempt
      AND a.state = 'failed' AND a.disposition IS NULL AND holds_active_chat($1,$3,$4,$5,$6)
    RETURNING t.id,t.device_id,t.current_attempt
)
INSERT INTO task_attempt (task_id,attempt_number,attempt_id,device_id,state,available_at)
SELECT id,current_attempt,$7,device_id,'queued',statement_timestamp() FROM advance
RETURNING task_id,attempt_number,attempt_id;

-- P1 run, P2 role task, P3 actor, P4 session, P5 tab, P6 verified epoch.
-- Preserve the failed state. Persist the disposition, receipt and audit in one
-- transaction under the run lock. Final artifact/role-dependency checks still apply.
PREPARE skip_failed_role (uuid,uuid,uuid,uuid,uuid,bigint) AS
UPDATE task_attempt a SET disposition = 'skipped',disposed_by = $3,disposed_at = statement_timestamp()
FROM role_task t JOIN run r ON r.id = t.run_id
WHERE t.id = $2 AND t.run_id = $1 AND r.finished_at IS NULL AND t.kind IN ('agent','coordinator')
  AND (a.task_id,a.attempt_number) = (t.id,t.current_attempt) AND a.state = 'failed' AND a.disposition IS NULL
  AND holds_active_chat($1,$3,$4,$5,$6)
RETURNING a.task_id,a.attempt_number,a.disposition;

-- P1 run, P2 active BRD execution, P3 proposal ID, P4 actor, P5 session, P6 tab,
-- P7 verified epoch, P8 expected run revision, P9 expected source config version,
-- P10 title, P11 server-normalized title key, P12 description. Hold configuration
-- and run in separate preceding statements. This persists no effective revision.
PREPARE create_run_change (uuid,uuid,uuid,uuid,uuid,uuid,bigint,bigint,bigint,text,text,text) AS
INSERT INTO requirement_change (id,run_id,execution_id,proposed_by,based_on_revision,based_on_requirement_version,
                                proposed_title,proposed_name_key,proposed_description,state)
SELECT $3,r.id,n.id,$4,$8,$9,$10,$11,$12,'pending'
FROM run r JOIN configuration q ON q.id = r.requirement_id
JOIN node_execution n ON n.id = $2 AND n.run_id = r.id
JOIN workflow_node w ON (w.workflow_id,w.workflow_version,w.node_id) = (n.workflow_id,n.workflow_version,n.node_id)
WHERE r.id = $1 AND r.finished_at IS NULL AND r.current_revision = $8 AND q.version = $9
  AND n.started_at IS NOT NULL AND n.state IN ('running','waiting_reply') AND w.purpose = 'requirement'
  AND holds_active_chat(r.id,$4,$5,$6,$7)
RETURNING id,run_id,execution_id,based_on_revision,based_on_requirement_version;

-- P1 run, P2 proposal, P3 actor, P4 session, P5 tab, P6 verified epoch, P7 expected
-- effective revision, P8 expected source config version. Lock configuration then
-- run in earlier statements. Persist audit and command receipt in the same transaction.
PREPARE confirm_run_change (uuid,uuid,uuid,uuid,uuid,bigint,bigint,bigint) AS
WITH candidate AS (
    SELECT c.id,c.run_id,c.proposed_title,c.proposed_name_key,c.proposed_description,
           r.current_revision + 1 AS next_revision,q.id AS requirement_id
    FROM requirement_change c JOIN run r ON r.id = c.run_id
    JOIN configuration q ON q.id = r.requirement_id
    JOIN node_execution n ON n.id = c.execution_id AND n.run_id = r.id
    JOIN workflow_node w ON (w.workflow_id,w.workflow_version,w.node_id) = (n.workflow_id,n.workflow_version,n.node_id)
    WHERE c.id = $2 AND c.run_id = $1 AND c.state = 'pending' AND r.finished_at IS NULL
      AND c.based_on_revision = $7 AND r.current_revision = $7 AND c.based_on_requirement_version = $8
      AND q.version = $8 AND r.initiator_id = $3
      AND n.started_at IS NOT NULL AND n.state IN ('running','waiting_reply') AND w.purpose = 'requirement'
      AND holds_active_chat($1,$3,$4,$5,$6)
    FOR UPDATE OF c
), versioned AS (
    UPDATE configuration q SET version = q.version + 1,updated_at = statement_timestamp()
    FROM candidate c WHERE q.id = c.requirement_id AND q.version = $8
    RETURNING q.id,q.version
), source AS (
    UPDATE requirement q SET name = c.proposed_title,name_key = c.proposed_name_key,description = c.proposed_description
    FROM candidate c JOIN versioned v ON v.id = c.requirement_id WHERE q.id = v.id
    RETURNING q.id,v.version,q.name,q.description
), revision AS (
    INSERT INTO run_requirement_revision (run_id,revision,requirement_version,title,description,recorded_by)
    SELECT c.run_id,c.next_revision,s.version,s.name,s.description,$3
    FROM candidate c JOIN source s ON s.id = c.requirement_id
    RETURNING run_id,revision
), changed AS (
    UPDATE requirement_change c SET state = 'confirmed',effective_revision = v.revision,
        confirmed_by = $3,confirmed_at = statement_timestamp()
    FROM candidate p JOIN revision v ON v.run_id = p.run_id WHERE c.id = p.id
    RETURNING c.id,c.run_id,c.effective_revision
)
UPDATE run r SET current_revision = c.effective_revision,state_version = r.state_version + 1
FROM changed c WHERE r.id = c.run_id
RETURNING r.id,r.current_revision,c.id AS change_id;

-- UC-07. P1 run, P2 original check node, P3 current wave, P4 accepted completion
-- event ID, P5 pass/repair/unresolved, P6 checked commit, P7 report artifact,
-- P8 reason, P9 exact immutable checked candidate reference.
-- Hold the run. The result event and any report artifact are written in this tx.
PREPARE complete_check_wave (uuid,uuid,integer,uuid,text,text,uuid,text,text) AS
WITH eligible AS (
    SELECT c.run_id,c.check_node_id,c.current_wave
    FROM check_cycle c
    JOIN run r ON r.id = c.run_id
    JOIN node_execution n ON n.run_id = c.run_id AND n.node_id = c.check_node_id AND n.wave = c.current_wave
    JOIN role_task t ON t.execution_id = n.id AND t.kind = 'coordinator'
    JOIN task_event e ON e.task_id = t.id AND e.attempt_number = t.current_attempt
    WHERE c.run_id = $1 AND c.check_node_id = $2 AND c.current_wave = $3
      AND c.state = 'pending' AND r.finished_at IS NULL AND e.id = $4 AND e.event_type = 'complete'
      AND $5 IN ('pass','repair','unresolved')
      AND ($5 = 'unresolved' OR EXISTS (
          SELECT 1 FROM artifact a WHERE a.id = $7 AND a.run_id = r.id AND a.execution_id = n.id
            AND a.requirement_revision = n.requirement_revision AND a.kind = 'test'
            AND a.commit_id = $6 AND a.candidate_ref = $9 AND a.mode = r.mode
            AND ($5 <> 'pass' OR a.test_outcome = 'passed')
      ))
), recorded AS (
    UPDATE check_wave w SET outcome = $5,checked_commit = $6,checked_artifact_version = $9,
        report_artifact_id = $7,reason_code = $8,
        completed_at = statement_timestamp()
    FROM eligible c WHERE (w.run_id,w.check_node_id,w.wave) = (c.run_id,c.check_node_id,c.current_wave)
      AND w.outcome = 'pending'
    RETURNING w.run_id,w.check_node_id,w.wave,w.outcome
)
UPDATE check_cycle c SET state = w.outcome
FROM recorded w WHERE (c.run_id,c.check_node_id,c.current_wave) = (w.run_id,w.check_node_id,w.wave)
RETURNING c.run_id,c.check_node_id,c.current_wave,c.state;

-- P1 run, P2 check node. Internal scheduler after a verified repair outcome.
-- Lock run in a preceding statement in the same Read Committed transaction.
PREPARE mark_repair_limit (uuid,uuid) AS
UPDATE check_cycle c SET state = 'limit_reached'
FROM workflow_check w,check_wave v
WHERE c.run_id = $1 AND c.check_node_id = $2 AND c.state = 'repair'
  AND (w.workflow_id,w.workflow_version,w.check_node_id) = (c.workflow_id,c.workflow_version,c.check_node_id)
  AND (v.run_id,v.check_node_id,v.wave) = (c.run_id,c.check_node_id,c.current_wave)
  AND v.outcome = 'repair' AND c.automatic_repair_count >= w.automatic_repair_limit
  AND NOT EXISTS (SELECT 1 FROM repair_round rr
                  WHERE (rr.run_id,rr.check_node_id,rr.triggering_wave) = (c.run_id,c.check_node_id,c.current_wave))
RETURNING c.run_id,c.check_node_id,c.current_wave;

-- P1 run, P2 original check, P3 automatic/manual, P4 actor or NULL, P5 session,
-- P6 tab, P7 epoch. Hold the run, and for a human command also the configuration.
-- A manual round follows limit_reached and does not reset automatic counts.
PREPARE queue_repair_round (uuid,uuid,text,uuid,uuid,uuid,bigint) AS
WITH advanced AS (
    UPDATE check_cycle c SET
        automatic_repair_count = c.automatic_repair_count + CASE WHEN $3 = 'automatic' THEN 1 ELSE 0 END,
        manual_repair_count = c.manual_repair_count + CASE WHEN $3 = 'manual' THEN 1 ELSE 0 END,
        state = 'repair'
    FROM workflow_check w,run r,check_wave v
    WHERE c.run_id = $1 AND c.check_node_id = $2 AND r.id = c.run_id AND r.finished_at IS NULL
      AND (w.workflow_id,w.workflow_version,w.check_node_id) = (c.workflow_id,c.workflow_version,c.check_node_id)
      AND (v.run_id,v.check_node_id,v.wave) = (c.run_id,c.check_node_id,c.current_wave) AND v.outcome = 'repair'
      AND NOT EXISTS (SELECT 1 FROM repair_round rr
                      WHERE (rr.run_id,rr.check_node_id,rr.triggering_wave) = (c.run_id,c.check_node_id,c.current_wave))
      AND (($3 = 'automatic' AND $4 IS NULL AND c.state = 'repair' AND c.automatic_repair_count < w.automatic_repair_limit)
        OR ($3 = 'manual' AND check_action_is_available($1,$2,'limit_reached') AND holds_active_chat($1,$4,$5,$6,$7)))
    RETURNING c.run_id,c.check_node_id,c.current_wave,c.automatic_repair_count,c.manual_repair_count
)
INSERT INTO repair_round (run_id,check_node_id,round_number,triggering_wave,kind,authorized_by,state)
SELECT run_id,check_node_id,automatic_repair_count + manual_repair_count,current_wave,$3,$4,'queued'
FROM advanced
RETURNING run_id,check_node_id,round_number,triggering_wave;

-- P1 run, P2 original check, P3 new node-execution ID, P4 actor or NULL, P5 session,
-- P6 tab, P7 epoch. The scheduler passes NULL actor only for a completed repair.
-- An unresolved conclusion always requires a valid active chat command.
PREPARE begin_recheck (uuid,uuid,uuid,uuid,uuid,uuid,bigint) AS
WITH advanced AS (
    UPDATE check_cycle c SET current_wave = c.current_wave + 1,state = 'pending'
    FROM run r WHERE c.run_id = $1 AND c.check_node_id = $2 AND r.id = c.run_id AND r.finished_at IS NULL
      AND ((c.state = 'repair' AND $4 IS NULL AND EXISTS (
          SELECT 1 FROM repair_round rr
          WHERE (rr.run_id,rr.check_node_id,rr.triggering_wave) = (c.run_id,c.check_node_id,c.current_wave)
            AND rr.state = 'complete'
      )) OR (check_action_is_available($1,$2,'unresolved') AND holds_active_chat($1,$4,$5,$6,$7)))
    RETURNING c.run_id,c.check_node_id,c.current_wave,c.workflow_id,c.workflow_version,r.current_revision,
        CASE WHEN $4 IS NULL THEN (SELECT rr.round_number FROM repair_round rr
            WHERE (rr.run_id,rr.check_node_id,rr.triggering_wave)=(c.run_id,c.check_node_id,c.current_wave-1))
        ELSE (SELECT v.recheck_of_round FROM check_wave v
            WHERE (v.run_id,v.check_node_id,v.wave)=(c.run_id,c.check_node_id,c.current_wave-1)) END AS source_round
), execution AS (
    INSERT INTO node_execution (id,run_id,workflow_id,workflow_version,node_id,wave,requirement_revision,state)
    SELECT $3,run_id,workflow_id,workflow_version,check_node_id,current_wave,current_revision,'ready'
    FROM advanced RETURNING run_id,node_id,wave,requirement_revision
)
INSERT INTO check_wave (run_id,check_node_id,wave,requirement_revision,outcome,recheck_of_round)
SELECT e.run_id,e.node_id,e.wave,e.requirement_revision,'pending',a.source_round FROM execution e CROSS JOIN advanced a
RETURNING run_id,check_node_id,wave;

-- P1 run, P2 blocked check, P3 actor, P4 session, P5 tab, P6 epoch.
-- The scheduler updates any other scoped pending states, records a receipt and
-- appends audit in the same transaction. Actual external effects need reconciliation.
PREPARE stop_at_repair_limit (uuid,uuid,uuid,uuid,uuid,bigint) AS
WITH stopped AS (
    UPDATE run r SET state = 'stopped',finished_at = statement_timestamp(),state_version = r.state_version + 1
    WHERE r.id = $1 AND r.finished_at IS NULL AND holds_active_chat($1,$3,$4,$5,$6)
      AND EXISTS (SELECT 1 FROM check_cycle c WHERE c.run_id = r.id AND c.check_node_id = $2 AND c.state = 'limit_reached')
    RETURNING r.id
), stopped_check AS (
    UPDATE check_cycle c SET state = 'stopped'
    FROM stopped r WHERE c.run_id = r.id AND c.check_node_id = $2
    RETURNING c.run_id
)
SELECT id FROM stopped;

-- Publication. P1 gate ID, P2 run, P3 current candidate commit, P4 immutable
-- artifact version, P5 target key. Called under run lock. The policy engine must
-- persist the actual required-check set and applicable test/approval policy.
PREPARE verify_publication_gate (uuid,uuid,text,text,text) AS
SELECT g.id,g.target_ref,g.artifact_version,g.policy_ref
FROM publication_gate g JOIN run r ON r.id = g.run_id
WHERE g.id = $1 AND r.id = $2 AND publication_gate_valid(g.id,r.id,$3,$4,$5)
FOR UPDATE OF g;

-- External changes. P1 operation ID, P2 authenticated device, P3 task, P4 attempt ID,
-- P5 epoch, P6 exact effect, P7 exact target, P8 cutoff for short authorization,
-- P9 verified gate ID or NULL, P10 candidate commit or NULL for non-publication.
-- Before dispatch acquire the same config and run locks, validate the policy,
-- verify_publication_gate for publication, and reserve the operation receipt.
-- The run lock must be acquired in an earlier statement in Read Committed.
-- Only explicit effect+target authorization may enter dispatching. Unknown work
-- must be reconciled; it cannot obtain an ordinary dispatch authorization.
PREPARE authorize_external_effect (uuid,uuid,uuid,uuid,bigint,text,text,timestamptz,uuid,text) AS
WITH admitted AS (
    UPDATE external_operation o SET state = 'dispatching',last_authorized_task_id = t.id,
        last_authorized_epoch = a.lease_epoch,authorization_deadline = least($8,a.lease_deadline,g.expires_at)
    FROM role_task t JOIN run r ON r.id = t.run_id JOIN device d ON d.id = r.device_id
    JOIN task_attempt a ON a.task_id = t.id AND a.attempt_number = t.current_attempt
    JOIN run_external_grant g ON g.run_id = r.id AND g.effect = $6 AND g.target_key = $7
    LEFT JOIN node_execution n ON n.id = t.execution_id
    WHERE o.id = $1 AND o.effect = $6 AND o.target_key = $7 AND o.state = 'intended'
      AND o.requirement_id = r.requirement_id AND (o.run_id IS NULL OR o.run_id = r.id)
      AND o.mode = 'codex' AND r.mode = 'codex' AND t.id = $3 AND t.device_id = $2 AND d.revoked_at IS NULL
      AND a.attempt_id = $4 AND a.lease_epoch = $5 AND a.lease_deadline > statement_timestamp()
      AND a.state IN ('leased','running') AND r.finished_at IS NULL
      AND task_route_is_open(r.id,n.node_id)
      AND g.revoked_at IS NULL AND g.expires_at > statement_timestamp() AND $8 > statement_timestamp()
      AND (($6 IN ('create_repository','create_base_branch','create_work_branch') AND t.kind = 'git')
        OR ($6 = 'push_code' AND t.kind = 'coordinator')
        OR ($6 = 'dispatch_publication' AND t.kind = 'publish'))
      AND ($6 <> 'dispatch_publication' OR EXISTS (
          SELECT 1 FROM publication_gate pg WHERE pg.id = $9 AND pg.id = o.publication_gate_id
            AND pg.run_id = r.id AND pg.execution_id = t.execution_id AND pg.policy_ref = g.policy_ref
            AND publication_gate_valid(pg.id,r.id,$10,o.artifact_version,o.target_key)
      ))
    RETURNING o.id,o.operation_key,o.last_authorized_task_id,o.authorization_deadline
), scoped AS (
    INSERT INTO external_operation_task (operation_id,task_id)
    SELECT id,last_authorized_task_id FROM admitted ON CONFLICT DO NOTHING RETURNING operation_id
)
SELECT id,operation_key,authorization_deadline FROM admitted;

-- P1 operation ID, P2 authorized task, P3 attempt ID, P4 epoch, P5 evidence ID,
-- P6 observed outcome, P7 provider result ID, P8 repository, P9 branch, P10 commit,
-- P11 target key, P12 artifact version, P13 observed timestamp, P14 authenticated device.
-- Bind these values only after the provider adapter has independently verified the
-- result and its scope. Hold config/run then operation. A scoped reconciliation
-- task may report evidence without authorizing a second external dispatch.
PREPARE record_external_observation (uuid,uuid,uuid,bigint,uuid,text,text,uuid,text,text,text,text,timestamptz,uuid) AS
WITH verified AS (
    SELECT o.id,o.mode
    FROM external_operation o
    JOIN external_operation_task x ON x.operation_id = o.id AND x.task_id = $2
    JOIN role_task t ON t.id = x.task_id
    JOIN run r ON r.id = t.run_id AND r.requirement_id = o.requirement_id
    JOIN device d ON d.id = t.device_id
    JOIN task_attempt a ON a.task_id = t.id AND a.attempt_number = t.current_attempt
    WHERE o.id = $1 AND o.state IN ('dispatching','unknown')
      AND (o.run_id IS NULL OR o.run_id = r.id) AND o.mode = r.mode
      AND a.attempt_id = $3 AND a.lease_epoch = $4 AND a.lease_deadline > statement_timestamp()
      AND a.state IN ('leased','running') AND d.id = $14 AND d.revoked_at IS NULL
      AND (t.kind = 'reconcile' OR (o.last_authorized_task_id = t.id AND o.last_authorized_epoch = $4))
      AND $6 IN ('confirmed_success','confirmed_failure','unknown')
      AND ($6 <> 'confirmed_success' OR ($7 IS NOT NULL AND $11 = o.target_key
          AND (o.effect <> 'create_repository' OR $8 IS NOT NULL)
          AND (o.effect <> 'dispatch_publication' OR $12 = o.artifact_version)))
    FOR UPDATE OF o
), evidence AS (
    INSERT INTO operation_evidence (id,operation_id,source_task_id,outcome,provider_result_id,repository_id,
                                    observed_branch,observed_commit,observed_target,observed_artifact_version,observed_at)
    SELECT $5,id,$2,$6,$7,$8,$9,$10,$11,$12,$13 FROM verified
    RETURNING id,operation_id,outcome,provider_result_id
)
UPDATE external_operation o SET
    state = CASE e.outcome WHEN 'confirmed_success' THEN 'succeeded' WHEN 'confirmed_failure' THEN 'failed' ELSE 'unknown' END,
    provider_result_id = coalesce(e.provider_result_id,o.provider_result_id)
FROM evidence e WHERE o.id = e.operation_id
RETURNING o.id,o.state,e.id AS evidence_id;

-- P1 requirement, P2 confirmed repository operation, P3 evidence. Hold the
-- configuration row. The first confirmed real result links the repository and
-- advances configuration version. Demo evidence never alters the requirement.
PREPARE link_confirmed_repository (uuid,uuid,uuid) AS
WITH linked AS (
    UPDATE requirement q SET repository_id = e.repository_id
    FROM external_operation o JOIN operation_evidence e ON e.operation_id = o.id
    WHERE q.id = $1 AND o.id = $2 AND e.id = $3 AND o.requirement_id = q.id AND o.mode = 'codex'
      AND o.effect = 'create_repository' AND o.state = 'succeeded'
      AND e.outcome = 'confirmed_success' AND e.repository_id IS NOT NULL AND q.repository_id IS NULL
    RETURNING q.id,q.repository_id
)
UPDATE configuration c SET version = c.version + 1,updated_at = statement_timestamp()
FROM linked q WHERE c.id = q.id
RETURNING c.id,c.version,q.repository_id;

-- P1 run, P2 operation, P3 evidence, P4 expected base branch, P5 work branch,
-- P6 verified base commit. The adapter verifies actual branch ancestry. Hold run.
-- Git preparation stops at waiting until node dispatch is implemented; completing
-- Git is not completing the workflow. The run pins the observed default branch.
PREPARE attach_confirmed_git (uuid,uuid,uuid,text,text,text) AS
UPDATE run r SET repository_id = e.repository_id,base_branch = $4,work_branch = $5,
    base_commit = $6,git_default_branch = p.default_branch,state = 'waiting',
    reason_code = 'AGENT_EXECUTION_PENDING',state_version = r.state_version + 1
FROM external_operation o JOIN operation_evidence e ON e.operation_id = o.id
JOIN repository p ON p.id = e.repository_id
WHERE r.id = $1 AND r.finished_at IS NULL AND o.id = $2 AND e.id = $3
  AND o.effect = 'create_work_branch' AND o.state = 'succeeded' AND o.run_id = r.id AND o.mode = r.mode
  AND e.outcome = 'confirmed_success' AND e.repository_id IS NOT NULL AND e.observed_branch = $5
  AND e.observed_commit = $6 AND (r.repository_id IS NULL OR r.repository_id = e.repository_id)
RETURNING r.id,r.state_version;

-- P1 run, P2 operation, P3 evidence ID, P4 publication artifact ID, P5 task,
-- P6 attempt ID, P7 title, P8 immutable evidence ref. Hold run. Attach only to
-- the exact publish execution after provider verification and before completing node.
PREPARE attach_confirmed_publication (uuid,uuid,uuid,uuid,uuid,uuid,text,text) AS
INSERT INTO artifact (id,run_id,execution_id,task_id,attempt_id,requirement_revision,
                      kind,mode,title,source_ref,commit_id,candidate_ref)
SELECT $4,r.id,g.execution_id,$5,$6,g.requirement_revision,'publication',r.mode,$7,$8,g.candidate_commit,g.artifact_version
FROM run r JOIN publication_gate g ON g.run_id = r.id
JOIN external_operation o ON o.publication_gate_id = g.id AND o.run_id = r.id
JOIN operation_evidence e ON e.operation_id = o.id
JOIN role_task t ON t.id = $5 AND t.execution_id = g.execution_id AND t.kind = 'publish'
WHERE r.id = $1 AND o.id = $2 AND e.id = $3 AND r.finished_at IS NULL AND o.mode = r.mode
  AND o.state = 'succeeded' AND e.outcome = 'confirmed_success'
  AND e.observed_target = g.target_ref AND e.observed_artifact_version = g.artifact_version
  AND e.observed_commit = g.candidate_commit
RETURNING id,execution_id;

-- P1 run, P2 artifact, P3 authenticated approver, P4 reviewed commit,
-- P5 approval time of the exact failed record for a retry, otherwise NULL.
-- Hold configuration and run. Verify browser session and current owner first.
PREPARE approve_artifact_archive (uuid,uuid,uuid,text,timestamptz) AS
INSERT INTO artifact_archive(artifact_id,run_id,device_id,approved_by)
SELECT a.id,r.id,r.device_id,$3
FROM run r JOIN artifact a ON a.run_id=r.id
JOIN node_execution e ON e.id=a.execution_id
JOIN role_task t ON t.id=a.task_id
JOIN task_attempt q ON q.attempt_id=a.attempt_id AND q.task_id=t.id
WHERE (r.id,a.id,r.initiator_id,a.commit_id)=($1,$2,$3,$4)
  AND r.state='completed' AND t.kind='coordinator' AND q.state='succeeded'
  AND e.state='complete' AND a.content_digest IS NOT NULL
  AND e.wave=(SELECT max(x.wave) FROM node_execution x WHERE (x.run_id,x.node_id)=(e.run_id,e.node_id))
ON CONFLICT(artifact_id) DO UPDATE SET state='queued',approved_by=excluded.approved_by,
    approved_at=statement_timestamp(),available_at=statement_timestamp(),reason_code=NULL,epoch=NULL,lease_until=NULL
WHERE artifact_archive.state='failed' AND artifact_archive.export_commit IS NULL
  AND artifact_archive.approved_at=$5
  AND artifact_archive.reason_code IN ('ARCHIVE_SOURCE_UNAVAILABLE','ARCHIVE_TARGET_UNAVAILABLE','ARCHIVE_GRANT_REQUIRED')
RETURNING artifact_id,run_id,device_id;

-- P1 artifact, P2 authenticated device, P3 lease epoch, P4 snapshot commit.
-- Hold configuration, run and archive. Recheck owner, device and eligibility
-- before issuing a bounded create-only grant. An already-pinned commit is read-only.
PREPARE pin_artifact_archive_export (uuid,uuid,bigint,text) AS
UPDATE artifact_archive SET export_commit=$4
WHERE (artifact_id,device_id,epoch)=($1,$2,$3) AND state='leased'
  AND lease_until>clock_timestamp() AND approved_at>clock_timestamp()-interval '24 hours'
  AND export_commit IS NULL
RETURNING artifact_id,export_commit,least(lease_until,approved_at+interval '24 hours',
    clock_timestamp()+interval '25 seconds') AS expires_at;

-- P1 artifact, P2 authenticated device, P3 lease epoch, P4 observed commit.
-- Validate the exact read-back tag before calling. Update run version in the same
-- transaction; duplicate success is handled by reading the confirmed row.
PREPARE confirm_artifact_archive (uuid,uuid,bigint,text) AS
UPDATE artifact_archive SET state='succeeded',reason_code=NULL,confirmed_at=statement_timestamp()
WHERE (artifact_id,device_id,epoch,export_commit)=($1,$2,$3,$4)
  AND state='leased' AND lease_until>clock_timestamp()
RETURNING artifact_id,run_id,confirmed_at;

-- Audit. P1 event, P2 correlation ID, P3 authenticated account or NULL,
-- P4 authenticated device or NULL, P5 run or NULL, P6 target kind, P7 target,
-- P8 action, P9 outcome, P10 safe reason code. Commit with the command.
PREPARE append_audit (uuid,text,uuid,uuid,uuid,text,uuid,text,text,text) AS
INSERT INTO audit_event (id,request_id,actor_account_id,actor_device_id,run_id,target_kind,target_id,action,outcome,reason_code)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
RETURNING id;
