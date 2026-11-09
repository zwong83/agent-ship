CREATE TABLE agentship_design.registration_scope (
    account_id uuid PRIMARY KEY REFERENCES agentship_design.account(id) ON DELETE CASCADE,
    reference_digest bytea NOT NULL UNIQUE CHECK (octet_length(reference_digest) = 32)
);
