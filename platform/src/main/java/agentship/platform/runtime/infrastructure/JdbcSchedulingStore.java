package agentship.platform.runtime.infrastructure;

import agentship.platform.runtime.application.port.SchedulingStore;
import agentship.platform.runtime.domain.SchedulingPolicy.Node;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
class JdbcSchedulingStore implements SchedulingStore {
    private final NamedParameterJdbcTemplate jdbc;

    JdbcSchedulingStore(NamedParameterJdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @Override
    public List<Candidate> initializationCandidates(UUID device) {
        var candidates = jdbc.queryForList("""
                SELECT r.id, r.requirement_id FROM run r
                WHERE r.device_id=:device AND r.finished_at IS NULL AND r.base_commit IS NOT NULL
                  AND (r.state='waiting' AND r.reason_code='AGENT_EXECUTION_PENDING'
                    OR r.state='needs_attention' AND r.reason_code='AGENT_REPAIR_REQUIRED' AND EXISTS (
                      SELECT 1 FROM check_cycle c WHERE c.run_id=r.id AND c.state='repair' AND NOT EXISTS (
                        SELECT 1 FROM repair_round rr WHERE (rr.run_id,rr.check_node_id,rr.triggering_wave)=
                            (c.run_id,c.check_node_id,c.current_wave))))
                  AND EXISTS (SELECT 1 FROM role_task t JOIN task_attempt a
                    ON (a.task_id,a.attempt_number)=(t.id,t.current_attempt)
                    WHERE t.run_id=r.id AND t.kind='git' AND a.state='succeeded')
                ORDER BY r.requirement_id, r.id LIMIT 32
                """, Map.of("device", device));
        return candidates.stream().map(row -> new Candidate((UUID) row.get("id"), (UUID) row.get("requirement_id"))).toList();
    }

    @Override
    public void completeRun(Map<String, Object> run, Node end) {
        jdbc.update("""
                UPDATE node_execution SET state='complete', started_at=statement_timestamp(),
                    requirement_revision=:revision WHERE id=:execution AND started_at IS NULL
                """, Map.of("execution", end.execution(), "revision", run.get("current_revision")));
        jdbc.update("""
                UPDATE run SET state='completed',reason_code=NULL,finished_at=statement_timestamp(),
                    state_version=state_version+1 WHERE id=:run AND finished_at IS NULL
                """, Map.of("run", run.get("id")));
    }

    @Override
    public void ready(Node node) {
        jdbc.update("UPDATE node_execution SET state='ready' WHERE id=:execution AND state='blocked'",
                Map.of("execution", node.execution()));
    }

    @Override
    public List<Map<String, Object>> roles(Map<String, Object> run, Node node) {
        return jdbc.queryForList("""
                SELECT w.agent_id,w.agent_version,w.role,w.ordinal,t.id AS task_id,a.state,a.reason_code,a.disposition
                FROM workflow_role w
                LEFT JOIN role_task t ON t.execution_id=:execution AND t.agent_id=w.agent_id
                LEFT JOIN task_attempt a ON (a.task_id,a.attempt_number)=(t.id,t.current_attempt)
                WHERE (w.workflow_id,w.workflow_version,w.node_id)=(:workflow,:version,:node)
                ORDER BY CASE w.role WHEN 'subagent' THEN 0 ELSE 1 END,w.ordinal
                """, Map.of("execution", node.execution(), "workflow", run.get("workflow_id"),
                "version", run.get("workflow_version"), "node", node.id()));
    }

    @Override
    public void nodeState(Node node, String state) {
        jdbc.update("UPDATE node_execution SET state=:state WHERE id=:execution",
                Map.of("state", state, "execution", node.execution()));
    }

    @Override
    public String checkBlocker(Map<String, Object> run, Node node) {
        return jdbc.query("""
                SELECT reason_code FROM check_wave WHERE run_id=:run AND check_node_id=:node AND wave=:wave AND reason_code IS NOT NULL
                """, Map.of("run", run.get("id"), "node", node.id(), "wave", node.wave()),
                (rs, row) -> rs.getString("reason_code")).stream().findFirst().orElse(null);
    }

    @Override
    public void queue(Map<String, Object> run, Node node, Map<String, Object> role, String kind) {
        UUID task = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO role_task(id,run_id,device_id,execution_id,workflow_id,workflow_version,node_id,
                    agent_id,agent_version,role,kind,requirement_revision,current_attempt)
                VALUES(:task,:run,:device,:execution,:workflow,:version,:node,:agent,:agentVersion,:role,:kind,:revision,1)
                """, Map.ofEntries(Map.entry("task", task), Map.entry("run", run.get("id")),
                Map.entry("device", run.get("device_id")), Map.entry("execution", node.execution()),
                Map.entry("workflow", run.get("workflow_id")), Map.entry("version", run.get("workflow_version")),
                Map.entry("node", node.id()), Map.entry("agent", role.get("agent_id")),
                Map.entry("agentVersion", role.get("agent_version")), Map.entry("role", role.get("role")),
                Map.entry("kind", kind), Map.entry("revision", node.revision())));
        jdbc.update("""
                INSERT INTO task_attempt(task_id,attempt_number,attempt_id,device_id,state,available_at)
                VALUES(:task,1,:attempt,:device,'queued',statement_timestamp())
                """, Map.of("task", task, "attempt", UUID.randomUUID(), "device", run.get("device_id")));
    }

    @Override
    public void updateRun(Map<String, Object> run, String state, String reason) {
        var args = new org.springframework.jdbc.core.namedparam.MapSqlParameterSource("run", run.get("id"))
                .addValue("state", state).addValue("reason", reason);
        jdbc.update("""
                UPDATE run SET state=:state,reason_code=:reason,state_version=state_version+1 WHERE id=:run
                """, args);
    }

    @Override
    public List<Node> nodes(Map<String, Object> run) {
        var args = Map.of("workflow", run.get("workflow_id"), "version", run.get("workflow_version"), "run", run.get("id"));
        Map<UUID, List<UUID>> prerequisites = new LinkedHashMap<>();
        jdbc.query("""
                SELECT node_id,prerequisite_node_id FROM workflow_dependency
                WHERE workflow_id=:workflow AND workflow_version=:version ORDER BY prerequisite_node_id
                """, args, rs -> {
            prerequisites.computeIfAbsent(rs.getObject("node_id", UUID.class), ignored -> new ArrayList<>())
                    .add(rs.getObject("prerequisite_node_id", UUID.class));
        });
        return jdbc.query("""
                SELECT n.node_id,n.kind,n.purpose,n.agent_order,s.ordinal AS stage_ordinal,e.id,e.wave,e.state,
                    e.requirement_revision,m.check_node_id,m.outcome,c.state AS check_outcome,own.state AS cycle_state
                FROM workflow_node n JOIN workflow_stage s USING (workflow_id,workflow_version,stage_id)
                JOIN node_execution e ON (e.workflow_id,e.workflow_version,e.node_id)=(n.workflow_id,n.workflow_version,n.node_id)
                LEFT JOIN workflow_route_node m ON (m.workflow_id,m.workflow_version,m.node_id)=(n.workflow_id,n.workflow_version,n.node_id)
                LEFT JOIN check_cycle c ON c.run_id=e.run_id AND c.check_node_id=m.check_node_id
                LEFT JOIN check_cycle own ON own.run_id=e.run_id AND own.check_node_id=e.node_id
                WHERE e.run_id=:run AND e.wave=(SELECT max(x.wave) FROM node_execution x WHERE x.run_id=e.run_id AND x.node_id=e.node_id)
                ORDER BY s.ordinal,n.ordinal
                """, args, (rs, row) -> {
            UUID node = rs.getObject("node_id", UUID.class);
            return new Node(node, rs.getObject("id", UUID.class), rs.getInt("stage_ordinal"), rs.getInt("wave"),
                    rs.getString("kind"), rs.getString("purpose"), rs.getString("agent_order"), rs.getString("state"),
                    rs.getLong("requirement_revision"), rs.getObject("check_node_id", UUID.class), rs.getString("outcome"),
                    rs.getString("check_outcome"), rs.getString("cycle_state"), prerequisites.getOrDefault(node, List.of()));
        });
    }
}
