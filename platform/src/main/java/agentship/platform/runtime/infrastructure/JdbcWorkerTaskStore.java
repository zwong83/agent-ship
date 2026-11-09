package agentship.platform.runtime.infrastructure;

import agentship.platform.device.api.WorkerDevices;
import agentship.platform.runtime.application.port.RunLocks;
import agentship.platform.runtime.application.port.WorkerTaskStore;
import agentship.platform.web.ApiProblem;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
class JdbcWorkerTaskStore implements WorkerTaskStore {
    private final NamedParameterJdbcTemplate jdbc;
    private final RunLocks runs;
    private final WorkerDevices devices;

    JdbcWorkerTaskStore(NamedParameterJdbcTemplate jdbc, RunLocks runs, WorkerDevices devices) {
        this.jdbc = jdbc;
        this.runs = runs;
        this.devices = devices;
    }

    @Override
    public TaskContext lock(UUID device, UUID task, boolean skip) {
        var ids=jdbc.queryForList("SELECT t.run_id,r.requirement_id FROM role_task t JOIN run r ON r.id=t.run_id WHERE t.id=:task AND t.device_id=:device AND t.kind IN ('git','agent','coordinator')",
                Map.of("task",task,"device",device));
        if(ids.isEmpty()) throw new ApiProblem(404,"NOT_FOUND","任务不存在或不属于当前电脑");
        var identity=ids.getFirst();
        var run=runs.lock((UUID) identity.get("run_id"), (UUID) identity.get("requirement_id"), skip);
        if(run==null) return null;
        var attempt=jdbc.queryForMap("""
                SELECT a.*,t.current_attempt,t.kind,t.execution_id,t.node_id,t.requirement_revision,t.agent_id,t.agent_version
                FROM task_attempt a JOIN role_task t ON t.id=a.task_id AND t.current_attempt=a.attempt_number
                WHERE t.id=:id FOR UPDATE OF t,a
                """,Map.of("id",task));
        devices.requireActive(device, !skip);
        return new TaskContext(task, run, attempt);
    }

    @Override
    public void attention(TaskContext context, String code) {
        jdbc.update("""
                UPDATE task_attempt SET state='needs_attention',reason_code=:code,
                    available_at=statement_timestamp()+interval '30 seconds' WHERE task_id=:task AND attempt_number=:attempt
                """,Map.of("code",code,"task",context.task(),"attempt",context.attempt().get("attempt_number")));
        jdbc.update("UPDATE run SET state='needs_attention',reason_code=:code,state_version=state_version+1 WHERE id=:id",
                Map.of("id",context.runId(),"code",code));
    }

    @Override
    public List<Candidate> candidates(UUID device, boolean agents) {
        return jdbc.query(CANDIDATE_SELECT+"""
                JOIN task_attempt a ON a.task_id=t.id AND a.attempt_number=t.current_attempt
                WHERE t.device_id=:device AND r.finished_at IS NULL
                  AND (t.kind='git' OR (:agents AND t.kind IN ('agent','coordinator')
                    AND (e.state IN ('ready','running') OR
                         t.kind='agent' AND n.agent_order='parallel' AND e.state IN ('waiting_reply','needs_attention'))
                    AND task_route_is_open(t.run_id,t.node_id)))
                  AND
                  ((a.state='queued' AND a.available_at<=statement_timestamp()) OR
                   (a.state IN ('leased','running') AND a.lease_deadline<=statement_timestamp()) OR
                   (t.kind='git' AND a.state='needs_attention' AND a.reason_code='GIT_OUTCOME_UNKNOWN' AND a.available_at<=statement_timestamp()))
                ORDER BY r.requirement_id,r.id,stage_order,node_order,role_order,t.id LIMIT 32
                """,Map.of("device", device, "agents", agents), JdbcWorkerTaskStore::candidate);
    }

    @Override
    public Candidate renewal(UUID device, UUID task, boolean agents) {
        var rows = jdbc.query(CANDIDATE_SELECT+"""
                    WHERE t.id=:id AND t.device_id=:device AND (t.kind='git' OR (:agents AND t.kind IN ('agent','coordinator')))
                    """,Map.of("id", task, "device", device, "agents", agents), JdbcWorkerTaskStore::candidate);
        return rows.isEmpty() ? null : rows.getFirst();
    }

