package agentship.platform.runtime.infrastructure;

import agentship.platform.runtime.application.port.RepairStore;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
class JdbcRepairStore implements RepairStore {
    private final NamedParameterJdbcTemplate jdbc;

    JdbcRepairStore(NamedParameterJdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @Override
    public List<Map<String, Object>> eligibleChecks(UUID run) {
        return jdbc.queryForList("""
                SELECT c.check_node_id,c.current_wave,c.automatic_repair_count,w.automatic_repair_limit
                FROM check_cycle c JOIN workflow_check w USING (workflow_id,workflow_version,check_node_id)
                WHERE c.run_id=:run AND c.state='repair' AND NOT EXISTS (
                    SELECT 1 FROM repair_round rr
                    WHERE (rr.run_id,rr.check_node_id,rr.triggering_wave)=(c.run_id,c.check_node_id,c.current_wave))
                ORDER BY c.check_node_id
                """, Map.of("run", run));
    }

    @Override
    public void limitReached(Map<String, Object> run, UUID node) {
        jdbc.update("UPDATE check_cycle SET state='limit_reached' WHERE run_id=:run AND check_node_id=:check",
                args(run, node));
    }

    @Override
    public Integer recheckSource(Map<String, Object> run, UUID check) {
        return jdbc.queryForObject("""
                SELECT w.recheck_of_round FROM check_wave w JOIN check_cycle c
                  ON (c.run_id,c.check_node_id,c.current_wave)=(w.run_id,w.check_node_id,w.wave)
                WHERE w.run_id=:run AND w.check_node_id=:check
                """, args(run, check), Integer.class);
    }

    @Override
    public void stop(Map<String, Object> run, UUID check) {
        var args = args(run, check);
        jdbc.update("""
                UPDATE run SET state='stopped',reason_code='RUN_STOPPED_BY_OPERATOR',finished_at=statement_timestamp(),
                    state_version=state_version+1 WHERE id=:run AND finished_at IS NULL
                """, args);
        jdbc.update("UPDATE check_cycle SET state='stopped' WHERE run_id=:run AND state<>'pass'", args);
        jdbc.update("UPDATE repair_round SET state='stopped' WHERE run_id=:run AND state IN ('queued','running')", args);
        jdbc.update("""
                UPDATE node_execution e SET state='stopped' WHERE e.run_id=:run AND e.state NOT IN ('complete','skipped','stopped')
                AND e.wave=(SELECT max(x.wave) FROM node_execution x WHERE (x.run_id,x.node_id)=(e.run_id,e.node_id))
                """, args);
        jdbc.update("""
                UPDATE task_attempt a SET state='canceled' FROM role_task t
                WHERE a.task_id=t.id AND t.run_id=:run AND a.attempt_number=t.current_attempt
                  AND a.state IN ('queued','leased','running','waiting_reply','needs_attention')
                """, args);
    }

    @Override
    public boolean actionAvailable(Map<String, Object> run, UUID check, String state) {
        return Boolean.TRUE.equals(jdbc.queryForObject("""
                SELECT check_action_is_available(:run,:check,:state)
                """, args(run, check).addValue("state", state), Boolean.class));
    }

    @Override
    public int startRound(Map<String, Object> run, UUID check, UUID actor) {
        boolean manual = actor != null;
        var args = args(run, check).addValue("actor", actor).addValue("manual", manual)
                .addValue("kind", manual ? "manual" : "automatic");
        return jdbc.update("""
                WITH updated AS (
                    UPDATE check_cycle c SET state='repair',
                        automatic_repair_count=c.automatic_repair_count+CASE WHEN :manual THEN 0 ELSE 1 END,
                        manual_repair_count=c.manual_repair_count+CASE WHEN :manual THEN 1 ELSE 0 END
                    FROM workflow_check w,check_wave wave
                    WHERE c.run_id=:run AND c.check_node_id=:check
                      AND (w.workflow_id,w.workflow_version,w.check_node_id)=(c.workflow_id,c.workflow_version,c.check_node_id)
                      AND (wave.run_id,wave.check_node_id,wave.wave)=(c.run_id,c.check_node_id,c.current_wave)
                      AND wave.outcome='repair'
                      AND (:manual AND c.state='limit_reached' OR NOT :manual AND c.state='repair'
                           AND c.automatic_repair_count<w.automatic_repair_limit)
                      AND NOT EXISTS (SELECT 1 FROM repair_round rr
                          WHERE (rr.run_id,rr.check_node_id,rr.triggering_wave)=(c.run_id,c.check_node_id,c.current_wave))
                    RETURNING c.run_id,c.check_node_id,c.current_wave,c.automatic_repair_count+c.manual_repair_count AS round_number
                )
                INSERT INTO repair_round(run_id,check_node_id,round_number,triggering_wave,kind,authorized_by,state)
                SELECT run_id,check_node_id,round_number,current_wave,:kind,:actor,'queued' FROM updated
                """, args);
    }

    @Override
    public List<Map<String, Object>> usedRoute(Map<String, Object> run, UUID check) {
        return jdbc.queryForList(REPAIR_SUBTREE + """
                SELECT latest.node_id,latest.wave,n.kind FROM (
                    SELECT DISTINCT ON (e.node_id) e.node_id,e.wave,e.state
                    FROM node_execution e JOIN subtree m ON e.node_id=m.node_id
                    WHERE e.run_id=:run ORDER BY e.node_id,e.wave DESC
                ) latest JOIN workflow_node n ON (n.workflow_id,n.workflow_version,n.node_id)=(:workflow,:version,latest.node_id)
                WHERE latest.state<>'blocked' ORDER BY latest.node_id
                """, args(run, check));
    }

    @Override
    public List<Map<String, Object>> activeRounds(UUID run) {
        return jdbc.queryForList(ACTIVE_ROUNDS, Map.of("run", run));
    }

    @Override
    public void finishRound(Map<String, Object> run, UUID check, int number) {
        jdbc.update("UPDATE repair_round SET state='complete' WHERE run_id=:run AND check_node_id=:check AND round_number=:round",
                args(run, check).addValue("round", number));
    }

    @Override
    public void markClaimed(Map<String, Object> run, UUID node) {
        var args = args(run, node);
        jdbc.update("""
                WITH RECURSIVE ancestors(check_node_id,outcome) AS (
                    SELECT check_node_id,outcome FROM workflow_route_node
                    WHERE (workflow_id,workflow_version,node_id)=(:workflow,:version,:check)
                    UNION
                    SELECT m.check_node_id,m.outcome FROM workflow_route_node m JOIN ancestors a ON m.node_id=a.check_node_id
                    WHERE (m.workflow_id,m.workflow_version)=(:workflow,:version)
                )
                UPDATE repair_round r SET state='running' FROM check_cycle c,ancestors a
                WHERE (r.run_id,r.check_node_id,r.triggering_wave)=(c.run_id,c.check_node_id,c.current_wave)
                  AND r.run_id=:run AND r.state='queued' AND c.state='repair'
                  AND r.check_node_id=a.check_node_id AND a.outcome='repair'
                """, args);
    }

    @Override
    public int nextWave(Map<String, Object> run, UUID check) {
        return jdbc.queryForObject("""
                SELECT current_wave+1 FROM check_cycle WHERE run_id=:run AND check_node_id=:check
                """, args(run, check), Integer.class);
    }

    @Override
    public void newExecution(Map<String, Object> run, UUID node, int wave, String state) {
        jdbc.update("""
                INSERT INTO node_execution(id,run_id,workflow_id,workflow_version,node_id,wave,requirement_revision,state)
                VALUES(:id,:run,:workflow,:version,:check,:wave,:revision,:state)
                """, args(run, node).addValue("id", UUID.randomUUID()).addValue("wave", wave).addValue("state", state));
    }

    @Override
    public void pendingCheck(Map<String, Object> run, UUID node, int wave, Integer round) {
        var args = args(run, node).addValue("wave", wave).addValue("round", round);
        jdbc.update("""
                INSERT INTO check_cycle(run_id,workflow_id,workflow_version,check_node_id,current_wave,state)
                VALUES(:run,:workflow,:version,:check,:wave,'pending')
                ON CONFLICT(run_id,check_node_id) DO UPDATE SET current_wave=:wave,state='pending'
                """, args);
        jdbc.update("""
                INSERT INTO check_wave(run_id,check_node_id,wave,requirement_revision,outcome,recheck_of_round)
                VALUES(:run,:check,:wave,:revision,'pending',:round)
                """, args);
    }

    private MapSqlParameterSource args(Map<String, Object> run, UUID check) {
        return new MapSqlParameterSource("run", run.get("id")).addValue("check", check)
                .addValue("workflow", run.get("workflow_id")).addValue("version", run.get("workflow_version"))
                .addValue("revision", run.get("current_revision"));
    }

    private static final String ACTIVE_ROUNDS = """
            SELECT r.check_node_id,r.round_number FROM repair_round r JOIN check_cycle c
              ON (r.run_id,r.check_node_id,r.triggering_wave)=(c.run_id,c.check_node_id,c.current_wave)
            WHERE r.run_id=:run AND c.state='repair' AND r.state IN ('queued','running') ORDER BY r.check_node_id
            """;

    private static final String REPAIR_SUBTREE = """
            WITH RECURSIVE subtree(node_id) AS (
                SELECT node_id FROM workflow_route_node
                WHERE (workflow_id,workflow_version,check_node_id,outcome)=(:workflow,:version,:check,'repair')
                UNION
                SELECT m.node_id FROM workflow_route_node m JOIN subtree p ON m.check_node_id=p.node_id
                WHERE (m.workflow_id,m.workflow_version)=(:workflow,:version)
            )
            """;
}
