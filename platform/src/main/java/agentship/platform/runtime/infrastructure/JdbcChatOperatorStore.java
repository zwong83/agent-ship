package agentship.platform.runtime.infrastructure;

import agentship.platform.runtime.application.port.ChatOperatorStore;
import agentship.platform.web.ApiProblem;
import java.security.MessageDigest;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
class JdbcChatOperatorStore implements ChatOperatorStore {
    private static final String CLEAR_HOLDER = """
            holder_account_id=NULL,holder_session_id=NULL,holder_tab_id=NULL,heartbeat_until=NULL,grace_until=NULL
            """;
    private final NamedParameterJdbcTemplate jdbc;

    JdbcChatOperatorStore(NamedParameterJdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @Override
    public Lease acquire(LeaseKey key) {
        var acquired = jdbc.query("""
                INSERT INTO chat_lease(run_id,epoch,holder_account_id,holder_session_id,holder_tab_id,heartbeat_until,grace_until)
                VALUES(:run,1,:actor,:session,:tab,statement_timestamp()+interval '30 seconds',
                    statement_timestamp()+interval '5 minutes 30 seconds')
                ON CONFLICT(run_id) DO UPDATE SET
                    epoch=CASE WHEN chat_lease.holder_account_id=:actor AND chat_lease.holder_session_id=:session
                        AND chat_lease.holder_tab_id=:tab AND chat_lease.grace_until>statement_timestamp()
                        THEN chat_lease.epoch ELSE chat_lease.epoch+1 END,
                    holder_account_id=:actor,holder_session_id=:session,holder_tab_id=:tab,
                    heartbeat_until=EXCLUDED.heartbeat_until,grace_until=EXCLUDED.grace_until
                WHERE chat_lease.holder_account_id IS NULL OR chat_lease.grace_until<=statement_timestamp()
                    OR (chat_lease.holder_account_id=:actor AND chat_lease.holder_session_id=:session AND chat_lease.holder_tab_id=:tab)
                    OR NOT active_browser_session(chat_lease.holder_account_id,chat_lease.holder_session_id)
                    OR NOT can_chat(:run,chat_lease.holder_account_id)
                RETURNING epoch,heartbeat_until
                """, args(key, null), JdbcChatOperatorStore::lease);
        return acquired.isEmpty() ? null : acquired.getFirst();
    }

    @Override
    public String holderName(UUID run) {
        var names = jdbc.query("""
                SELECT a.display_name FROM chat_lease l JOIN account a ON a.id=l.holder_account_id
                WHERE l.run_id=:run AND active_browser_session(l.holder_account_id,l.holder_session_id)
                    AND can_chat(l.run_id,l.holder_account_id)
                """, Map.of("run", run), (rs, index) -> rs.getString(1));
        return names.isEmpty() ? null : names.getFirst();
    }

    @Override
    public boolean release(LeaseKey key, long epoch) {
        int released = jdbc.update("UPDATE chat_lease SET " + CLEAR_HOLDER + """
                WHERE run_id=:run AND holder_account_id=:actor AND holder_session_id=:session
                  AND holder_tab_id=:tab AND epoch=:epoch
                """, args(key, epoch));
        return released == 1;
    }

    @Override
    public Lease renew(LeaseKey key, long epoch) {
        var renewed = jdbc.query("""
                UPDATE chat_lease SET heartbeat_until=statement_timestamp()+interval '30 seconds',
                    grace_until=statement_timestamp()+interval '5 minutes 30 seconds'
                WHERE run_id=:run AND holder_account_id=:actor AND holder_session_id=:session
                    AND holder_tab_id=:tab AND epoch=:epoch AND grace_until>statement_timestamp()
                    AND active_browser_session(:actor,:session)
                RETURNING epoch,heartbeat_until
                """, args(key, epoch), JdbcChatOperatorStore::lease);
        return renewed.isEmpty() ? null : renewed.getFirst();
    }

    @Override
    public void lockLease(UUID run) {
        jdbc.queryForList("SELECT run_id FROM chat_lease WHERE run_id=:run FOR UPDATE", Map.of("run", run));
    }

    @Override
    public boolean hasActiveLease(LeaseKey key, long epoch) {
        return Boolean.TRUE.equals(jdbc.queryForObject("SELECT holds_active_chat(:run,:actor,:session,:tab,:epoch)",
                args(key, epoch), Boolean.class));
    }

    @Override
    public boolean canChat(UUID run, UUID actor) {
        return Boolean.TRUE.equals(jdbc.queryForObject("SELECT can_chat(:run,:actor)",
                Map.of("run", run, "actor", actor), Boolean.class));
    }

    @Override
    public boolean isInitiator(UUID run, UUID actor) {
        return Boolean.TRUE.equals(jdbc.queryForObject("SELECT EXISTS(SELECT 1 FROM run WHERE id=:run AND initiator_id=:actor)",
                Map.of("run", run, "actor", actor), Boolean.class));
    }

    @Override
    public List<Map<String, Object>> targets(UUID run) {
        return jdbc.query("""
                SELECT n.node_id,n.name,c.current_wave,c.state,c.automatic_repair_count,c.manual_repair_count,w.automatic_repair_limit
                FROM check_cycle c JOIN run r ON r.id=c.run_id
                JOIN workflow_check w ON (w.workflow_id,w.workflow_version,w.check_node_id)
                    =(c.workflow_id,c.workflow_version,c.check_node_id)
                JOIN workflow_node n ON (n.workflow_id,n.workflow_version,n.node_id)=(c.workflow_id,c.workflow_version,c.check_node_id)
                WHERE c.run_id=:run AND r.finished_at IS NULL AND c.state IN ('limit_reached','unresolved')
                    AND check_action_is_available(c.run_id,c.check_node_id,c.state) ORDER BY n.name,n.node_id
                """, Map.of("run", run), (rs, index) -> Map.of(
                    "nodeId", rs.getObject("node_id", UUID.class), "name", rs.getString("name"),
                    "wave", rs.getInt("current_wave"), "status", rs.getString("state"),
                    "automaticRepairCount", rs.getInt("automatic_repair_count"), "automaticRepairLimit", rs.getInt("automatic_repair_limit"),
                    "manualRepairCount", rs.getInt("manual_repair_count"), "actions",
                    "limit_reached".equals(rs.getString("state")) ? List.of("repair", "stop") : List.of("recheck")));
    }

    @Override
    public Long checkWave(UUID run, UUID check) {
        var waves = jdbc.query("SELECT current_wave FROM check_cycle WHERE run_id=:run AND check_node_id=:check",
                Map.of("run", run, "check", check), (rs, row) -> rs.getLong("current_wave"));
        return waves.isEmpty() ? null : waves.getFirst();
    }

    @Override
    public List<Map<String, Object>> guests(UUID run) {
        return jdbc.query("""
                SELECT a.id,a.username,a.display_name FROM run_permission p JOIN account a ON a.id=p.account_id
                WHERE p.run_id=:run AND p.capability='chat' AND p.revoked_at IS NULL
                    AND (p.expires_at IS NULL OR p.expires_at>statement_timestamp()) ORDER BY a.username_key
                """, Map.of("run", run), (rs, index) -> Map.of("id", rs.getObject("id", UUID.class),
                    "username", rs.getString("username"), "displayName", rs.getString("display_name")));
    }

    @Override
    public UUID activeAccount(String username) {
        var accounts = jdbc.query("SELECT id FROM account WHERE username_key=:name AND status='active'",
                Map.of("name", username), (rs, index) -> rs.getObject(1, UUID.class));
        return accounts.isEmpty() ? null : accounts.getFirst();
    }

    @Override
    public boolean isDeputy(UUID requirement, UUID account) {
        Boolean deputy = jdbc.queryForObject("""
                SELECT EXISTS(SELECT 1 FROM configuration_deputy WHERE configuration_id=:requirement
                    AND account_id=:target AND revoked_at IS NULL)
                """, Map.of("requirement", requirement, "target", account), Boolean.class);
        return Boolean.TRUE.equals(deputy);
    }

    @Override
    public void grant(UUID run, UUID target, UUID actor) {
        jdbc.update("""
                INSERT INTO run_permission(run_id,account_id,capability,granted_by) VALUES(:run,:target,'chat',:actor)
                ON CONFLICT(run_id,account_id,capability) DO UPDATE SET granted_by=:actor,
                    granted_at=statement_timestamp(),revoked_at=NULL,expires_at=NULL
                """, Map.of("run", run, "target", target, "actor", actor));
    }

    @Override
    public void revoke(UUID run, UUID target) {
        var args = Map.of("run", run, "target", target);
        jdbc.update("""
                UPDATE run_permission SET revoked_at=statement_timestamp()
                WHERE run_id=:run AND account_id=:target AND capability='chat' AND revoked_at IS NULL
                """, args);
        jdbc.update("UPDATE chat_lease SET " + CLEAR_HOLDER + " WHERE run_id=:run AND holder_account_id=:target", args);
    }

    @Override
    public UUID reserve(Command command) {
        var args = args(command);
        int inserted = jdbc.update("""
                INSERT INTO command_receipt(actor_kind,actor_account_id,scope,request_key,request_digest)
                VALUES('account',:actor,:scope,:key,:digest) ON CONFLICT(actor_kind,actor_id,scope,request_key) DO NOTHING
                """, args);
        if (inserted == 1) return null;
        var existing = jdbc.queryForMap("""
                SELECT request_digest,result_id FROM command_receipt
                WHERE actor_kind='account' AND actor_id=:actor AND scope=:scope AND request_key=:key
                """, args);
        if (!MessageDigest.isEqual(command.digest(), (byte[]) existing.get("request_digest"))) {
            throw new ApiProblem(409, "IDEMPOTENCY_CONFLICT", "同一请求标识不能用于不同操作。");
        }
        return (UUID) existing.get("result_id");
    }

    @Override
    public void accept(Command command, UUID receipt, UUID target, String kind, String action, String requestId) {
        jdbc.update("""
                INSERT INTO audit_event(id,request_id,actor_account_id,run_id,target_kind,target_id,action,outcome)
                VALUES(:id,:request,:actor,:run,:kind,:target,:action,'accepted')
                """, Map.of("id", receipt, "request", requestId, "actor", command.actor(), "run", command.run(), "kind", kind, "target", target, "action", action));
        jdbc.update("""
                UPDATE command_receipt SET result_kind='audit_event',result_id=:receipt,accepted_at=statement_timestamp()
                WHERE actor_kind='account' AND actor_id=:actor AND scope=:scope AND request_key=:key
                """, args(command).addValue("receipt", receipt));
    }

    private static Lease lease(ResultSet row, int index) throws SQLException {
        return new Lease(row.getLong("epoch"), row.getTimestamp("heartbeat_until").toInstant());
    }

    private static MapSqlParameterSource args(LeaseKey key, Long epoch) {
        return new MapSqlParameterSource("run", key.run()).addValue("actor", key.actor())
                .addValue("session", key.session()).addValue("tab", key.tab()).addValue("epoch", epoch);
    }

    private static MapSqlParameterSource args(Command command) {
        return new MapSqlParameterSource("actor", command.actor()).addValue("scope", command.scope())
                .addValue("key", command.key()).addValue("digest", command.digest());
    }
}
