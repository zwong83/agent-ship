SET LOCAL search_path TO agentship_design, pg_catalog;

ALTER TABLE account ALTER COLUMN email DROP NOT NULL;
ALTER TABLE account ALTER COLUMN email_login_key DROP NOT NULL;
ALTER TABLE account ADD COLUMN verification_required boolean NOT NULL DEFAULT true;
ALTER TABLE account DROP CONSTRAINT account_check1;
ALTER TABLE account ADD CONSTRAINT account_contact_verification_check CHECK (
    status <> 'active' OR NOT verification_required OR
    ((email IS NULL OR email_verified_at IS NOT NULL) AND phone_verified_at IS NOT NULL)
);
ALTER TABLE account ADD CONSTRAINT account_email_key_presence_check
    CHECK ((email IS NULL) = (email_login_key IS NULL));
