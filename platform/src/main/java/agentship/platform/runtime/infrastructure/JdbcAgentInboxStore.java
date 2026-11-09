package agentship.platform.runtime.infrastructure;

import agentship.platform.runtime.application.port.AgentInboxStore;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
class JdbcAgentInboxStore implements AgentInboxStore {
    private final NamedParameterJdbcTemplate jdbc;

    JdbcAgentInboxStore(NamedParameterJdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @Override
    public List<Map<String, Object>> pending(UUID run, UUID task, String session) {
        return jdbc.query("""
                SELECT i.id,i.task_id,i.session_ref,i.kind,i.question_id,i.created_at,
                    coalesce(i.payload->>'text','请根据已有信息继续。') AS body,
                    i.payload->>'chatMessageId' AS message_id,t.requirement_revision
                FROM agent_inbox i JOIN role_task t ON t.id=i.task_id
                WHERE i.run_id=:run AND i.task_id=:task AND i.session_ref=:session AND i.delivery_state='pending'
                ORDER BY CASE WHEN i.kind IN ('answer','continue_without_answer') THEN 0 ELSE 1 END,i.created_at,i.id LIMIT 16
                """, Map.of("run", run, "task", task, "session", session), (rs, row) -> {
                    Map<String, Object> item = new LinkedHashMap<>();
                    item.put("id", rs.getObject("id", UUID.class)); item.put("taskId", rs.getObject("task_id", UUID.class));
                    item.put("sessionRef", rs.getString("session_ref")); item.put("kind", rs.getString("kind"));
                    item.put("text", rs.getString("body")); item.put("createdAt", rs.getTimestamp("created_at").toInstant().toString());
                    item.put("requirementRevision", rs.getLong("requirement_revision"));
                    UUID question = rs.getObject("question_id", UUID.class);
                    if (question != null) item.put("questionId", question);
                    String message = rs.getString("message_id");
                    if (message != null) item.put("chatMessageId", message);
                    return item;
                });
    }

    @Override
    public int updateDelivery(UUID run, UUID task, String session, List<UUID> ids, String status) {
        int changed = jdbc.update("""
                UPDATE agent_inbox SET
                    delivery_state=CASE WHEN delivery_state='delivered' THEN 'delivered' ELSE :state END,
                    delivered_at=CASE WHEN :state='delivered' THEN coalesce(delivered_at,statement_timestamp()) ELSE delivered_at END
                WHERE run_id=:run AND task_id=:task AND session_ref=:session AND id IN (:ids)
                """, Map.of("run", run, "task", task, "session", session, "ids", ids, "state", status));
        return changed;
    }

    @Override
    public boolean delivered(UUID run, UUID task, String session, UUID inbox) {
        var args = Map.of("run", run, "task", task, "session", session, "id", inbox);
        return Boolean.TRUE.equals(jdbc.queryForObject("""
                SELECT EXISTS(SELECT 1 FROM agent_inbox WHERE id=:id AND run_id=:run AND task_id=:task
                    AND session_ref=:session AND delivery_state='delivered')
                """, args, Boolean.class));
    }

    @Override
    public boolean replied(UUID run, UUID task, UUID inbox) {
        var args = Map.of("run", run, "task", task, "id", inbox);
        return Boolean.TRUE.equals(jdbc.queryForObject("""
                SELECT EXISTS(SELECT 1 FROM chat_message WHERE run_id=:run AND actor_task_id=:task AND in_reply_to_inbox_id=:id)
                """, args, Boolean.class));
    }

    @Override
    public void markUnknown(UUID run, UUID task, String session) {
        jdbc.update("""
                UPDATE agent_inbox SET delivery_state='unknown'
                WHERE run_id=:run AND task_id=:task AND session_ref=:session AND delivery_state='pending'
                """, Map.of("run", run, "task", task, "session", session));
    }

    @Override
    public void recordQuestion(UUID run, UUID task, UUID attempt, UUID event, String session, String body) {
        jdbc.update("""
                INSERT INTO agent_question(id,run_id,task_id,attempt_id,source_event_id,session_ref,body)
                VALUES(:id,:run,:task,:attempt,:event,:session,:text)
                """, Map.of("id", UUID.randomUUID(), "run", run, "task", task, "attempt", attempt, "event", event,
                "session", session, "text", body));
    }

    @Override
    public void recordMessage(UUID run, UUID task, UUID event, UUID reply, String body) {
        jdbc.update("""
                INSERT INTO chat_message(id,run_id,message_type,actor_task_id,source_event_id,body,in_reply_to_inbox_id)
                VALUES(:id,:run,'message',:task,:event,:text,:reply)
                """, new MapSqlParameterSource("id", UUID.randomUUID()).addValue("run", run)
                .addValue("task", task).addValue("event", event).addValue("text", body).addValue("reply", reply));
    }
}
