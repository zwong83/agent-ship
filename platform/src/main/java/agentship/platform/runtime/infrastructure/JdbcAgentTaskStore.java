package agentship.platform.runtime.infrastructure;

import agentship.platform.runtime.application.port.AgentTaskStore;
import agentship.platform.runtime.application.port.WorkerTaskStore.TaskContext;
import agentship.platform.runtime.domain.SchedulingPolicy.Node;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
class JdbcAgentTaskStore implements AgentTaskStore {
    private final NamedParameterJdbcTemplate jdbc;

    JdbcAgentTaskStore(NamedParameterJdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @Override
    public boolean claimable(TaskContext context) {
        Boolean open = jdbc.queryForObject("""
                SELECT (e.state IN ('ready','running') OR
                    :child AND n.agent_order='parallel' AND e.state IN ('waiting_reply','needs_attention'))
                    AND task_route_is_open(e.run_id,e.node_id)
                FROM node_execution e JOIN workflow_node n
                    ON (n.workflow_id,n.workflow_version,n.node_id)=(e.workflow_id,e.workflow_version,e.node_id)
                WHERE e.id=:execution
                """, new MapSqlParameterSource(execution(context)).addValue("child", "agent".equals(context.attempt().get("kind"))),
                Boolean.class);
        return Boolean.TRUE.equals(open);
    }

    @Override
    public void pinRevision(TaskContext context) {
        var args = new MapSqlParameterSource(execution(context)).addValue("revision", context.run().get("current_revision"));
        int pinned = jdbc.update("""
                UPDATE node_execution SET state='running',started_at=statement_timestamp(),requirement_revision=:revision
                WHERE id=:execution AND state='ready' AND started_at IS NULL
                """, args);
        if (pinned == 1) {
            jdbc.update("UPDATE role_task SET requirement_revision=:revision WHERE execution_id=:execution", args);
        }
    }

    @Override
    public Map<String, Object> dispatchDetails(UUID task) {
        return jdbc.queryForMap("""
                SELECT e.wave,e.requirement_revision,e.node_id,n.name,n.kind,n.purpose,n.agent_order,
                    a.role_key,v.display_name,v.instruction,v.skill_ref,r.title,r.description
                FROM role_task t JOIN node_execution e ON e.id=t.execution_id
                JOIN workflow_node n ON (n.workflow_id,n.workflow_version,n.node_id)=(e.workflow_id,e.workflow_version,e.node_id)
                JOIN agent_definition a ON a.id=t.agent_id
                JOIN agent_version v ON (v.agent_id,v.version)=(t.agent_id,t.agent_version)
                JOIN run_requirement_revision r ON (r.run_id,r.revision)=(e.run_id,e.requirement_revision)
                WHERE t.id=:task
                """, Map.of("task", task));
    }

    @Override
    public List<UUID> dependencies(Map<String, Object> run, Object node) {
        return jdbc.query("""
                SELECT prerequisite_node_id FROM workflow_dependency
                WHERE (workflow_id,workflow_version,node_id)=(:workflow,:version,:node) ORDER BY prerequisite_node_id
                """, Map.of("workflow", run.get("workflow_id"), "version", run.get("workflow_version"), "node", node),
                (rs, index) -> rs.getObject(1, UUID.class));
    }

    @Override
    public List<Map<String, Object>> upstream(TaskContext context) {
        return jdbc.query("""
                WITH RECURSIVE target AS (SELECT * FROM node_execution WHERE id=:execution),
                repaired(node_id) AS (
                    SELECT m.node_id FROM target t JOIN check_wave cw
                        ON (cw.run_id,cw.check_node_id,cw.wave)=(t.run_id,t.node_id,t.wave)
                    JOIN repair_round rr ON (rr.run_id,rr.check_node_id,rr.round_number)=
                        (cw.run_id,cw.check_node_id,cw.recheck_of_round) AND rr.state='complete'
                    JOIN workflow_route_node m ON (m.workflow_id,m.workflow_version,m.check_node_id,m.outcome)=
                        (t.workflow_id,t.workflow_version,t.node_id,'repair')
                    UNION
                    SELECT m.node_id FROM repaired p JOIN workflow_route_node m
                        ON m.check_node_id=p.node_id AND m.outcome='pass'
                    JOIN target t ON (m.workflow_id,m.workflow_version)=(t.workflow_id,t.workflow_version)
                )
                SELECT a.*,e.node_id,e.wave,p.provider_repository_id FROM artifact a
                JOIN role_task t ON t.id=a.task_id AND t.kind='coordinator'
                JOIN task_attempt u ON (u.task_id,u.attempt_number,u.attempt_id)=(t.id,t.current_attempt,a.attempt_id)
                JOIN node_execution e ON e.id=a.execution_id
                JOIN workflow_node n ON (n.workflow_id,n.workflow_version,n.node_id)=(e.workflow_id,e.workflow_version,e.node_id)
                JOIN workflow_stage s ON (s.workflow_id,s.workflow_version,s.stage_id)=(n.workflow_id,n.workflow_version,n.stage_id)
                CROSS JOIN target
                LEFT JOIN repository p ON p.id=a.repository_id
                WHERE a.run_id=:run AND u.state='succeeded'
                  AND e.wave=(SELECT max(x.wave) FROM node_execution x WHERE x.run_id=e.run_id AND x.node_id=e.node_id)
                  AND (e.state='complete' AND (EXISTS (SELECT 1 FROM repaired r WHERE r.node_id=e.node_id)
                    OR EXISTS (SELECT 1 FROM workflow_dependency d
                    WHERE (d.workflow_id,d.workflow_version,d.node_id,d.prerequisite_node_id)
                        =(target.workflow_id,target.workflow_version,target.node_id,e.node_id)))
                    OR EXISTS (SELECT 1 FROM workflow_route_node m
                        JOIN check_cycle c ON c.run_id=e.run_id AND c.check_node_id=m.check_node_id
                        JOIN check_wave cw ON (cw.run_id,cw.check_node_id,cw.wave)=(c.run_id,c.check_node_id,c.current_wave)
                        WHERE (m.workflow_id,m.workflow_version,m.node_id,m.check_node_id)
                            =(target.workflow_id,target.workflow_version,target.node_id,e.node_id)
                            AND c.state=m.outcome AND c.current_wave=e.wave AND cw.report_artifact_id=a.id))
                ORDER BY EXISTS(SELECT 1 FROM repaired r WHERE r.node_id=e.node_id) DESC,
                         s.ordinal DESC,n.ordinal DESC,e.wave DESC,a.id
                """, Map.of("run", context.runId(), "execution", context.attempt().get("execution_id")), this::artifact);
    }

    @Override
    public List<Map<String, Object>> siblings(TaskContext context) {
        boolean coordinator = "coordinator".equals(context.attempt().get("kind"));
        var args = new MapSqlParameterSource(execution(context)).addValue("task", context.task())
                .addValue("coordinator", coordinator);
        return jdbc.query("""
                SELECT a.*,e.node_id,e.wave,p.provider_repository_id FROM artifact a
                JOIN role_task t ON t.id=a.task_id AND t.kind='agent'
                JOIN task_attempt u ON (u.task_id,u.attempt_number,u.attempt_id)=(t.id,t.current_attempt,a.attempt_id)
                JOIN node_execution e ON e.id=a.execution_id
                JOIN workflow_node n ON (n.workflow_id,n.workflow_version,n.node_id)=(e.workflow_id,e.workflow_version,e.node_id)
                JOIN workflow_role w ON (w.workflow_id,w.workflow_version,w.node_id,w.agent_id)=(t.workflow_id,t.workflow_version,t.node_id,t.agent_id)
                JOIN role_task current_task ON current_task.id=:task
                JOIN workflow_role selected_role ON (selected_role.workflow_id,selected_role.workflow_version,selected_role.node_id,selected_role.agent_id)
                    =(current_task.workflow_id,current_task.workflow_version,current_task.node_id,current_task.agent_id)
                LEFT JOIN repository p ON p.id=a.repository_id
                WHERE a.execution_id=:execution AND u.state='succeeded'
                    AND (:coordinator OR n.agent_order='serial' AND w.ordinal<selected_role.ordinal)
                ORDER BY w.ordinal,a.id
                """, args, this::artifact);
    }

    private Map<String, Object> artifact(ResultSet rs, int row) throws SQLException {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("id", rs.getObject("id", UUID.class));
        result.put("kind", rs.getString("kind"));
        result.put("title", rs.getString("title"));
        result.put("runId", rs.getObject("run_id", UUID.class));
        result.put("nodeId", rs.getObject("node_id", UUID.class));
        result.put("wave", rs.getInt("wave"));
        result.put("attemptId", rs.getObject("attempt_id", UUID.class));
        result.put("requirementRevision", rs.getLong("requirement_revision"));
        result.put("mode", rs.getString("mode"));
        result.put("createdAt", rs.getTimestamp("created_at").toInstant().toString());
        result.put("sourceRef", rs.getString("source_ref"));
        put(result, "commit", rs.getString("commit_id"));
        put(result, "repositoryId", rs.getString("provider_repository_id"));
        put(result, "workBranch", rs.getString("work_branch"));
        byte[] digest = rs.getBytes("content_digest");
        if (digest != null) result.put("contentDigest", "sha256:" + HexFormat.of().formatHex(digest));
        return result;
    }

    @Override
    public void pinCheckCandidate(TaskContext context, Map<String, Object> node, Map<String, Object> candidate) {
        var args = new MapSqlParameterSource("run", context.runId()).addValue("node", node.get("node_id"))
                .addValue("wave", node.get("wave")).addValue("revision", node.get("requirement_revision"))
                .addValue("workflow", context.run().get("workflow_id")).addValue("version", context.run().get("workflow_version"))
                .addValue("commit", candidate.get("commit")).addValue("candidate", candidate.get("version"));
        jdbc.update("""
                INSERT INTO check_cycle(run_id,workflow_id,workflow_version,check_node_id,current_wave,state)
                VALUES(:run,:workflow,:version,:node,:wave,'pending') ON CONFLICT(run_id,check_node_id) DO NOTHING
                """, args);
        jdbc.update("""
                INSERT INTO check_wave(run_id,check_node_id,wave,requirement_revision,outcome,checked_commit,checked_artifact_version)
                VALUES(:run,:node,:wave,:revision,'pending',:commit,:candidate)
                ON CONFLICT(run_id,check_node_id,wave) DO UPDATE SET requirement_revision=:revision,
                    checked_commit=:commit,checked_artifact_version=:candidate
                WHERE check_wave.outcome='pending' AND check_wave.checked_commit IS NULL
                """, args);
    }

    @Override
    public Map<String, Object> checkCandidate(TaskContext context, Object node, Object wave) {
        var pinned = jdbc.queryForList("""
                SELECT checked_commit AS commit,checked_artifact_version AS version FROM check_wave
                WHERE run_id=:run AND check_node_id=:node AND wave=:wave AND checked_commit IS NOT NULL
                """, Map.of("run", context.runId(), "node", node, "wave", wave));
        return pinned.isEmpty() ? null : pinned.getFirst();
    }

    @Override
    public void progress(TaskContext context, String thread, String checkpoint) {
        jdbc.update("""
                UPDATE task_attempt SET state='running',checkpoint=coalesce(checkpoint,'{}'::jsonb) || CAST(:checkpoint AS jsonb),
                    session_ref=coalesce(:thread,session_ref) WHERE task_id=:task AND attempt_number=:attempt
                """, attempt(context).addValue("checkpoint", checkpoint).addValue("thread", thread));
    }

    @Override
    public UUID saveArtifact(TaskContext context, String kind, String title, String source, byte[] digest, String commit) {
        Object attemptId = context.attempt().get("attempt_id");
        var run = context.run();
        UUID id = UUID.randomUUID();
        var args = new MapSqlParameterSource(execution(context)).addValue("id", id).addValue("run", context.runId())
                .addValue("task", context.task()).addValue("attemptId", attemptId)
                .addValue("revision", context.attempt().get("requirement_revision")).addValue("kind", kind)
                .addValue("mode", run.get("mode")).addValue("title", title).addValue("source", source)
                .addValue("digest", digest).addValue("repository", run.get("repository_id"))
                .addValue("branch", run.get("work_branch")).addValue("commit", commit);
        jdbc.update("""
                INSERT INTO artifact(id,run_id,execution_id,task_id,attempt_id,requirement_revision,kind,mode,title,
                    source_ref,content_digest,repository_id,work_branch,commit_id)
                VALUES(:id,:run,:execution,:task,:attemptId,:revision,:kind,:mode,:title,:source,:digest,:repository,:branch,:commit)
                """, args);
        return id;
    }

    @Override
    public void recordCheck(TaskContext context, Node node, String outcome, String commit, String version, String reason, UUID artifact) {
        var args = new MapSqlParameterSource("run", context.runId()).addValue("node", node.id()).addValue("wave", node.wave())
                .addValue("workflow", context.run().get("workflow_id")).addValue("version", context.run().get("workflow_version"))
                .addValue("revision", node.revision()).addValue("outcome", outcome).addValue("commit", commit)
                .addValue("candidate", version).addValue("reason", reason).addValue("artifact", artifact);
        jdbc.update("""
                INSERT INTO check_cycle(run_id,workflow_id,workflow_version,check_node_id,current_wave,state)
                VALUES(:run,:workflow,:version,:node,:wave,:outcome)
                ON CONFLICT(run_id,check_node_id) DO UPDATE SET current_wave=:wave,state=:outcome
                """, args);
        jdbc.update("""
                INSERT INTO check_wave(run_id,check_node_id,wave,requirement_revision,checked_commit,checked_artifact_version,
                    outcome,reason_code,completed_at,report_artifact_id)
                VALUES(:run,:node,:wave,:revision,:commit,:candidate,:outcome,:reason,statement_timestamp(),:artifact)
                ON CONFLICT(run_id,check_node_id,wave) DO UPDATE SET checked_commit=coalesce(:commit,check_wave.checked_commit),
                    checked_artifact_version=coalesce(:candidate,check_wave.checked_artifact_version),
                    outcome=:outcome,reason_code=:reason,completed_at=statement_timestamp(),report_artifact_id=:artifact
                """, args);
    }

    @Override
    public void skipRepairBranch(TaskContext context, Node node) {
        var args = Map.of("run", context.runId(), "node", node.id(), "workflow", context.run().get("workflow_id"),
                "version", context.run().get("workflow_version"));
        jdbc.update("""
                WITH RECURSIVE inapplicable(node_id) AS (
                    SELECT node_id FROM workflow_route_node
                    WHERE (workflow_id,workflow_version,check_node_id,outcome)=(:workflow,:version,:node,'repair')
                    UNION
                    SELECT m.node_id FROM workflow_route_node m
                    JOIN inapplicable parent ON parent.node_id=m.check_node_id
                    WHERE (m.workflow_id,m.workflow_version)=(:workflow,:version)
                )
                UPDATE node_execution e SET state='skipped' FROM inapplicable
                WHERE e.run_id=:run AND e.state='blocked' AND e.node_id=inapplicable.node_id
                """, args);
    }

    @Override
    public boolean hasDescription(TaskContext context) {
        Boolean result = jdbc.queryForObject("""
                SELECT nullif(btrim(v.description),'') IS NOT NULL
                FROM node_execution e JOIN run r ON r.id=e.run_id
                JOIN run_requirement_revision v ON (v.run_id,v.revision)=(r.id,r.current_revision)
                WHERE e.id=:execution
                """, execution(context), Boolean.class);
        return Boolean.TRUE.equals(result);
    }

    @Override
    public void fail(TaskContext context, String code) {
        jdbc.update("""
                UPDATE task_attempt SET state='failed',reason_code=:reason WHERE task_id=:task AND attempt_number=:attempt
                """, attempt(context).addValue("reason", code));
    }

    @Override
    public void awaitReply(TaskContext context) {
        jdbc.update("""
                UPDATE task_attempt SET state='waiting_reply',reason_code='AGENT_QUESTION_PENDING'
                WHERE task_id=:task AND attempt_number=:attempt
                """, attempt(context));
    }

    @Override
    public void nodeState(TaskContext context, String state) {
        jdbc.update("UPDATE node_execution SET state=:state WHERE id=:execution",
                new MapSqlParameterSource(execution(context)).addValue("state", state));
    }

    private Map<String, Object> execution(TaskContext context) {
        return Map.of("execution", context.attempt().get("execution_id"));
    }

    private MapSqlParameterSource attempt(TaskContext context) {
        return new MapSqlParameterSource("task", context.task()).addValue("attempt", context.attempt().get("attempt_number"));
    }

    private static void put(Map<String, Object> value, String key, Object field) {
        if (field != null) value.put(key, field);
    }
}
