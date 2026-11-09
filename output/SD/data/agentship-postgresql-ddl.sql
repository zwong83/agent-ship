-- SD-D01 to SD-D03. Proposed PostgreSQL design. Use a fresh disposable database.
-- This is an initial schema draft. No production roles, grants, imports or connection settings.
BEGIN;
CREATE SCHEMA agentship_design;
SET LOCAL search_path TO agentship_design, pg_catalog;

CREATE TABLE account (
    id uuid PRIMARY KEY,
    display_name text NOT NULL CHECK (btrim(display_name) <> ''),
    username text NOT NULL CHECK (username COLLATE "C" ~ '^[A-Za-z0-9_-]{1,100}$'),
    username_key text NOT NULL UNIQUE CHECK (username_key = lower(username COLLATE "C")),
    email text NOT NULL CHECK (btrim(email) <> ''),
    email_login_key text NOT NULL UNIQUE CHECK (btrim(email_login_key) <> ''),
    phone text NOT NULL UNIQUE CHECK (phone COLLATE "C" ~ '^[+][1-9][0-9]{1,14}$'),
    email_verified_at timestamptz,
    phone_verified_at timestamptz,
    password_hash text NOT NULL CHECK (btrim(password_hash) <> ''),
    status text NOT NULL CHECK (status IN ('pending', 'active', 'revoked')),
    created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
    CHECK (status <> 'active' OR (email_verified_at IS NOT NULL AND phone_verified_at IS NOT NULL))
);

CREATE INDEX account_pending_expiry_idx ON account (created_at,id) WHERE status = 'pending';

CREATE TABLE account_session (
    id uuid PRIMARY KEY,
    account_id uuid NOT NULL REFERENCES account(id),
    token_digest bytea NOT NULL UNIQUE CHECK (octet_length(token_digest) = 32),
    created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
    expires_at timestamptz NOT NULL,
    revoked_at timestamptz,
    UNIQUE (id, account_id),
    CHECK (expires_at > created_at)
);

CREATE INDEX account_session_account_idx ON account_session (account_id, expires_at);

CREATE TABLE project (
    id uuid PRIMARY KEY,
    name text NOT NULL CHECK (btrim(name) <> '')
);

CREATE TABLE project_permission (
    project_id uuid NOT NULL REFERENCES project(id),
    account_id uuid NOT NULL REFERENCES account(id),
    capability text NOT NULL CHECK (capability IN ('view_project', 'create_requirement')),
    granted_by uuid NOT NULL REFERENCES account(id),
    granted_at timestamptz NOT NULL DEFAULT statement_timestamp(),
    expires_at timestamptz,
    revoked_at timestamptz,
    PRIMARY KEY (project_id, account_id, capability),
    CHECK (expires_at IS NULL OR expires_at > granted_at)
);

CREATE TABLE configuration (
    id uuid PRIMARY KEY,
    kind text NOT NULL CHECK (kind IN ('requirement', 'workflow', 'agent')),
    owner_id uuid NOT NULL REFERENCES account(id),
    version bigint NOT NULL CHECK (version >= 1),
    created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT statement_timestamp(),
    UNIQUE (id, kind)
);

CREATE INDEX configuration_owner_idx ON configuration (owner_id, kind, updated_at DESC, id);

CREATE TABLE configuration_deputy (
    configuration_id uuid NOT NULL REFERENCES configuration(id),
    account_id uuid NOT NULL REFERENCES account(id),
    granted_by uuid NOT NULL REFERENCES account(id),
    granted_at timestamptz NOT NULL DEFAULT statement_timestamp(),
    revoked_at timestamptz,
    PRIMARY KEY (configuration_id, account_id)
);

CREATE INDEX configuration_deputy_active_idx ON configuration_deputy (account_id, configuration_id)
    WHERE revoked_at IS NULL;

CREATE TABLE repository (
    id uuid PRIMARY KEY,
    provider text NOT NULL CHECK (btrim(provider) <> ''),
    provider_repository_id text NOT NULL CHECK (btrim(provider_repository_id) <> ''),
    display_name text NOT NULL,
    default_branch text CHECK (default_branch IS NULL OR btrim(default_branch) <> ''),
    UNIQUE (provider, provider_repository_id)
);

CREATE TABLE requirement (
    id uuid PRIMARY KEY,
    kind text GENERATED ALWAYS AS ('requirement'::text) STORED,
    project_id uuid NOT NULL REFERENCES project(id),
    name text NOT NULL CHECK (btrim(name) <> ''),
    name_key text NOT NULL UNIQUE CHECK (btrim(name_key) <> ''),
    description text,
    repository_id uuid REFERENCES repository(id),
    FOREIGN KEY (id, kind) REFERENCES configuration(id, kind),
    UNIQUE (id, project_id)
);

CREATE INDEX requirement_project_name_idx ON requirement (project_id, name_key, id);

CREATE TABLE workflow (
    id uuid PRIMARY KEY,
    kind text GENERATED ALWAYS AS ('workflow'::text) STORED,
    name text NOT NULL CHECK (btrim(name) <> ''),
    FOREIGN KEY (id, kind) REFERENCES configuration(id, kind)
);

CREATE TABLE agent_config (
    id uuid PRIMARY KEY,
    kind text GENERATED ALWAYS AS ('agent'::text) STORED,
    name text NOT NULL CHECK (btrim(name) <> ''),
    FOREIGN KEY (id, kind) REFERENCES configuration(id, kind)
);

CREATE TABLE agent_definition (
    id uuid PRIMARY KEY,
    role_key text NOT NULL UNIQUE CHECK (btrim(role_key) <> ''),
    source text NOT NULL CHECK (source IN ('builtin', 'configured')),
    agent_config_id uuid UNIQUE REFERENCES agent_config(id),
    CHECK ((source = 'configured') = (agent_config_id IS NOT NULL))
);

CREATE TABLE agent_version (
    agent_id uuid NOT NULL REFERENCES agent_definition(id),
    version bigint NOT NULL CHECK (version >= 1),
    display_name text NOT NULL,
    instruction text NOT NULL,
    skill_ref text,
    created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
    PRIMARY KEY (agent_id, version)
);

CREATE TABLE workflow_version (
    workflow_id uuid NOT NULL REFERENCES workflow(id),
    version bigint NOT NULL CHECK (version >= 1),
    saved_by uuid NOT NULL REFERENCES account(id),
    schema_version integer NOT NULL CHECK (schema_version >= 1),
    created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
    sealed_at timestamptz,
    PRIMARY KEY (workflow_id, version),
    CHECK (sealed_at IS NULL OR sealed_at >= created_at)
);

CREATE TABLE workflow_stage (
    workflow_id uuid NOT NULL,
    workflow_version bigint NOT NULL,
    stage_id uuid NOT NULL,
    name text NOT NULL CHECK (btrim(name) <> ''),
    ordinal integer NOT NULL CHECK (ordinal >= 1),
    PRIMARY KEY (workflow_id, workflow_version, stage_id),
    UNIQUE (workflow_id, workflow_version, ordinal),
    FOREIGN KEY (workflow_id, workflow_version) REFERENCES workflow_version(workflow_id, version)
);

CREATE TABLE workflow_node (
    workflow_id uuid NOT NULL,
    workflow_version bigint NOT NULL,
    node_id uuid NOT NULL,
    stage_id uuid NOT NULL,
    name text NOT NULL CHECK (btrim(name) <> ''),
    ordinal integer NOT NULL CHECK (ordinal >= 1),
    kind text NOT NULL CHECK (kind IN ('work', 'check', 'publish', 'end')),
    purpose text CHECK (purpose IN ('requirement', 'product', 'frontend', 'backend', 'test', 'repair', 'other')),
    agent_order text CHECK (agent_order IN ('parallel', 'serial')),
    PRIMARY KEY (workflow_id, workflow_version, node_id),
    UNIQUE (workflow_id, workflow_version, node_id, kind),
    UNIQUE (workflow_id, workflow_version, stage_id, ordinal),
    FOREIGN KEY (workflow_id, workflow_version, stage_id) REFERENCES workflow_stage(workflow_id, workflow_version, stage_id),
    CHECK (kind <> 'end' OR (agent_order IS NULL AND purpose IS NULL))
);

CREATE UNIQUE INDEX workflow_one_end_idx ON workflow_node (workflow_id, workflow_version) WHERE kind = 'end';

