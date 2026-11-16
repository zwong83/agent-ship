SET LOCAL search_path TO agentship_design, pg_catalog;

ALTER TABLE account ALTER COLUMN phone DROP NOT NULL;
ALTER TABLE account DROP CONSTRAINT account_contact_verification_check;
ALTER TABLE account ADD CONSTRAINT account_contact_verification_check CHECK (
    status <> 'active' OR NOT verification_required OR
    ((email IS NULL OR email_verified_at IS NOT NULL)
     AND (phone IS NULL OR phone_verified_at IS NOT NULL))
);
