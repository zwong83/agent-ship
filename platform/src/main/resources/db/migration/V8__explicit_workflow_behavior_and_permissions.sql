SET LOCAL search_path TO agentship_design, pg_catalog;

-- Legacy agent versions retain their per-assignment permissions. New clients
-- explicitly choose read_only or write when creating an agent.
ALTER TABLE agent_version ADD COLUMN workspace_access text NOT NULL DEFAULT 'legacy'
    CHECK (workspace_access IN ('read_only', 'write', 'legacy'));
ALTER TABLE workflow_node ADD COLUMN collect_requirements boolean NOT NULL DEFAULT false;
ALTER TABLE workflow_role ADD COLUMN workspace_access text NOT NULL DEFAULT 'read_only'
    CHECK (workspace_access IN ('read_only', 'write'));

-- Materialize the previous runtime decisions without changing historical meaning.
-- Flyway applies this migration transactionally; guards are restored before commit.
ALTER TABLE workflow_node DISABLE TRIGGER workflow_child_guard;
UPDATE workflow_node SET collect_requirements=true WHERE purpose='requirement';
ALTER TABLE workflow_node ENABLE TRIGGER workflow_child_guard;
ALTER TABLE workflow_role DISABLE TRIGGER workflow_child_guard;
UPDATE workflow_role r SET workspace_access=CASE
    WHEN r.node_kind='check' AND r.role='coordinator' THEN 'read_only'
    WHEN r.role='coordinator' OR n.purpose IN ('frontend','backend','repair') THEN 'write'
    ELSE 'read_only' END
FROM workflow_node n
WHERE (n.workflow_id,n.workflow_version,n.node_id)=(r.workflow_id,r.workflow_version,r.node_id);
ALTER TABLE workflow_role ENABLE TRIGGER workflow_child_guard;
ALTER TABLE workflow_node ADD CONSTRAINT workflow_end_no_requirements CHECK (kind <> 'end' OR NOT collect_requirements);