CREATE TABLE workflow_dependency (
    workflow_id uuid NOT NULL,
    workflow_version bigint NOT NULL,
    node_id uuid NOT NULL,
    prerequisite_node_id uuid NOT NULL,
    PRIMARY KEY (workflow_id, workflow_version, node_id, prerequisite_node_id),
    FOREIGN KEY (workflow_id, workflow_version, node_id) REFERENCES workflow_node(workflow_id, workflow_version, node_id),
    FOREIGN KEY (workflow_id, workflow_version, prerequisite_node_id) REFERENCES workflow_node(workflow_id, workflow_version, node_id),
    CHECK (node_id <> prerequisite_node_id)
);

CREATE INDEX workflow_dependency_successors_idx
    ON workflow_dependency (workflow_id, workflow_version, prerequisite_node_id, node_id);

CREATE TABLE workflow_role (
    workflow_id uuid NOT NULL,
    workflow_version bigint NOT NULL,
    node_id uuid NOT NULL,
    node_kind text NOT NULL CHECK (node_kind IN ('work', 'check', 'publish')),
    agent_id uuid NOT NULL,
    agent_version bigint NOT NULL,
    role text NOT NULL CHECK (role IN ('coordinator', 'subagent')),
    ordinal integer NOT NULL CHECK (ordinal >= 1),
    PRIMARY KEY (workflow_id, workflow_version, node_id, agent_id),
    UNIQUE (workflow_id, workflow_version, node_id, role, ordinal),
    UNIQUE (workflow_id, workflow_version, node_id, agent_id, agent_version, role),
    FOREIGN KEY (workflow_id, workflow_version, node_id, node_kind)
        REFERENCES workflow_node(workflow_id, workflow_version, node_id, kind),
    FOREIGN KEY (agent_id, agent_version) REFERENCES agent_version(agent_id, version)
);

CREATE UNIQUE INDEX workflow_one_coordinator_idx ON workflow_role (workflow_id, workflow_version, node_id)
    WHERE role = 'coordinator';

CREATE TABLE workflow_check (
    workflow_id uuid NOT NULL,
    workflow_version bigint NOT NULL,
    check_node_id uuid NOT NULL,
    node_kind text GENERATED ALWAYS AS ('check'::text) STORED,
    pass_entry_node_id uuid NOT NULL,
    repair_entry_node_id uuid NOT NULL,
    automatic_repair_limit integer NOT NULL CHECK (automatic_repair_limit >= 0),
    PRIMARY KEY (workflow_id, workflow_version, check_node_id),
    FOREIGN KEY (workflow_id, workflow_version, check_node_id, node_kind)
        REFERENCES workflow_node(workflow_id, workflow_version, node_id, kind),
    FOREIGN KEY (workflow_id, workflow_version, pass_entry_node_id) REFERENCES workflow_node(workflow_id, workflow_version, node_id),
    FOREIGN KEY (workflow_id, workflow_version, repair_entry_node_id) REFERENCES workflow_node(workflow_id, workflow_version, node_id),
    CHECK (pass_entry_node_id <> repair_entry_node_id AND check_node_id NOT IN (pass_entry_node_id, repair_entry_node_id))
);

CREATE TABLE workflow_route_node (
    workflow_id uuid NOT NULL,
    workflow_version bigint NOT NULL,
    check_node_id uuid NOT NULL,
    node_id uuid NOT NULL,
    outcome text NOT NULL CHECK (outcome IN ('pass', 'repair')),
    PRIMARY KEY (workflow_id, workflow_version, check_node_id, node_id),
    FOREIGN KEY (workflow_id, workflow_version, check_node_id) REFERENCES workflow_check(workflow_id, workflow_version, check_node_id),
    FOREIGN KEY (workflow_id, workflow_version, node_id) REFERENCES workflow_node(workflow_id, workflow_version, node_id),
    CHECK (check_node_id <> node_id)
);

CREATE TABLE workflow_publication (
    workflow_id uuid NOT NULL,
    workflow_version bigint NOT NULL,
    node_id uuid NOT NULL,
    node_kind text GENERATED ALWAYS AS ('publish'::text) STORED,
    target_ref text NOT NULL CHECK (btrim(target_ref) <> ''),
    workflow_ref text,
    PRIMARY KEY (workflow_id, workflow_version, node_id),
    FOREIGN KEY (workflow_id, workflow_version, node_id, node_kind)
        REFERENCES workflow_node(workflow_id, workflow_version, node_id, kind)
);

CREATE TABLE device (
    id uuid PRIMARY KEY,
    account_id uuid NOT NULL REFERENCES account(id),
    display_name text NOT NULL,
    mode text NOT NULL CHECK (mode IN ('demo', 'codex')),
    protocol_version text NOT NULL,
    paired_origin text NOT NULL,
    token_digest bytea NOT NULL UNIQUE CHECK (octet_length(token_digest) = 32),
    proof_public_key bytea NOT NULL CHECK (octet_length(proof_public_key) > 0),
    codex_status text NOT NULL CHECK (codex_status IN ('available', 'unavailable', 'unknown', 'not_required')),
    last_seen_at timestamptz,
    revoked_at timestamptz,
    UNIQUE (id, account_id, mode)
);

CREATE INDEX device_account_idx ON device (account_id, last_seen_at DESC, id);

CREATE TABLE device_pairing (
    id uuid PRIMARY KEY,
    account_id uuid NOT NULL REFERENCES account(id),
    session_id uuid NOT NULL,
    code_digest bytea NOT NULL UNIQUE CHECK (octet_length(code_digest) = 32),
    paired_origin text NOT NULL,
    expires_at timestamptz NOT NULL,
    consumed_at timestamptz,
    FOREIGN KEY (session_id, account_id) REFERENCES account_session(id, account_id)
);

CREATE TABLE device_challenge (
    id uuid PRIMARY KEY,
    account_id uuid NOT NULL REFERENCES account(id),
    session_id uuid NOT NULL,
    nonce bytea NOT NULL CHECK (octet_length(nonce) >= 16),
    platform_origin text NOT NULL,
    expires_at timestamptz NOT NULL,
    consumed_at timestamptz,
    FOREIGN KEY (session_id, account_id) REFERENCES account_session(id, account_id)
);

CREATE INDEX device_challenge_session_idx ON device_challenge (session_id, expires_at)
    WHERE consumed_at IS NULL;

CREATE TABLE run (
    id uuid PRIMARY KEY,
    project_id uuid NOT NULL,
    requirement_id uuid NOT NULL,
    workflow_id uuid NOT NULL,
    workflow_version bigint NOT NULL,
    initiator_id uuid NOT NULL,
    device_id uuid NOT NULL,
    mode text NOT NULL CHECK (mode IN ('demo', 'codex')),
    work_type text NOT NULL CHECK (work_type IN ('feature', 'refactor', 'hotfix', 'fix')),
    github_namespace text CHECK (github_namespace IS NULL OR btrim(github_namespace) <> ''),
    state text NOT NULL CHECK (state IN ('queued', 'preparing', 'running', 'waiting', 'needs_attention', 'failed', 'completed', 'stopped')),
    current_revision bigint NOT NULL CHECK (current_revision >= 1),
    state_version bigint NOT NULL CHECK (state_version >= 1),
    repository_id uuid REFERENCES repository(id),
    base_branch text,
    work_branch text,
    base_commit text,
    git_default_branch text CHECK (git_default_branch IS NULL OR btrim(git_default_branch) <> ''),
    reason_code text,
    created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
    finished_at timestamptz,
    UNIQUE (id, workflow_id, workflow_version),
    UNIQUE (id, requirement_id),
    UNIQUE (id, device_id),
    FOREIGN KEY (requirement_id, project_id) REFERENCES requirement(id, project_id),
    FOREIGN KEY (workflow_id, workflow_version) REFERENCES workflow_version(workflow_id, version),
    FOREIGN KEY (device_id, initiator_id, mode) REFERENCES device(id, account_id, mode),
    CHECK ((state IN ('completed', 'stopped')) = (finished_at IS NOT NULL)),
    CHECK (base_commit IS NULL OR (repository_id IS NOT NULL AND base_branch IS NOT NULL AND work_branch IS NOT NULL))
);

CREATE INDEX run_requirement_idx ON run (requirement_id, created_at DESC, id);
CREATE INDEX run_device_active_idx ON run (device_id, state, id) WHERE finished_at IS NULL;

