CREATE TABLE agentship_design.artifact_archive (
    artifact_id uuid PRIMARY KEY,
    run_id uuid NOT NULL,
    device_id uuid NOT NULL,
    approved_by uuid NOT NULL REFERENCES agentship_design.account(id),
    approved_at timestamptz NOT NULL DEFAULT statement_timestamp(),
    available_at timestamptz NOT NULL DEFAULT statement_timestamp(),
    state text NOT NULL DEFAULT 'queued' CHECK (state IN ('queued','leased','succeeded','unknown','failed')),
    epoch bigint CHECK (epoch >= 1),
    lease_until timestamptz,
    export_commit text CHECK (export_commit ~ '^[0-9a-f]{40}$|^[0-9a-f]{64}$'),
    reason_code text,
    confirmed_at timestamptz,
    FOREIGN KEY (artifact_id,run_id) REFERENCES agentship_design.artifact(id,run_id),
    FOREIGN KEY (run_id,device_id) REFERENCES agentship_design.run(id,device_id),
    CHECK ((epoch IS NULL) = (lease_until IS NULL)),
    CHECK (state <> 'leased' OR epoch IS NOT NULL),
    CHECK ((state = 'succeeded') = (confirmed_at IS NOT NULL)),
    CHECK (state <> 'succeeded' OR export_commit IS NOT NULL)
);

CREATE INDEX artifact_archive_dispatch_idx ON agentship_design.artifact_archive(device_id,available_at,artifact_id)
    WHERE state IN ('queued','leased','unknown');
