ALTER TABLE agentship_design.check_wave
    ADD COLUMN recheck_of_round integer,
    ADD CONSTRAINT check_wave_repair_round_fk FOREIGN KEY (run_id, check_node_id, recheck_of_round)
        REFERENCES agentship_design.repair_round (run_id, check_node_id, round_number);

CREATE OR REPLACE FUNCTION agentship_design.task_route_is_open(run_key uuid, node_key uuid) RETURNS boolean
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

CREATE FUNCTION agentship_design.check_action_is_available(run_key uuid, check_key uuid, expected_state text)
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