CREATE TABLE run_requirement_revision (
    run_id uuid NOT NULL REFERENCES run(id),
    revision bigint NOT NULL CHECK (revision >= 1),
    requirement_version bigint NOT NULL CHECK (requirement_version >= 1),
    title text NOT NULL,
    description text,
    recorded_by uuid NOT NULL REFERENCES account(id),
    created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
    PRIMARY KEY (run_id, revision)
);

ALTER TABLE run ADD CONSTRAINT run_current_revision_fk
    FOREIGN KEY (id, current_revision) REFERENCES run_requirement_revision(run_id, revision)
    DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE node_execution (
    id uuid PRIMARY KEY,
    run_id uuid NOT NULL,
    workflow_id uuid NOT NULL,
    workflow_version bigint NOT NULL,
    node_id uuid NOT NULL,
    wave integer NOT NULL CHECK (wave >= 1),
    requirement_revision bigint NOT NULL,
    state text NOT NULL CHECK (state IN ('blocked', 'ready', 'running', 'waiting_reply', 'needs_attention', 'failed', 'complete', 'skipped', 'stopped')),
    started_at timestamptz,
    UNIQUE (run_id, node_id, wave),
    UNIQUE (id, run_id),
    UNIQUE (id, run_id, requirement_revision),
    UNIQUE (id, run_id, workflow_id, workflow_version, node_id),
    FOREIGN KEY (run_id, workflow_id, workflow_version) REFERENCES run(id, workflow_id, workflow_version),
    FOREIGN KEY (workflow_id, workflow_version, node_id) REFERENCES workflow_node(workflow_id, workflow_version, node_id),
    FOREIGN KEY (run_id, requirement_revision) REFERENCES run_requirement_revision(run_id, revision),
    CHECK (state NOT IN ('running', 'waiting_reply', 'complete') OR started_at IS NOT NULL)
);

CREATE TABLE role_task (
    id uuid PRIMARY KEY,
    run_id uuid NOT NULL,
    device_id uuid NOT NULL,
    execution_id uuid,
    workflow_id uuid,
    workflow_version bigint,
    node_id uuid,
    agent_id uuid,
    agent_version bigint,
    role text CHECK (role IN ('coordinator', 'subagent')),
    kind text NOT NULL CHECK (kind IN ('git', 'agent', 'coordinator', 'publish', 'reconcile')),
    requirement_revision bigint NOT NULL,
    current_attempt integer NOT NULL CHECK (current_attempt >= 1),
    UNIQUE (id, run_id),
    UNIQUE (id, device_id),
    UNIQUE (execution_id, agent_id),
    FOREIGN KEY (run_id, device_id) REFERENCES run(id, device_id),
    FOREIGN KEY (run_id, requirement_revision) REFERENCES run_requirement_revision(run_id, revision),
    FOREIGN KEY (execution_id, run_id, requirement_revision)
        REFERENCES node_execution(id, run_id, requirement_revision) DEFERRABLE INITIALLY DEFERRED,
    FOREIGN KEY (execution_id, run_id, workflow_id, workflow_version, node_id)
        REFERENCES node_execution(id, run_id, workflow_id, workflow_version, node_id),
    FOREIGN KEY (workflow_id, workflow_version, node_id, agent_id, agent_version, role)
        REFERENCES workflow_role(workflow_id, workflow_version, node_id, agent_id, agent_version, role),
    CHECK ((kind IN ('agent', 'coordinator')) = (agent_id IS NOT NULL AND agent_version IS NOT NULL AND role IS NOT NULL)),
    CHECK (kind NOT IN ('agent', 'coordinator', 'publish') OR execution_id IS NOT NULL),
    CHECK (kind NOT IN ('agent', 'coordinator') OR (workflow_id IS NOT NULL AND workflow_version IS NOT NULL AND node_id IS NOT NULL)),
    CHECK ((kind <> 'agent' OR role = 'subagent') AND (kind <> 'coordinator' OR role = 'coordinator'))
);

CREATE INDEX role_task_run_idx ON role_task (run_id, kind, id);
CREATE UNIQUE INDEX role_task_initial_git_idx ON role_task (run_id) WHERE kind = 'git';

CREATE SEQUENCE task_lease_epoch;

CREATE TABLE task_attempt (
    task_id uuid NOT NULL,
    attempt_number integer NOT NULL CHECK (attempt_number >= 1),
    attempt_id uuid NOT NULL UNIQUE,
    device_id uuid NOT NULL,
    state text NOT NULL CHECK (state IN ('queued', 'leased', 'running', 'waiting_reply', 'succeeded', 'failed', 'canceled', 'needs_attention')),
    available_at timestamptz NOT NULL,
    lease_epoch bigint,
    lease_deadline timestamptz,
    last_event_sequence bigint NOT NULL DEFAULT 0 CHECK (last_event_sequence >= 0),
    session_ref text,
    checkpoint jsonb CHECK (checkpoint IS NULL OR jsonb_typeof(checkpoint) = 'object'),
    reason_code text,
    disposition text CHECK (disposition IS NULL OR disposition = 'skipped'),
    disposed_by uuid REFERENCES account(id),
    disposed_at timestamptz,
    PRIMARY KEY (task_id, attempt_number),
    UNIQUE (attempt_id, task_id),
    FOREIGN KEY (task_id, device_id) REFERENCES role_task(id, device_id),
    CHECK ((lease_epoch IS NULL) = (lease_deadline IS NULL)),
    CHECK (lease_epoch IS NULL OR lease_epoch >= 1),
    CHECK (state NOT IN ('leased', 'running') OR lease_epoch IS NOT NULL),
    CHECK ((disposition IS NULL AND disposed_by IS NULL AND disposed_at IS NULL)
        OR (disposition IS NOT NULL AND state = 'failed' AND disposed_by IS NOT NULL AND disposed_at IS NOT NULL))
);

ALTER TABLE role_task ADD CONSTRAINT role_task_current_attempt_fk
    FOREIGN KEY (id, current_attempt) REFERENCES task_attempt(task_id, attempt_number)
    DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX task_attempt_ready_idx ON task_attempt (device_id, available_at, task_id, attempt_number) WHERE state = 'queued';
CREATE INDEX task_attempt_expired_idx ON task_attempt (device_id, lease_deadline, task_id, attempt_number) WHERE state IN ('leased', 'running');

CREATE TABLE task_event (
    id uuid PRIMARY KEY,
    task_id uuid NOT NULL,
    attempt_number integer NOT NULL,
    lease_epoch bigint NOT NULL CHECK (lease_epoch >= 1),
    event_sequence bigint NOT NULL CHECK (event_sequence >= 1),
    event_type text NOT NULL CHECK (event_type IN ('progress', 'message', 'question', 'complete', 'failure')),
    request_key text NOT NULL CHECK (btrim(request_key) <> ''),
    created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
    UNIQUE (task_id, attempt_number, lease_epoch, event_sequence),
    UNIQUE (task_id, request_key),
    FOREIGN KEY (task_id, attempt_number) REFERENCES task_attempt(task_id, attempt_number)
);

CREATE TABLE check_cycle (
    run_id uuid NOT NULL,
    workflow_id uuid NOT NULL,
    workflow_version bigint NOT NULL,
    check_node_id uuid NOT NULL,
    node_kind text GENERATED ALWAYS AS ('check'::text) STORED,
    current_wave integer NOT NULL CHECK (current_wave >= 1),
    automatic_repair_count integer NOT NULL DEFAULT 0 CHECK (automatic_repair_count >= 0),
    manual_repair_count integer NOT NULL DEFAULT 0 CHECK (manual_repair_count >= 0),
    state text NOT NULL CHECK (state IN ('pending', 'pass', 'repair', 'unresolved', 'limit_reached', 'stopped')),
    PRIMARY KEY (run_id, check_node_id),
    FOREIGN KEY (run_id, workflow_id, workflow_version) REFERENCES run(id, workflow_id, workflow_version),
    FOREIGN KEY (workflow_id, workflow_version, check_node_id, node_kind)
        REFERENCES workflow_node(workflow_id, workflow_version, node_id, kind)
);

