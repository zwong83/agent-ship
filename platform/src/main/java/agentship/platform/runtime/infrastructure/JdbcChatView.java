package agentship.platform.runtime.infrastructure;

import agentship.platform.identity.Tokens;
import agentship.platform.runtime.application.port.ChatView;
import agentship.platform.runtime.application.query.AgentRunStatus;
import agentship.platform.web.Actor;
import agentship.platform.web.ApiProblem;
import java.nio.charset.StandardCharsets;
import java.sql.Timestamp;
import java.util.ArrayList;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Component;

/** Chat projection is only called after checking the current browser lease. */
@Component
class JdbcChatView implements ChatView {
    private final NamedParameterJdbcTemplate jdbc;

    JdbcChatView(NamedParameterJdbcTemplate jdbc) { this.jdbc = jdbc; }

    @Override
    public Map<String, Object> read(Actor actor, UUID run, String lease, String cursor, Integer size) {
        int pageSize = size == null ? 50 : size;
        if (pageSize < 1 || pageSize > 100) throw ApiProblem.invalid();
        long before = cursor == null ? Long.MAX_VALUE : decode(lease, cursor);
        var args = new MapSqlParameterSource("run", run).addValue("actor", actor.id()).addValue("before", before)
                .addValue("limit", pageSize + 1);
        var state = jdbc.queryForMap("""
                SELECT r.state,r.finished_at,r.initiator_id,c.owner_id,
                    d.revoked_at IS NULL AND coalesce(d.last_seen_at>statement_timestamp()-interval '30 seconds',false) AS device_online
                FROM run r JOIN device d ON d.id=r.device_id JOIN configuration c ON c.id=r.requirement_id WHERE r.id=:run
                """, args);
        boolean initiator = actor.id().equals(state.get("initiator_id"));
        boolean live = state.get("finished_at") == null;
        boolean canConfirm = initiator && actor.id().equals(state.get("owner_id"));
        var rows = jdbc.queryForList("""
                SELECT m.id,m.message_type,m.body,m.created_at,m.accepted_ordinal,m.actor_account_id,m.actor_task_id,m.target_task_id,
                    coalesce(v.display_name,u.display_name) AS sender_label,ad.role_key AS sender_role,td.role_key AS target_role,
                    e.node_id,e.wave,inbox.delivery_state,reply.payload->>'chatMessageId' AS reply_message_id
                FROM chat_message m
                LEFT JOIN account u ON u.id=m.actor_account_id
                LEFT JOIN role_task a ON a.id=m.actor_task_id
                LEFT JOIN role_task t ON t.id=m.target_task_id
                LEFT JOIN agent_definition ad ON ad.id=a.agent_id LEFT JOIN agent_definition td ON td.id=t.agent_id
                LEFT JOIN agent_version v ON (v.agent_id,v.version)=(a.agent_id,a.agent_version)
                LEFT JOIN node_execution e ON e.id=coalesce(a.execution_id,t.execution_id)
                LEFT JOIN LATERAL (
                    SELECT i.delivery_state FROM agent_inbox i WHERE i.task_id=m.target_task_id
                        AND i.payload->>'chatMessageId'=CAST(m.id AS text) LIMIT 1
                ) inbox ON true
                LEFT JOIN agent_inbox reply ON reply.id=m.in_reply_to_inbox_id
                WHERE m.run_id=:run AND m.accepted_ordinal<:before
                ORDER BY m.accepted_ordinal DESC LIMIT :limit
                """, args);
        var page = rows.size() > pageSize ? rows.subList(0, pageSize) : rows;
        String next = rows.size() > pageSize ? encode(lease, ((Number) page.getLast().get("accepted_ordinal")).longValue()) : null;

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("messages", page.reversed().stream().map(this::message).toList());
        result.put("nextCursor", next);
        result.put("questions", questions(args, initiator, live));
        result.put("targets", live ? targets(args) : List.of());
        result.put("changes", changes(args, canConfirm && live));
        result.put("failedRoles", failedRoles(args));
        result.put("requirements", requirements(args, canConfirm));
        result.put("rerunTargets", initiator ? reruns(args) : List.of());
        result.put("deviceOnline", state.get("device_online"));
        result.put("runState", state.get("state"));
        List<String> allowed = new ArrayList<>(List.of("view"));
        if (live) allowed.addAll(List.of("message", "reply", "propose-change", "retry", "skip"));
        if (live && initiator) allowed.addAll(List.of("cancel-question", "rerun"));
        if (live && canConfirm) allowed.addAll(List.of("describe", "confirm-change"));
        result.put("allowedActions", allowed);
        return result;
    }

