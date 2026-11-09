package agentship.platform.runtime.application.query;

import agentship.platform.web.Actor;
import agentship.platform.web.ApiProblem;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;

@Service
public class RunAttemptHistory {
    private static final String ARTIFACTS = """
            SELECT a.id,a.kind,a.run_id,e.node_id,e.wave,a.attempt_id,a.requirement_revision,a.mode,
                a.created_at,a.title,a.source_ref,p.provider_repository_id,a.work_branch,a.commit_id,
                a.candidate_ref,a.test_outcome,a.content_digest
            FROM artifact a JOIN node_execution e ON e.id=a.execution_id
            LEFT JOIN repository p ON p.id=a.repository_id WHERE a.run_id=:run
            """;
    private final NamedParameterJdbcTemplate jdbc;
    private final RunCursor cursors;

    RunAttemptHistory(NamedParameterJdbcTemplate jdbc, RunCursor cursors) {
        this.jdbc = jdbc;
        this.cursors = cursors;
    }

    @Transactional(readOnly=true,isolation=Isolation.REPEATABLE_READ)
    public Map<String, Object> read(Actor actor, UUID run, UUID node, UUID task, String cursor, Integer requestedSize) {
        int size = pageSize(requestedSize);
        var args = requireVisibleRun(actor, run).addValue("node", node).addValue("task", task).addValue("limit", size + 1);
        String scope = "attempts|" + actor.id() + "|" + run + "|" + node + "|" + task;
        var after = cursors.decode(cursor, scope);
        String continuation = after == null ? "" : " AND (t.id,a.attempt_number)>(:afterTask,:afterAttempt)";
        if (after != null) args.addValue("afterTask", after.id()).addValue("afterAttempt", Integer.parseInt(after.name()));
        var rows = jdbc.query("""
                SELECT t.id AS task_id,a.attempt_id,a.attempt_number,t.kind,a.state,e.node_id,e.wave,d.role_key,v.display_name,
                    CASE WHEN e.id IS NULL OR e.started_at IS NOT NULL THEN t.requirement_revision END AS input_revision,
                    (e.id IS NULL OR e.started_at IS NOT NULL) AND t.requirement_revision<r.current_revision AS old_revision,
                    a.reason_code,a.disposition,
                    ARRAY(SELECT f.id FROM artifact f WHERE f.task_id=t.id AND f.attempt_id=a.attempt_id ORDER BY f.created_at,f.id) AS artifact_ids
                FROM role_task t JOIN task_attempt a ON a.task_id=t.id JOIN run r ON r.id=t.run_id
                LEFT JOIN node_execution e ON e.id=t.execution_id
                LEFT JOIN agent_definition d ON d.id=t.agent_id
                LEFT JOIN agent_version v ON (v.agent_id,v.version)=(t.agent_id,t.agent_version)
                WHERE t.run_id=:run AND (CAST(:node AS uuid) IS NULL OR e.node_id=:node)
                    AND (CAST(:task AS uuid) IS NULL OR t.id=:task)
                """ + continuation + " ORDER BY t.id,a.attempt_number LIMIT :limit", args, (rs, index) -> {
                    Map<String, Object> item = new LinkedHashMap<>();
                    item.put("taskId", rs.getObject("task_id", UUID.class)); item.put("attemptId", rs.getObject("attempt_id", UUID.class));
                    item.put("attemptNumber", rs.getInt("attempt_number")); item.put("kind", rs.getString("kind")); item.put("state", rs.getString("state"));
                    item.put("inputRequirementRevision", rs.getObject("input_revision"));
                    item.put("basedOnOlderRequirementRevision", rs.getBoolean("old_revision"));
                    put(item, "nodeId", rs.getObject("node_id", UUID.class)); put(item, "wave", rs.getObject("wave"));
                    put(item, "roleId", rs.getString("role_key")); put(item, "roleDisplayName", rs.getString("display_name"));
                    String reason = rs.getString("reason_code");
                    put(item, "reasonCode", reason);
                    if (reason != null) put(item, "reason", "git".equals(rs.getString("kind"))
                            ? GitStatusMessages.message(reason) : AgentRunStatus.message(reason));
                    put(item, "disposition", rs.getString("disposition"));
                    item.put("artifactIds", Arrays.asList((Object[]) rs.getArray("artifact_ids").getArray()));
                    return item;
                });
        var page = rows.size() > size ? rows.subList(0, size) : rows;
        String next = null;
        if (rows.size() > size) {
            var last = page.getLast();
            next = cursors.encode(scope, new RunCursor.Position(last.get("attemptNumber").toString(), (UUID) last.get("taskId")));
        }
        addOperatorActions(page, args);
        return page(page, next);
    }