CREATE TABLE check_wave (
    run_id uuid NOT NULL,
    check_node_id uuid NOT NULL,
    wave integer NOT NULL CHECK (wave >= 1),
    requirement_revision bigint NOT NULL,
    checked_commit text,
    checked_artifact_version text,
    outcome text NOT NULL CHECK (outcome IN ('pending', 'pass', 'repair', 'unresolved')),
    reason_code text,
    completed_at timestamptz,
    PRIMARY KEY (run_id, check_node_id, wave),
    FOREIGN KEY (run_id, check_node_id) REFERENCES check_cycle(run_id, check_node_id),
    FOREIGN KEY (run_id, check_node_id, wave) REFERENCES node_execution(run_id, node_id, wave),
    FOREIGN KEY (run_id, requirement_revision) REFERENCES run_requirement_revision(run_id, revision),
    CHECK ((outcome = 'pending') = (completed_at IS NULL)),
    CHECK (outcome NOT IN ('pass', 'repair') OR (checked_commit IS NOT NULL AND checked_artifact_version IS NOT NULL))
);

ALTER TABLE check_cycle ADD CONSTRAINT check_current_wave_fk
    FOREIGN KEY (run_id, check_node_id, current_wave) REFERENCES check_wave(run_id, check_node_id, wave)
    DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE repair_round (
    run_id uuid NOT NULL,
    check_node_id uuid NOT NULL,
    round_number integer NOT NULL CHECK (round_number >= 1),
    triggering_wave integer NOT NULL,
    kind text NOT NULL CHECK (kind IN ('automatic', 'manual')),
    authorized_by uuid REFERENCES account(id),
    state text NOT NULL CHECK (state IN ('queued', 'running', 'complete', 'failed', 'stopped')),
    created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
    PRIMARY KEY (run_id, check_node_id, round_number),
    UNIQUE (run_id, check_node_id, triggering_wave),
    FOREIGN KEY (run_id, check_node_id, triggering_wave) REFERENCES check_wave(run_id, check_node_id, wave),
    CHECK ((kind = 'manual') = (authorized_by IS NOT NULL))
);

ALTER TABLE check_wave
    ADD COLUMN recheck_of_round integer,
    ADD CONSTRAINT check_wave_repair_round_fk FOREIGN KEY (run_id, check_node_id, recheck_of_round)
        REFERENCES repair_round (run_id, check_node_id, round_number);

CREATE TABLE run_permission (
    run_id uuid NOT NULL REFERENCES run(id),
    account_id uuid NOT NULL REFERENCES account(id),
    capability text NOT NULL CHECK (capability IN ('view_run', 'chat', 'confirm_change', 'publish', 'reconcile')),
    granted_by uuid NOT NULL REFERENCES account(id),
    granted_at timestamptz NOT NULL DEFAULT statement_timestamp(),
    expires_at timestamptz,
    revoked_at timestamptz,
    PRIMARY KEY (run_id, account_id, capability),
    CHECK (expires_at IS NULL OR expires_at > granted_at)
);

CREATE TABLE chat_lease (
    run_id uuid PRIMARY KEY REFERENCES run(id),
    epoch bigint NOT NULL CHECK (epoch >= 0),
    holder_account_id uuid REFERENCES account(id),
    holder_session_id uuid,
    holder_tab_id uuid,
    heartbeat_until timestamptz,
    grace_until timestamptz,
    FOREIGN KEY (holder_session_id, holder_account_id) REFERENCES account_session(id, account_id),
    CHECK ((holder_account_id IS NOT NULL AND holder_session_id IS NOT NULL AND holder_tab_id IS NOT NULL
        AND heartbeat_until IS NOT NULL AND grace_until IS NOT NULL AND epoch >= 1
        AND grace_until = heartbeat_until + interval '5 minutes')
       OR (holder_account_id IS NULL AND holder_session_id IS NULL AND holder_tab_id IS NULL
        AND heartbeat_until IS NULL AND grace_until IS NULL))
);

CREATE TABLE chat_message (
    id uuid PRIMARY KEY,
    run_id uuid NOT NULL REFERENCES run(id),
    message_type text NOT NULL CHECK (message_type IN ('message', 'handoff', 'system')),
    actor_account_id uuid REFERENCES account(id),
    actor_task_id uuid,
    target_task_id uuid,
    source_event_id uuid UNIQUE REFERENCES task_event(id),
    accepted_ordinal bigint GENERATED ALWAYS AS IDENTITY,
    body text NOT NULL CHECK (btrim(body) <> ''),
    created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
    FOREIGN KEY (actor_task_id, run_id) REFERENCES role_task(id, run_id),
    FOREIGN KEY (target_task_id, run_id) REFERENCES role_task(id, run_id),
    CHECK (num_nonnulls(actor_account_id, actor_task_id) <= 1),
    CHECK (source_event_id IS NULL OR (actor_task_id IS NOT NULL AND message_type = 'message')),
    CHECK (message_type = 'system' OR actor_account_id IS NOT NULL OR actor_task_id IS NOT NULL)
);

CREATE UNIQUE INDEX chat_message_page_idx ON chat_message (run_id, accepted_ordinal);

CREATE TABLE agent_question (
    id uuid PRIMARY KEY,
    run_id uuid NOT NULL REFERENCES run(id),
    task_id uuid NOT NULL,
    attempt_id uuid NOT NULL,
    source_event_id uuid NOT NULL UNIQUE REFERENCES task_event(id),
    session_ref text NOT NULL CHECK (btrim(session_ref) <> ''),
    body text NOT NULL CHECK (btrim(body) <> ''),
    created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
    UNIQUE (id, run_id, task_id, session_ref),
    FOREIGN KEY (task_id, run_id) REFERENCES role_task(id, run_id),
    FOREIGN KEY (attempt_id, task_id) REFERENCES task_attempt(attempt_id, task_id)
);

CREATE INDEX agent_question_run_idx ON agent_question (run_id, created_at, id);

CREATE TABLE question_resolution (
    question_id uuid PRIMARY KEY REFERENCES agent_question(id),
    actor_id uuid NOT NULL REFERENCES account(id),
    action text NOT NULL CHECK (action IN ('reply', 'cancel')),
    answer text,
    accepted_at timestamptz NOT NULL DEFAULT statement_timestamp(),
    CHECK ((action = 'reply' AND answer IS NOT NULL AND btrim(answer) <> '') OR (action = 'cancel' AND answer IS NULL))
);

CREATE TABLE agent_inbox (
    id uuid PRIMARY KEY,
    run_id uuid NOT NULL,
    task_id uuid NOT NULL,
    session_ref text NOT NULL CHECK (btrim(session_ref) <> ''),
    kind text NOT NULL CHECK (kind IN ('message', 'handoff', 'answer', 'continue_without_answer', 'change_confirmed')),
    question_id uuid UNIQUE REFERENCES question_resolution(question_id),
    payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
    delivery_state text NOT NULL CHECK (delivery_state IN ('pending', 'delivered', 'unknown')),
    created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
    delivered_at timestamptz,
    FOREIGN KEY (task_id, run_id) REFERENCES role_task(id, run_id),
    FOREIGN KEY (question_id, run_id, task_id, session_ref) REFERENCES agent_question(id, run_id, task_id, session_ref),
    CHECK ((kind IN ('answer', 'continue_without_answer')) = (question_id IS NOT NULL)),
    CHECK ((delivery_state = 'delivered') = (delivered_at IS NOT NULL))
);

CREATE INDEX agent_inbox_pending_idx ON agent_inbox (task_id, created_at, id) WHERE delivery_state = 'pending';

ALTER TABLE chat_message ADD COLUMN in_reply_to_inbox_id uuid REFERENCES agent_inbox(id);
ALTER TABLE chat_message ADD CHECK (in_reply_to_inbox_id IS NULL OR source_event_id IS NOT NULL);

CREATE TABLE requirement_change (
    id uuid PRIMARY KEY,
    run_id uuid NOT NULL REFERENCES run(id),
    execution_id uuid NOT NULL,
    proposed_by uuid NOT NULL REFERENCES account(id),
    based_on_revision bigint NOT NULL,
    based_on_requirement_version bigint NOT NULL CHECK (based_on_requirement_version >= 1),
    proposed_title text NOT NULL CHECK (btrim(proposed_title) <> ''),
    proposed_name_key text NOT NULL CHECK (btrim(proposed_name_key) <> ''),
    proposed_description text,
    state text NOT NULL CHECK (state IN ('pending', 'confirmed', 'rejected')),
    confirmed_by uuid REFERENCES account(id),
    effective_revision bigint,
    created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
    confirmed_at timestamptz,
    FOREIGN KEY (run_id, based_on_revision) REFERENCES run_requirement_revision(run_id, revision),
    FOREIGN KEY (execution_id, run_id) REFERENCES node_execution(id, run_id),
    FOREIGN KEY (run_id, effective_revision) REFERENCES run_requirement_revision(run_id, revision) DEFERRABLE INITIALLY DEFERRED,
    UNIQUE (run_id, effective_revision),
    CHECK ((state = 'confirmed' AND confirmed_by IS NOT NULL AND effective_revision IS NOT NULL
        AND effective_revision > based_on_revision AND confirmed_at IS NOT NULL)
       OR (state <> 'confirmed' AND confirmed_by IS NULL AND effective_revision IS NULL AND confirmed_at IS NULL))
);