    private Map<String, Object> message(Map<String, Object> row) {
        Map<String, Object> message = new LinkedHashMap<>();
        boolean agent = row.get("actor_task_id") != null;
        String type = (String) row.get("message_type");
        message.put("id", row.get("id"));
        message.put("type", type);
        message.put("text", row.get("body"));
        message.put("createdAt", time(row.get("created_at")));
        message.put("direction", type.equals("system") ? "system" : agent
                ? row.get("target_task_id") == null ? "agent_to_user" : "agent_to_agent" : "user_to_agent");
        put(message, "senderLabel", row.get("sender_label"));
        put(message, "senderRoleId", row.get("sender_role"));
        put(message, "targetRoleId", row.get("target_role"));
        put(message, "nodeId", row.get("node_id"));
        put(message, "wave", row.get("wave"));
        put(message, "deliveryState", row.get("delivery_state"));
        put(message, "inReplyToMessageId", row.get("reply_message_id"));
        return message;
    }

    private List<Map<String, Object>> questions(MapSqlParameterSource args, boolean initiator, boolean live) {
        return jdbc.queryForList("""
                SELECT q.id,q.task_id,q.body,q.created_at,a.action,a.answer,i.delivery_state,t.node_id,e.wave,d.role_key,v.display_name,
                    p.state='waiting_reply' AND p.attempt_id=q.attempt_id AND p.session_ref=q.session_ref
                        AND task_route_is_open(t.run_id,t.node_id) AS answerable
                FROM agent_question q JOIN role_task t ON t.id=q.task_id JOIN node_execution e ON e.id=t.execution_id
                JOIN task_attempt p ON (p.task_id,p.attempt_number)=(t.id,t.current_attempt)
                JOIN agent_definition d ON d.id=t.agent_id JOIN agent_version v ON (v.agent_id,v.version)=(t.agent_id,t.agent_version)
                LEFT JOIN question_resolution a ON a.question_id=q.id LEFT JOIN agent_inbox i ON i.question_id=q.id
                WHERE q.run_id=:run ORDER BY (a.question_id IS NULL) DESC,q.created_at DESC,q.id DESC LIMIT 100
                """, args).stream().map(row -> {
                    Map<String, Object> question = new LinkedHashMap<>();
                    question.put("id", row.get("id")); question.put("taskId", row.get("task_id"));
                    question.put("roleId", row.get("role_key")); question.put("roleDisplayName", row.get("display_name"));
                    question.put("nodeId", row.get("node_id")); question.put("wave", row.get("wave"));
                    question.put("text", row.get("body")); question.put("createdAt", time(row.get("created_at")));
                    String action = (String) row.get("action");
                    question.put("state", action == null ? "waiting" : action.equals("reply") ? "answered" : "canceled");
                    boolean answerable = live && action == null && Boolean.TRUE.equals(row.get("answerable"));
                    question.put("canReply", answerable); question.put("canCancel", answerable && initiator);
                    put(question, "answer", row.get("answer")); put(question, "deliveryState", row.get("delivery_state"));
                    return question;
                }).toList();
    }

    private List<Map<String, Object>> targets(MapSqlParameterSource args) {
        var rows = jdbc.queryForList("""
                SELECT e.node_id,e.wave,n.name,w.role,d.role_key,v.display_name,
                    t.id IS NOT NULL AND a.session_ref IS NOT NULL AND a.state IN ('queued','leased','running','waiting_reply') AS available
                FROM node_execution e JOIN workflow_node n ON (n.workflow_id,n.workflow_version,n.node_id)=(e.workflow_id,e.workflow_version,e.node_id)
                JOIN workflow_role w ON (w.workflow_id,w.workflow_version,w.node_id)=(e.workflow_id,e.workflow_version,e.node_id)
                JOIN agent_definition d ON d.id=w.agent_id JOIN agent_version v ON (v.agent_id,v.version)=(w.agent_id,w.agent_version)
                LEFT JOIN role_task t ON t.execution_id=e.id AND t.agent_id=w.agent_id
                LEFT JOIN task_attempt a ON (a.task_id,a.attempt_number)=(t.id,t.current_attempt)
                WHERE e.run_id=:run AND e.state IN ('running','waiting_reply','needs_attention') AND task_route_is_open(e.run_id,e.node_id)
                  AND e.wave=(SELECT max(x.wave) FROM node_execution x WHERE (x.run_id,x.node_id)=(e.run_id,e.node_id))
                ORDER BY n.name,e.node_id,w.role,w.ordinal
                """, args);
        record Node(Map<String, Object> view, List<Map<String, Object>> roles) {}
        Map<UUID, Node> nodes = new LinkedHashMap<>();
        for (var row : rows) {
            var node = nodes.computeIfAbsent((UUID) row.get("node_id"), id -> {
                Map<String, Object> view = new LinkedHashMap<>();
                var roles = new ArrayList<Map<String, Object>>();
                view.put("nodeId", id); view.put("wave", row.get("wave")); view.put("nodeName", row.get("name"));
                view.put("coordinatorRoleId", null); view.put("roles", roles);
                return new Node(view, roles);
            });
            boolean available = Boolean.TRUE.equals(row.get("available"));
            if (available && "coordinator".equals(row.get("role"))) node.view().put("coordinatorRoleId", row.get("role_key"));
            node.roles().add(Map.of("roleId", row.get("role_key"), "roleDisplayName", row.get("display_name"),
                    "availability", available ? "ready" : "unavailable"));
        }
        return nodes.values().stream().map(Node::view).toList();
    }