    private void addOperatorActions(List<Map<String, Object>> page, MapSqlParameterSource args) {
        if (page.isEmpty()) return;
        var ids = page.stream().map(row -> (UUID) row.get("attemptId")).toList();
        Map<UUID, List<Map<String, Object>>> byAttempt = new LinkedHashMap<>();
        jdbc.query("""
                SELECT e.target_id AS attempt_id,'retry' AS action,e.occurred_at AS operated_at,p.display_name
                FROM audit_event e JOIN account p ON p.id=e.actor_account_id
                WHERE e.run_id=:run AND e.target_kind='task_attempt' AND e.target_id IN (:attempts)
                    AND e.action='retry' AND e.outcome='accepted'
                UNION ALL
                SELECT a.attempt_id,'skip',a.disposed_at,p.display_name
                FROM task_attempt a JOIN role_task t ON t.id=a.task_id JOIN account p ON p.id=a.disposed_by
                WHERE t.run_id=:run AND a.attempt_id IN (:attempts) AND a.disposition='skipped'
                ORDER BY operated_at,action
                """, args.addValue("attempts", ids), rs -> {
                    var actions = byAttempt.computeIfAbsent(rs.getObject("attempt_id", UUID.class), id -> new ArrayList<>());
                    actions.add(Map.of("action", rs.getString("action"), "operatorDisplayName", rs.getString("display_name"),
                            "operatedAt", rs.getTimestamp("operated_at").toInstant().toString()));
                });
        page.forEach(row -> put(row, "operatorActions", byAttempt.get(row.get("attemptId"))));
    }

    @Transactional(readOnly=true,isolation=Isolation.REPEATABLE_READ)
    public Map<String, Object> readArtifacts(Actor actor, UUID run, String cursor, Integer requestedSize) {
        int size = pageSize(requestedSize);
        var args = requireVisibleRun(actor, run).addValue("limit", size + 1);
        String scope = "artifacts|" + actor.id() + "|" + run;
        var after = cursors.decode(cursor, scope);
        String continuation = after == null ? "" : " AND (a.created_at,a.id)>(:afterTime,:afterId)";
        if (after != null) args.addValue("afterTime", Timestamp.from(Instant.parse(after.name()))).addValue("afterId", after.id());
        var rows = jdbc.query(ARTIFACTS + continuation + " ORDER BY a.created_at,a.id LIMIT :limit", args,
                (rs, index) -> artifactReference(rs));
        var page = rows.size() > size ? rows.subList(0, size) : rows;
        String next = null;
        if (rows.size() > size) {
            var last = page.getLast();
            next = cursors.encode(scope, new RunCursor.Position((String) last.get("createdAt"), (UUID) last.get("id")));
        }
        return page(page, next);
    }

    @Transactional(readOnly=true,isolation=Isolation.REPEATABLE_READ)
    public Map<String, Object> readArtifact(Actor actor, UUID run, UUID artifact) {
        var args = requireVisibleRun(actor, run).addValue("artifact", artifact);
        var rows = jdbc.query(ARTIFACTS + " AND a.id=:artifact", args, (rs, index) -> artifactReference(rs));
        if (rows.isEmpty()) throw new ApiProblem(404, "NOT_FOUND", "产物不存在或没有访问权限。");
        var reference = rows.getFirst();
        return Map.of("reference", reference, "title", reference.get("title"));
    }

    private static Map<String, Object> artifactReference(ResultSet rs) throws SQLException {
        Map<String, Object> item = new LinkedHashMap<>();
        item.put("id", rs.getObject("id", UUID.class)); item.put("kind", rs.getString("kind"));
        item.put("runId", rs.getObject("run_id", UUID.class)); item.put("nodeId", rs.getObject("node_id", UUID.class));
        item.put("wave", rs.getInt("wave")); item.put("attemptId", rs.getObject("attempt_id", UUID.class));
        item.put("requirementRevision", rs.getLong("requirement_revision")); item.put("mode", rs.getString("mode"));
        item.put("createdAt", rs.getTimestamp("created_at").toInstant().toString());
        item.put("title", rs.getString("title")); item.put("sourceRef", rs.getString("source_ref"));
        put(item, "repositoryId", rs.getString("provider_repository_id")); put(item, "workBranch", rs.getString("work_branch"));
        put(item, "commit", rs.getString("commit_id")); put(item, "candidateRef", rs.getString("candidate_ref"));
        put(item, "testOutcome", rs.getString("test_outcome"));
        byte[] digest = rs.getBytes("content_digest");
        if (digest != null) item.put("contentDigest", "sha256:" + HexFormat.of().formatHex(digest));
        return item;
    }

    private MapSqlParameterSource requireVisibleRun(Actor actor, UUID run) {
        var args = new MapSqlParameterSource("actor", actor.id()).addValue("session", actor.sessionId()).addValue("run", run);
        if (!Boolean.TRUE.equals(jdbc.queryForObject("SELECT active_browser_session(:actor,:session)", args, Boolean.class))) {
            throw ApiProblem.unauthenticated();
        }
        Boolean visible = jdbc.queryForObject("""
                SELECT EXISTS(SELECT 1 FROM run r JOIN configuration c ON c.id=r.requirement_id
                    WHERE r.id=:run AND (c.owner_id=:actor OR EXISTS(SELECT 1 FROM configuration_deputy d
                        WHERE d.configuration_id=c.id AND d.account_id=:actor AND d.revoked_at IS NULL)))
                """, args, Boolean.class);
        if (!Boolean.TRUE.equals(visible)) throw new ApiProblem(404, "NOT_FOUND", "运行不存在或没有访问权限。");
        return args;
    }

    private static int pageSize(Integer requested) {
        int size = requested == null ? 50 : requested;
        if (size < 1 || size > 100) throw ApiProblem.invalid();
        return size;
    }

    private static Map<String, Object> page(List<Map<String, Object>> items, String next) {
        Map<String, Object> response = new LinkedHashMap<>();
        response.put("items", items); response.put("nextCursor", next);
        return response;
    }

    private static void put(Map<String, Object> item, String key, Object value) { if (value != null) item.put(key, value); }
}