CREATE INDEX requirement_change_run_idx ON requirement_change (run_id, created_at, id);

ALTER TABLE role_task ADD CONSTRAINT role_task_execution_uk UNIQUE (id, execution_id);

CREATE TABLE artifact (
    id uuid PRIMARY KEY,
    run_id uuid NOT NULL,
    execution_id uuid NOT NULL,
    task_id uuid NOT NULL,
    attempt_id uuid NOT NULL,
    requirement_revision bigint NOT NULL,
    kind text NOT NULL CHECK (kind IN ('product', 'code', 'test', 'publication', 'other')),
    mode text NOT NULL CHECK (mode IN ('demo', 'codex')),
    title text NOT NULL CHECK (btrim(title) <> ''),
    source_ref text NOT NULL CHECK (btrim(source_ref) <> ''),
    content_digest bytea CHECK (content_digest IS NULL OR octet_length(content_digest) = 32),
    repository_id uuid REFERENCES repository(id),
    work_branch text,
    commit_id text,
    candidate_ref text,
    test_outcome text CHECK (test_outcome IN ('passed', 'failed', 'unresolved')),
    created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
    UNIQUE (id, run_id),
    FOREIGN KEY (execution_id, run_id) REFERENCES node_execution(id, run_id),
    FOREIGN KEY (task_id, execution_id) REFERENCES role_task(id, execution_id),
    FOREIGN KEY (attempt_id, task_id) REFERENCES task_attempt(attempt_id, task_id),
    FOREIGN KEY (run_id, requirement_revision) REFERENCES run_requirement_revision(run_id, revision),
    CHECK (kind NOT IN ('code', 'test') OR commit_id IS NOT NULL),
    CHECK ((kind = 'test') = (test_outcome IS NOT NULL)),
    CHECK (kind <> 'code' OR (repository_id IS NOT NULL AND work_branch IS NOT NULL))
);

CREATE INDEX artifact_run_idx ON artifact (run_id, created_at, id);
CREATE INDEX artifact_attempt_history_idx ON artifact (run_id, attempt_id, id);

ALTER TABLE check_wave ADD COLUMN report_artifact_id uuid;
ALTER TABLE check_wave ADD CONSTRAINT check_wave_report_fk
    FOREIGN KEY (report_artifact_id, run_id) REFERENCES artifact(id, run_id);
ALTER TABLE check_wave ADD CONSTRAINT check_wave_report_required
    CHECK (outcome NOT IN ('pass', 'repair') OR report_artifact_id IS NOT NULL);

CREATE TABLE artifact_archive (
    artifact_id uuid PRIMARY KEY,
    run_id uuid NOT NULL,
    device_id uuid NOT NULL,
    approved_by uuid NOT NULL REFERENCES account(id),
    approved_at timestamptz NOT NULL DEFAULT statement_timestamp(),
    available_at timestamptz NOT NULL DEFAULT statement_timestamp(),
    state text NOT NULL DEFAULT 'queued' CHECK (state IN ('queued','leased','succeeded','unknown','failed')),
    epoch bigint CHECK (epoch >= 1),
    lease_until timestamptz,
    export_commit text CHECK (export_commit ~ '^[0-9a-f]{40}$|^[0-9a-f]{64}$'),
    reason_code text,
    confirmed_at timestamptz,
    FOREIGN KEY (artifact_id,run_id) REFERENCES artifact(id,run_id),
    FOREIGN KEY (run_id,device_id) REFERENCES run(id,device_id),
    CHECK ((epoch IS NULL) = (lease_until IS NULL)),
    CHECK (state <> 'leased' OR epoch IS NOT NULL),
    CHECK ((state = 'succeeded') = (confirmed_at IS NOT NULL)),
    CHECK (state <> 'succeeded' OR export_commit IS NOT NULL)
);

CREATE INDEX artifact_archive_dispatch_idx ON artifact_archive(device_id,available_at,artifact_id)
    WHERE state IN ('queued','leased','unknown');

CREATE TABLE publication_gate (
    id uuid PRIMARY KEY,
    run_id uuid NOT NULL,
    execution_id uuid NOT NULL,
    requirement_revision bigint NOT NULL,
    candidate_commit text NOT NULL CHECK (btrim(candidate_commit) <> ''),
    artifact_version text NOT NULL CHECK (btrim(artifact_version) <> ''),
    target_ref text NOT NULL CHECK (btrim(target_ref) <> ''),
    policy_ref text NOT NULL CHECK (btrim(policy_ref) <> ''),
    gate_state text NOT NULL CHECK (gate_state IN ('blocked', 'allowed', 'superseded')),
    required_checks integer NOT NULL CHECK (required_checks >= 0),
    test_required boolean NOT NULL,
    approval_required boolean NOT NULL,
    test_evidence_id uuid,
    approved_by uuid REFERENCES account(id),
    created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
    UNIQUE (id, run_id),
    FOREIGN KEY (execution_id, run_id) REFERENCES node_execution(id, run_id),
    FOREIGN KEY (run_id, requirement_revision) REFERENCES run_requirement_revision(run_id, revision),
    FOREIGN KEY (test_evidence_id, run_id) REFERENCES artifact(id, run_id)
);

CREATE TABLE publication_check_evidence (
    gate_id uuid NOT NULL,
    run_id uuid NOT NULL,
    check_node_id uuid NOT NULL,
    wave integer NOT NULL,
    PRIMARY KEY (gate_id, check_node_id),
    FOREIGN KEY (gate_id, run_id) REFERENCES publication_gate(id, run_id),
    FOREIGN KEY (run_id, check_node_id, wave) REFERENCES check_wave(run_id, check_node_id, wave)
);

CREATE TABLE external_operation (
    id uuid PRIMARY KEY,
    operation_key text NOT NULL UNIQUE CHECK (btrim(operation_key) <> ''),
    requirement_id uuid NOT NULL REFERENCES requirement(id),
    run_id uuid,
    publication_gate_id uuid,
    provider text NOT NULL CHECK (btrim(provider) <> ''),
    mode text NOT NULL CHECK (mode IN ('demo', 'codex')),
    effect text NOT NULL CHECK (effect IN ('create_repository', 'create_base_branch', 'create_work_branch', 'push_code', 'dispatch_publication')),
    target_key text NOT NULL CHECK (btrim(target_key) <> ''),
    artifact_version text,
    state text NOT NULL CHECK (state IN ('intended', 'dispatching', 'unknown', 'succeeded', 'failed')),
    last_authorized_task_id uuid,
    last_authorized_epoch bigint CHECK (last_authorized_epoch IS NULL OR last_authorized_epoch >= 1),
    authorization_deadline timestamptz,
    provider_result_id text,
    created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
    FOREIGN KEY (run_id, requirement_id) REFERENCES run(id, requirement_id),
    FOREIGN KEY (publication_gate_id, run_id) REFERENCES publication_gate(id, run_id),
    FOREIGN KEY (last_authorized_task_id) REFERENCES role_task(id),
    CHECK ((effect = 'create_repository') = (run_id IS NULL)),
    CHECK ((effect = 'dispatch_publication') = (publication_gate_id IS NOT NULL AND artifact_version IS NOT NULL)),
    CHECK (num_nonnulls(last_authorized_task_id, last_authorized_epoch, authorization_deadline) IN (0, 3))
);

CREATE TABLE run_external_grant (
    run_id uuid NOT NULL REFERENCES run(id),
    effect text NOT NULL CHECK (effect IN ('create_repository', 'create_base_branch', 'create_work_branch', 'push_code', 'dispatch_publication')),
    target_key text NOT NULL CHECK (btrim(target_key) <> ''),
    approved_by uuid NOT NULL REFERENCES account(id),
    policy_ref text NOT NULL CHECK (btrim(policy_ref) <> ''),
    approved_at timestamptz NOT NULL,
    expires_at timestamptz NOT NULL,
    revoked_at timestamptz,
    PRIMARY KEY (run_id, effect, target_key),
    CHECK (expires_at > approved_at)
);