    private List<Map<String, Object>> changes(MapSqlParameterSource args, boolean canConfirm) {
        return jdbc.queryForList("""
                SELECT c.*,e.node_id,e.wave,e.state AS execution_state,r.current_revision,src.version AS source_version
                FROM requirement_change c JOIN node_execution e ON e.id=c.execution_id
                JOIN run r ON r.id=c.run_id JOIN configuration src ON src.id=r.requirement_id
                WHERE c.run_id=:run ORDER BY (c.state='pending') DESC,c.created_at DESC,c.id DESC LIMIT 100
                """, args).stream().map(row -> {
                    Map<String, Object> change = new LinkedHashMap<>();
                    change.put("id", row.get("id")); change.put("state", row.get("state"));
                    change.put("basedOnRevision", row.get("based_on_revision"));
                    change.put("basedOnSourceRequirementVersion", row.get("based_on_requirement_version"));
                    change.put("nodeId", row.get("node_id")); change.put("wave", row.get("wave"));
                    change.put("summary", row.get("proposed_title")); change.put("title", row.get("proposed_title"));
                    change.put("description", row.get("proposed_description"));
                    change.put("canConfirm", canConfirm && "pending".equals(row.get("state"))
                            && List.of("running", "waiting_reply", "needs_attention").contains(row.get("execution_state"))
                            && row.get("based_on_revision").equals(row.get("current_revision"))
                            && row.get("based_on_requirement_version").equals(row.get("source_version")));
                    put(change, "effectiveRevision", row.get("effective_revision")); put(change, "confirmedBy", row.get("confirmed_by"));
                    put(change, "confirmedAt", time(row.get("confirmed_at")));
                    return change;
                }).toList();
    }

    private List<Map<String, Object>> failedRoles(MapSqlParameterSource args) {
        return jdbc.queryForList(JdbcChatActionsStore.FAILED_ROLES + " ORDER BY e.node_id,t.kind,v.display_name,t.id", args).stream().map(row -> {
            Map<String, Object> role = new LinkedHashMap<>();
            role.put("taskId", row.get("id")); role.put("nodeId", row.get("node_id")); role.put("wave", row.get("wave"));
            role.put("roleDisplayName", row.get("display_name")); role.put("attemptNumber", row.get("current_attempt"));
            String reason = AgentRunStatus.message((String) row.get("reason_code"));
            put(role, "reason", reason);
            role.put("actions", "agent".equals(row.get("kind")) ? List.of("retry", "skip") : List.of("retry"));
            return role;
        }).toList();
    }

    private List<Map<String, Object>> requirements(MapSqlParameterSource args, boolean canConfirm) {
        return jdbc.queryForList(JdbcChatActionsStore.ACTIVE_BRD + " ORDER BY e.node_id", args).stream().map(row -> {
            Map<String, Object> requirement = new LinkedHashMap<>();
            requirement.put("nodeId", row.get("node_id")); requirement.put("wave", row.get("wave"));
            requirement.put("title", row.get("title")); requirement.put("description", row.get("description"));
            requirement.put("revision", row.get("current_revision")); requirement.put("sourceVersion", row.get("source_version"));
            requirement.put("canConfirm", canConfirm);
            return requirement;
        }).toList();
    }

    private List<Map<String, Object>> reruns(MapSqlParameterSource args) {
        return jdbc.queryForList(JdbcChatActionsStore.RERUN_TARGETS + " ORDER BY n.name,e.node_id", args).stream()
                .map(row -> Map.of("nodeId", row.get("node_id"), "wave", row.get("wave"), "nodeName", row.get("name"))).toList();
    }

    private static long decode(String lease, String cursor) {
        if (cursor.length() > 100) throw expired();
        int point = cursor.indexOf('.');
        if (point <= 0) throw expired();
        try {
            long value = Long.parseLong(cursor.substring(0, point));
            if (value < 1 || !Tokens.equal(encode(lease, value), cursor)) throw expired();
            return value;
        } catch (NumberFormatException e) { throw expired(); }
    }

    private static String encode(String lease, long value) {
        return value + "." + Base64.getUrlEncoder().withoutPadding()
                .encodeToString(Tokens.hmac(lease.getBytes(StandardCharsets.UTF_8), "agentship-chat-page-v1\n" + value));
    }

    private static ApiProblem expired() { return new ApiProblem(410, "CURSOR_EXPIRED", "分页已失效，请重新查询。"); }
    private static String time(Object stamp) { return stamp == null ? null : ((Timestamp) stamp).toInstant().toString(); }
    private static void put(Map<String, Object> value, String field, Object data) { if (data != null) value.put(field, data); }
}