    @Override
    public long nextEpoch() {
        return jdbc.queryForObject("SELECT nextval('task_lease_epoch')", Map.of(), Long.class);
    }

    @Override
    public void renew(TaskContext task, Instant deadline) {
        jdbc.update("UPDATE task_attempt SET lease_deadline=:deadline WHERE task_id=:task AND attempt_number=:attempt",
                Map.of("deadline", Timestamp.from(deadline), "task", task.task(), "attempt", task.attempt().get("attempt_number")));
    }

    @Override
    public void lease(TaskContext task, long epoch, Instant deadline) {
        jdbc.update("""
                UPDATE task_attempt SET state='leased',lease_epoch=:epoch,lease_deadline=:deadline,last_event_sequence=0
                WHERE task_id=:task AND attempt_number=:attempt
                """, Map.of("epoch", epoch, "deadline", Timestamp.from(deadline), "task", task.task(),
                "attempt", task.attempt().get("attempt_number")));
    }

    @Override
    public void recordEvent(TaskContext task, UUID receipt, long sequence, String type, String key) {
        jdbc.update("""
                INSERT INTO task_event(id,task_id,attempt_number,lease_epoch,event_sequence,event_type,request_key)
                VALUES(:id,:task,:attempt,:epoch,:sequence,:type,:key)
                """, Map.of("id", receipt, "task", task.task(), "attempt", task.attempt().get("attempt_number"),
                "epoch", task.epoch(), "sequence", sequence, "type", type, "key", key));
    }

    @Override
    public void saveGitProgress(TaskContext task, String checkpoint) {
        jdbc.update("UPDATE task_attempt SET state='running',checkpoint=CAST(:checkpoint AS jsonb) WHERE task_id=:task AND attempt_number=:attempt",
                Map.of("checkpoint", checkpoint, "task", task.task(), "attempt", task.attempt().get("attempt_number")));
    }

    @Override
    public void succeed(TaskContext task) {
        jdbc.update("UPDATE task_attempt SET state='succeeded',reason_code=NULL WHERE task_id=:task AND attempt_number=:attempt",
                Map.of("task", task.task(), "attempt", task.attempt().get("attempt_number")));
    }

    @Override
    public void eventAccepted(TaskContext task, long sequence) {
        jdbc.update("UPDATE task_attempt SET last_event_sequence=:sequence WHERE task_id=:task AND attempt_number=:attempt",
                Map.of("sequence", sequence, "task", task.task(), "attempt", task.attempt().get("attempt_number")));
    }

    private static Candidate candidate(ResultSet rs, int row) throws SQLException {
        return new Candidate(rs.getObject("id", UUID.class), rs.getObject("requirement_id", UUID.class),
                rs.getObject("run_id", UUID.class), rs.getString("kind"), rs.getInt("stage_order"),
                rs.getInt("node_order"), rs.getInt("role_order"));
    }

    private static final String CANDIDATE_SELECT="""
            SELECT t.id,r.requirement_id,r.id AS run_id,t.kind,coalesce(s.ordinal,0) AS stage_order,
                coalesce(n.ordinal,0) AS node_order,coalesce(w.ordinal,0) AS role_order
            FROM role_task t JOIN run r ON r.id=t.run_id
            LEFT JOIN node_execution e ON e.id=t.execution_id
            LEFT JOIN workflow_node n ON (n.workflow_id,n.workflow_version,n.node_id)=(t.workflow_id,t.workflow_version,t.node_id)
            LEFT JOIN workflow_stage s ON (s.workflow_id,s.workflow_version,s.stage_id)=(n.workflow_id,n.workflow_version,n.stage_id)
            LEFT JOIN workflow_role w ON (w.workflow_id,w.workflow_version,w.node_id,w.agent_id)=(t.workflow_id,t.workflow_version,t.node_id,t.agent_id)
            """;
}