CREATE UNIQUE INDEX external_repository_intent_idx ON external_operation (requirement_id, provider, mode)
    WHERE effect = 'create_repository';
CREATE UNIQUE INDEX external_publication_intent_idx ON external_operation (run_id, provider, target_key, artifact_version)
    WHERE effect = 'dispatch_publication';
CREATE INDEX external_unresolved_idx ON external_operation (state, created_at) WHERE state IN ('dispatching', 'unknown');

CREATE TABLE external_operation_task (
    operation_id uuid NOT NULL REFERENCES external_operation(id),
    task_id uuid NOT NULL REFERENCES role_task(id),
    PRIMARY KEY (operation_id, task_id)
);

CREATE TABLE operation_evidence (
    id uuid PRIMARY KEY,
    operation_id uuid NOT NULL REFERENCES external_operation(id),
    source_task_id uuid REFERENCES role_task(id),
    source_account_id uuid REFERENCES account(id),
    outcome text NOT NULL CHECK (outcome IN ('confirmed_success', 'confirmed_failure', 'unknown')),
    provider_result_id text,
    repository_id uuid REFERENCES repository(id),
    observed_branch text,
    observed_commit text,
    observed_target text,
    observed_artifact_version text,
    observed_at timestamptz NOT NULL,
    recorded_at timestamptz NOT NULL DEFAULT statement_timestamp(),
    CHECK (num_nonnulls(source_task_id, source_account_id) = 1),
    CHECK (outcome <> 'confirmed_success' OR provider_result_id IS NOT NULL)
);

CREATE INDEX operation_evidence_lookup_idx ON operation_evidence (operation_id, recorded_at DESC, id);

CREATE TABLE command_receipt (
    actor_kind text NOT NULL CHECK (actor_kind IN ('account', 'device')),
    actor_account_id uuid REFERENCES account(id),
    actor_device_id uuid REFERENCES device(id),
    actor_id uuid GENERATED ALWAYS AS (coalesce(actor_account_id, actor_device_id)) STORED,
    scope text NOT NULL CHECK (btrim(scope) <> ''),
    request_key text NOT NULL CHECK (btrim(request_key) <> ''),
    request_digest bytea NOT NULL CHECK (octet_length(request_digest) = 32),
    result_kind text,
    result_id uuid,
    created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
    accepted_at timestamptz,
    PRIMARY KEY (actor_kind, actor_id, scope, request_key),
    CHECK ((actor_kind = 'account' AND actor_account_id IS NOT NULL AND actor_device_id IS NULL)
        OR (actor_kind = 'device' AND actor_account_id IS NULL AND actor_device_id IS NOT NULL)),
    CHECK ((accepted_at IS NULL AND result_kind IS NULL AND result_id IS NULL)
        OR (accepted_at IS NOT NULL AND result_kind IS NOT NULL AND result_id IS NOT NULL))
);

CREATE TABLE audit_event (
    id uuid PRIMARY KEY,
    request_id text NOT NULL CHECK (btrim(request_id) <> ''),
    actor_account_id uuid REFERENCES account(id),
    actor_device_id uuid REFERENCES device(id),
    run_id uuid REFERENCES run(id),
    target_kind text NOT NULL,
    target_id uuid NOT NULL,
    action text NOT NULL,
    outcome text NOT NULL CHECK (outcome IN ('accepted', 'denied', 'conflict', 'reconciled')),
    reason_code text,
    occurred_at timestamptz NOT NULL DEFAULT statement_timestamp(),
    CHECK (num_nonnulls(actor_account_id, actor_device_id) <= 1)
);

CREATE INDEX audit_event_run_idx ON audit_event (run_id, occurred_at, id);
CREATE INDEX audit_event_target_idx ON audit_event (target_kind, target_id, occurred_at, id);

CREATE FUNCTION reject_historical_write() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
    RAISE EXCEPTION 'history table is append-only: %', TG_TABLE_NAME USING ERRCODE = '55000';
END
$fn$;

CREATE FUNCTION guard_workflow_child() RETURNS trigger
LANGUAGE plpgsql AS $fn$
DECLARE
    already_sealed timestamptz;
BEGIN
    IF TG_OP <> 'INSERT' THEN
        RAISE EXCEPTION 'workflow version rows are append-only' USING ERRCODE = '55000';
    END IF;
    SELECT v.sealed_at INTO STRICT already_sealed
      FROM agentship_design.workflow_version v
     WHERE v.workflow_id = NEW.workflow_id AND v.version = NEW.workflow_version
     FOR UPDATE;
    IF already_sealed IS NOT NULL THEN
        RAISE EXCEPTION 'workflow version is sealed' USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
END
$fn$;

CREATE FUNCTION guard_workflow_seal() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW.sealed_at IS NOT NULL THEN
            RAISE EXCEPTION 'insert a draft version before sealing' USING ERRCODE = '55000';
        END IF;
        RETURN NEW;
    END IF;
    IF TG_OP <> 'UPDATE' OR OLD.sealed_at IS NOT NULL OR NEW.sealed_at IS NULL
       OR (to_jsonb(OLD) - 'sealed_at') <> (to_jsonb(NEW) - 'sealed_at') THEN
        RAISE EXCEPTION 'only a single seal of a draft workflow version is permitted' USING ERRCODE = '55000';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM (
            SELECT n.kind FROM agentship_design.workflow_node n
            JOIN agentship_design.workflow_stage s USING (workflow_id, workflow_version, stage_id)
            WHERE n.workflow_id = NEW.workflow_id AND n.workflow_version = NEW.version
            ORDER BY s.ordinal DESC, n.ordinal DESC LIMIT 1
        ) last_node WHERE last_node.kind = 'end'
    ) OR EXISTS (
        SELECT 1 FROM agentship_design.workflow_stage s
        WHERE s.workflow_id = NEW.workflow_id AND s.workflow_version = NEW.version
          AND NOT EXISTS (
              SELECT 1 FROM agentship_design.workflow_node n
              WHERE (n.workflow_id, n.workflow_version, n.stage_id) = (s.workflow_id, s.workflow_version, s.stage_id)
          )
    ) THEN
        RAISE EXCEPTION 'a workflow needs non-empty stages and a final end node' USING ERRCODE = '23514';
    END IF;

    IF EXISTS (
        SELECT 1 FROM agentship_design.workflow_node n
        WHERE n.workflow_id = NEW.workflow_id AND n.workflow_version = NEW.version
          AND n.kind = 'check' AND NOT EXISTS (
              SELECT 1 FROM agentship_design.workflow_check c
              WHERE (c.workflow_id, c.workflow_version, c.check_node_id) = (n.workflow_id, n.workflow_version, n.node_id)
          )
    ) OR EXISTS (
        SELECT 1 FROM agentship_design.workflow_node n
        WHERE n.workflow_id = NEW.workflow_id AND n.workflow_version = NEW.version
          AND n.kind = 'publish' AND NOT EXISTS (
              SELECT 1 FROM agentship_design.workflow_publication p
              WHERE (p.workflow_id, p.workflow_version, p.node_id) = (n.workflow_id, n.workflow_version, n.node_id)
          )
    ) THEN
        RAISE EXCEPTION 'check routes and publication targets must be complete' USING ERRCODE = '23514';
    END IF;

    IF EXISTS (
        SELECT 1 FROM agentship_design.workflow_dependency e
        JOIN agentship_design.workflow_node n
          ON (n.workflow_id, n.workflow_version, n.node_id) = (e.workflow_id, e.workflow_version, e.node_id)
        JOIN agentship_design.workflow_node predecessor
          ON (predecessor.workflow_id, predecessor.workflow_version, predecessor.node_id) =
             (e.workflow_id, e.workflow_version, e.prerequisite_node_id)
        JOIN agentship_design.workflow_stage stage
          ON (stage.workflow_id, stage.workflow_version, stage.stage_id) =
             (n.workflow_id, n.workflow_version, n.stage_id)
        JOIN agentship_design.workflow_stage prior
          ON (prior.workflow_id, prior.workflow_version, prior.stage_id) =
             (predecessor.workflow_id, predecessor.workflow_version, predecessor.stage_id)
        WHERE e.workflow_id = NEW.workflow_id AND e.workflow_version = NEW.version
          AND (prior.ordinal > stage.ordinal OR predecessor.kind = 'end')
    ) OR EXISTS (
        WITH RECURSIVE edge AS (
            SELECT node_id, prerequisite_node_id FROM agentship_design.workflow_dependency
            WHERE workflow_id = NEW.workflow_id AND workflow_version = NEW.version
        ), reach(source_id, target_id) AS (
            SELECT node_id, prerequisite_node_id FROM edge
            UNION
            SELECT r.source_id, e.prerequisite_node_id FROM reach r JOIN edge e ON e.node_id = r.target_id
        )
        SELECT 1 FROM reach WHERE source_id = target_id
    ) THEN
        RAISE EXCEPTION 'workflow dependency cycle or stage inversion' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END
