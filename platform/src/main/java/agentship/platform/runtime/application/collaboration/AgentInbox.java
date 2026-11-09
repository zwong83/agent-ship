package agentship.platform.runtime.application.collaboration;

import agentship.platform.runtime.application.port.AgentInboxStore;
import agentship.platform.runtime.application.port.WorkerTaskStore.TaskContext;
import agentship.platform.web.ApiProblem;
import agentship.platform.web.RequestFields;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.stereotype.Component;

@Component
public class AgentInbox {
    private final AgentInboxStore store;

    AgentInbox(AgentInboxStore store) { this.store = store; }

    public List<Map<String, Object>> pending(TaskContext context) {
        Object session = context.attempt().get("session_ref");
        if (session == null) return List.of();
        return store.pending(context.runId(), context.task(), (String) session);
    }

    public void acknowledge(TaskContext context, JsonNode result) {
        List<UUID> delivered = identifiers(result, "deliveredInboxIds");
        List<UUID> unknown = identifiers(result, "unknownInboxIds");
        if (delivered.isEmpty() && unknown.isEmpty()) return;
        Set<UUID> overlap = new HashSet<>(delivered);
        if (unknown.stream().anyMatch(overlap::contains)) throw ApiProblem.invalid();
        Object session = context.attempt().get("session_ref");
        if (session == null || result.has("threadId") && !session.equals(result.path("threadId").asText())) throw mismatched();
        if (!delivered.isEmpty()) update(context, session, delivered, "delivered");
        if (!unknown.isEmpty()) update(context, session, unknown, "unknown");
    }

    private void update(TaskContext context, Object session, List<UUID> ids, String status) {
        int changed = store.updateDelivery(context.runId(), context.task(), (String) session, ids, status);
        if (changed != ids.size()) throw mismatched();
    }

    public boolean alreadyReplied(TaskContext context, String session, UUID inbox) {
        if (!store.delivered(context.runId(), context.task(), session, inbox)) throw mismatched();
        return store.replied(context.runId(), context.task(), inbox);
    }

    public void unresolvedPending(TaskContext context) {
        Object session = context.attempt().get("session_ref");
        if (session == null) return;
        store.markUnknown(context.runId(), context.task(), (String) session);
    }

    public void recordQuestion(TaskContext context, UUID event, String session, String body) {
        store.recordQuestion(context.runId(), context.task(), (UUID) context.attempt().get("attempt_id"), event, session, body);
    }

    public void recordMessage(TaskContext context, UUID event, UUID reply, String body) {
        store.recordMessage(context.runId(), context.task(), event, reply, body);
    }

    private static List<UUID> identifiers(JsonNode result, String field) {
        if (!result.has(field)) return List.of();
        JsonNode entries = result.get(field);
        if (!entries.isArray() || entries.size() > 64) throw ApiProblem.invalid();
        List<UUID> ids = new ArrayList<>();
        for (JsonNode entry : entries) {
            if (!entry.isTextual()) throw ApiProblem.invalid();
            try {
                UUID value = UUID.fromString(entry.textValue());
                if (!value.toString().equalsIgnoreCase(entry.textValue()) || ids.contains(value)) throw ApiProblem.invalid();
                ids.add(value);
            } catch (IllegalArgumentException invalid) { throw ApiProblem.invalid(); }
        }
        return ids;
    }

    private static ApiProblem mismatched() {
        return RequestFields.conflict("INBOX_SCOPE_MISMATCH", "消息不属于当前角色会话。");
    }
}