$fn$;

CREATE FUNCTION guard_run_binding() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NOT EXISTS (
            SELECT 1 FROM agentship_design.workflow_version v
            WHERE (v.workflow_id, v.version) = (NEW.workflow_id, NEW.workflow_version) AND v.sealed_at IS NOT NULL
        ) THEN
            RAISE EXCEPTION 'a run needs a sealed workflow version' USING ERRCODE = '23514';
        END IF;
    ELSIF (OLD.id, OLD.project_id, OLD.requirement_id, OLD.workflow_id, OLD.workflow_version,
           OLD.initiator_id, OLD.device_id, OLD.mode, OLD.work_type, OLD.github_namespace, OLD.created_at)
          IS DISTINCT FROM
          (NEW.id, NEW.project_id, NEW.requirement_id, NEW.workflow_id, NEW.workflow_version,
           NEW.initiator_id, NEW.device_id, NEW.mode, NEW.work_type, NEW.github_namespace, NEW.created_at) THEN
        RAISE EXCEPTION 'run binding is immutable' USING ERRCODE = '55000';
    ELSIF OLD.state IN ('completed', 'stopped') AND OLD.state <> NEW.state THEN
        RAISE EXCEPTION 'terminal run cannot resume' USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
END
$fn$;

-- These predicates use server-authenticated IDs, never actor values from request JSON.
CREATE FUNCTION active_browser_session(actor uuid, session_key uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path TO agentship_design, pg_catalog AS $fn$
    SELECT EXISTS (
        SELECT 1 FROM account_session s JOIN account a ON a.id = s.account_id
        WHERE s.id = session_key AND s.account_id = actor AND a.status = 'active'
          AND s.revoked_at IS NULL AND s.expires_at > statement_timestamp()
    )
$fn$;

CREATE FUNCTION can_chat(run_key uuid, actor uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path TO agentship_design, pg_catalog AS $fn$
    SELECT EXISTS (
        SELECT 1 FROM run r JOIN configuration c ON c.id = r.requirement_id
        WHERE r.id = run_key
          AND NOT EXISTS (
              SELECT 1 FROM configuration_deputy d
              WHERE d.configuration_id = c.id AND d.account_id = actor AND d.revoked_at IS NULL
          )
          AND (r.initiator_id = actor OR EXISTS (
              SELECT 1 FROM run_permission g
              WHERE g.run_id = run_key AND g.account_id = actor AND g.capability = 'chat'
                AND g.revoked_at IS NULL
                AND (g.expires_at IS NULL OR g.expires_at > statement_timestamp())
          ))
    )
$fn$;

CREATE FUNCTION holds_active_chat(run_key uuid, actor uuid, session_key uuid, tab uuid, lease_epoch bigint)
RETURNS boolean LANGUAGE sql STABLE SET search_path TO agentship_design, pg_catalog AS $fn$
    SELECT active_browser_session(actor, session_key) AND can_chat(run_key, actor) AND EXISTS (
        SELECT 1 FROM chat_lease l WHERE l.run_id = run_key AND l.epoch = lease_epoch
          AND l.holder_account_id = actor AND l.holder_session_id = session_key AND l.holder_tab_id = tab
          AND l.heartbeat_until > statement_timestamp()
    )
$fn$;

CREATE FUNCTION configuration_can_use(config_key uuid, actor uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path TO agentship_design, pg_catalog AS $fn$
    SELECT EXISTS (
        SELECT 1 FROM configuration c
        WHERE c.id = config_key AND c.kind IN ('workflow','agent')
          AND (c.owner_id = actor OR EXISTS (
              SELECT 1 FROM configuration_deputy d
              WHERE d.configuration_id = c.id AND d.account_id = actor AND d.revoked_at IS NULL
          ))
    )
$fn$;

-- Scope comes from the frozen version and the currently blocked check cycles.
-- Ordinary phase barriers and branch activation remain scheduler prerequisites.
CREATE FUNCTION task_route_is_open(run_key uuid, node_key uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path TO agentship_design, pg_catalog AS $fn$
    WITH RECURSIVE active_limits AS (
        SELECT workflow_id, workflow_version, check_node_id
        FROM check_cycle WHERE run_id = run_key AND state = 'limit_reached'
    ), edges AS (
        SELECT workflow_id, workflow_version, prerequisite_node_id AS parent, node_id AS child FROM workflow_dependency
        UNION ALL
        SELECT workflow_id, workflow_version, check_node_id AS parent, node_id AS child FROM workflow_route_node
    ), affected AS (
        SELECT workflow_id, workflow_version, check_node_id AS node_id FROM active_limits
        UNION
        SELECT a.workflow_id, a.workflow_version, e.child
        FROM affected a JOIN edges e
          ON (e.workflow_id,e.workflow_version,e.parent) = (a.workflow_id,a.workflow_version,a.node_id)
    )
    SELECT EXISTS (SELECT 1 FROM run WHERE id=run_key AND finished_at IS NULL)
       AND NOT EXISTS (SELECT 1 FROM affected WHERE node_id = node_key)
$fn$;

CREATE FUNCTION check_action_is_available(run_key uuid, check_key uuid, expected_state text)
RETURNS boolean LANGUAGE sql STABLE SET search_path TO agentship_design, pg_catalog AS $fn$
    WITH RECURSIVE target AS (
        SELECT c.run_id,c.workflow_id,c.workflow_version,c.check_node_id
        FROM check_cycle c JOIN run r ON r.id=c.run_id
        JOIN node_execution e ON (e.run_id,e.node_id,e.wave)=(c.run_id,c.check_node_id,c.current_wave)
        WHERE c.run_id=run_key AND c.check_node_id=check_key AND c.state=expected_state
          AND r.finished_at IS NULL AND e.state='needs_attention'
          AND e.wave=(SELECT max(x.wave) FROM node_execution x WHERE (x.run_id,x.node_id)=(e.run_id,e.node_id))
    ), ancestors(check_node_id,outcome) AS (
        SELECT m.check_node_id,m.outcome FROM target t JOIN workflow_route_node m
          ON (m.workflow_id,m.workflow_version,m.node_id)=(t.workflow_id,t.workflow_version,t.check_node_id)
        UNION
        SELECT m.check_node_id,m.outcome FROM ancestors a JOIN workflow_route_node m ON m.node_id=a.check_node_id
        JOIN target t ON (m.workflow_id,m.workflow_version)=(t.workflow_id,t.workflow_version)
    )
    SELECT EXISTS (SELECT 1 FROM target) AND NOT EXISTS (
        SELECT 1 FROM ancestors a LEFT JOIN check_cycle c ON c.run_id=run_key AND c.check_node_id=a.check_node_id
        WHERE c.state IS DISTINCT FROM a.outcome)
$fn$;


-- UC-05/08. P1 authenticated device, P2 validated batch cap, P3 lease seconds.
-- In Read Committed the VOLATILE helper re-reads after obtaining each run lock.
-- The first scan only identifies candidate runs; it grants no task authorization.
CREATE FUNCTION claim_device_tasks(device_key uuid, batch_cap integer, lease_seconds integer)
RETURNS TABLE (run_id uuid,task_id uuid,attempt_id uuid,lease_epoch bigint,
               lease_deadline timestamptz,checkpoint jsonb,session_ref text,
               requirement_revision bigint,github_namespace text)
LANGUAGE plpgsql VOLATILE SET search_path TO agentship_design, pg_catalog AS $fn$
DECLARE
    candidate_run uuid;
    remaining integer := batch_cap;
    claimed integer;
BEGIN
    IF coalesce(batch_cap,0) <= 0 OR coalesce(lease_seconds,0) <= 0 THEN RETURN; END IF;
    IF current_setting('transaction_isolation') <> 'read committed' THEN
        RAISE EXCEPTION 'claim requires Read Committed isolation' USING ERRCODE = '25001';
    END IF;
    FOR candidate_run IN
        SELECT r.id FROM run r
        WHERE r.device_id = device_key AND r.finished_at IS NULL AND EXISTS (
            SELECT 1 FROM role_task t JOIN task_attempt a
              ON (a.task_id,a.attempt_number) = (t.id,t.current_attempt)
            WHERE t.run_id = r.id
              AND ((a.state = 'queued' AND a.available_at <= statement_timestamp())
                OR (a.state IN ('leased','running') AND a.lease_deadline <= statement_timestamp()))
        )
        ORDER BY r.id
    LOOP
        PERFORM r.id FROM run r WHERE r.id = candidate_run FOR UPDATE SKIP LOCKED;
        IF NOT FOUND THEN CONTINUE; END IF;

        RETURN QUERY
        WITH candidates AS (
            SELECT a.task_id,a.attempt_number,t.run_id,t.execution_id,t.kind,t.requirement_revision,
                   CASE WHEN t.kind = 'git' AND r.repository_id IS NULL THEN r.github_namespace END AS github_namespace
            FROM task_attempt a JOIN role_task t ON (t.id,t.current_attempt) = (a.task_id,a.attempt_number)
            JOIN run r ON r.id = t.run_id JOIN device d ON d.id = a.device_id
            LEFT JOIN node_execution n ON n.id = t.execution_id
            WHERE t.run_id = candidate_run AND a.device_id = device_key AND d.revoked_at IS NULL
              AND r.finished_at IS NULL
              AND (t.kind = 'reconcile' OR (
                  (t.execution_id IS NULL OR n.state IN ('ready','running','waiting_reply'))
                  AND task_route_is_open(r.id,n.node_id)
              ))
              AND ((a.state = 'queued' AND a.available_at <= statement_timestamp())
                OR (a.state IN ('leased','running') AND a.lease_deadline <= statement_timestamp()))
            ORDER BY CASE WHEN a.state = 'queued' THEN a.available_at ELSE a.lease_deadline END,a.task_id
            LIMIT remaining FOR UPDATE OF a SKIP LOCKED
        ), pinned AS (
            UPDATE node_execution n
            SET state = 'running',started_at = statement_timestamp(),requirement_revision = r.current_revision
            FROM run r
            WHERE n.run_id = candidate_run AND r.id = n.run_id AND n.started_at IS NULL AND n.state = 'ready'
              AND EXISTS (SELECT 1 FROM candidates c WHERE c.execution_id = n.id AND c.kind <> 'reconcile')
            RETURNING n.id,n.run_id,n.node_id,n.wave,n.requirement_revision
        ), pinned_roles AS (
            UPDATE role_task t SET requirement_revision = p.requirement_revision
            FROM pinned p WHERE t.execution_id = p.id
            RETURNING t.id
        ), pinned_checks AS (
            UPDATE check_wave w SET requirement_revision = p.requirement_revision
            FROM pinned p WHERE (w.run_id,w.check_node_id,w.wave) = (p.run_id,p.node_id,p.wave) AND w.outcome = 'pending'
            RETURNING w.run_id
        )
        UPDATE task_attempt a SET state = 'leased',lease_epoch = nextval('agentship_design.task_lease_epoch'),
            lease_deadline = statement_timestamp() + make_interval(secs => lease_seconds),last_event_sequence = 0
        FROM candidates c LEFT JOIN pinned p ON p.id = c.execution_id
        WHERE (a.task_id,a.attempt_number) = (c.task_id,c.attempt_number)
        RETURNING c.run_id,a.task_id,a.attempt_id,a.lease_epoch,a.lease_deadline,a.checkpoint,a.session_ref,
                  coalesce(p.requirement_revision,c.requirement_revision),c.github_namespace;
        GET DIAGNOSTICS claimed = ROW_COUNT;
        remaining := remaining - claimed;
        EXIT WHEN remaining <= 0;
    END LOOP;
END
$fn$;

CREATE FUNCTION guard_node_execution_pin() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
    IF (OLD.id,OLD.run_id,OLD.workflow_id,OLD.workflow_version,OLD.node_id,OLD.wave)
       IS DISTINCT FROM (NEW.id,NEW.run_id,NEW.workflow_id,NEW.workflow_version,NEW.node_id,NEW.wave)
       OR (OLD.started_at IS NOT NULL AND
          (OLD.started_at,OLD.requirement_revision) IS DISTINCT FROM (NEW.started_at,NEW.requirement_revision)) THEN
        RAISE EXCEPTION 'node execution input pin is immutable after start' USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
END
$fn$;

CREATE TRIGGER node_execution_pin_guard BEFORE UPDATE ON node_execution
FOR EACH ROW EXECUTE FUNCTION guard_node_execution_pin();

-- Internal projection. Caller filters by run authorization before returning it.
CREATE VIEW node_revision_projection AS
SELECT n.id AS execution_id,n.run_id,n.node_id,n.wave,n.state,
       CASE WHEN n.started_at IS NOT NULL THEN n.requirement_revision END AS input_requirement_revision,
       n.started_at IS NOT NULL AND n.requirement_revision < r.current_revision AS based_on_older_requirement_revision
FROM node_execution n JOIN run r ON r.id = n.run_id;

CREATE FUNCTION publication_gate_valid(gate_key uuid, run_key uuid, commit_key text, artifact_key text, target_key text)
RETURNS boolean LANGUAGE sql STABLE SET search_path TO agentship_design, pg_catalog AS $fn$
    SELECT EXISTS (
        SELECT 1 FROM publication_gate g JOIN run r ON r.id = g.run_id
        WHERE g.id = gate_key AND r.id = run_key AND r.finished_at IS NULL AND g.requirement_revision = r.current_revision
          AND g.gate_state = 'allowed' AND g.candidate_commit = commit_key
          AND g.artifact_version = artifact_key AND g.target_ref = target_key
          AND (NOT g.approval_required OR g.approved_by IS NOT NULL)
          AND (NOT g.test_required OR EXISTS (
              SELECT 1 FROM artifact t WHERE t.id = g.test_evidence_id AND t.run_id = r.id
                AND t.kind = 'test' AND t.test_outcome = 'passed'
                AND t.commit_id = g.candidate_commit AND t.candidate_ref = g.artifact_version
                AND t.requirement_revision = g.requirement_revision AND t.mode = r.mode
          ))
          AND (SELECT count(*) FROM publication_check_evidence e WHERE e.gate_id = g.id) = g.required_checks
          AND NOT EXISTS (
              SELECT 1 FROM publication_check_evidence e
              JOIN check_cycle c ON (c.run_id,c.check_node_id) = (e.run_id,e.check_node_id)
              JOIN check_wave w ON (w.run_id,w.check_node_id,w.wave) = (e.run_id,e.check_node_id,e.wave)
              WHERE e.gate_id = g.id AND (c.state <> 'pass' OR c.current_wave <> e.wave OR w.outcome <> 'pass'
                  OR w.checked_commit IS DISTINCT FROM g.candidate_commit
                  OR w.checked_artifact_version IS DISTINCT FROM g.artifact_version
                  OR w.requirement_revision <> g.requirement_revision)
          )
    )
$fn$;

CREATE TRIGGER workflow_seal_guard BEFORE INSERT OR UPDATE OR DELETE ON workflow_version
    FOR EACH ROW EXECUTE FUNCTION guard_workflow_seal();
CREATE TRIGGER run_binding_guard BEFORE INSERT OR UPDATE ON run
    FOR EACH ROW EXECUTE FUNCTION guard_run_binding();

DO $fn$
DECLARE
    table_name text;
BEGIN
    FOREACH table_name IN ARRAY ARRAY[
        'workflow_stage', 'workflow_node', 'workflow_dependency', 'workflow_role', 'workflow_check',
        'workflow_route_node', 'workflow_publication'
    ] LOOP
        EXECUTE format('CREATE TRIGGER workflow_child_guard BEFORE INSERT OR UPDATE OR DELETE ON agentship_design.%I
            FOR EACH ROW EXECUTE FUNCTION agentship_design.guard_workflow_child()', table_name);
    END LOOP;
    FOREACH table_name IN ARRAY ARRAY[
        'agent_version', 'run_requirement_revision', 'task_event', 'question_resolution', 'artifact',
        'operation_evidence', 'audit_event'
    ] LOOP
        EXECUTE format('CREATE TRIGGER historical_write_guard BEFORE UPDATE OR DELETE ON agentship_design.%I
            FOR EACH ROW EXECUTE FUNCTION agentship_design.reject_historical_write()', table_name);
    END LOOP;
END
$fn$;
COMMIT;
