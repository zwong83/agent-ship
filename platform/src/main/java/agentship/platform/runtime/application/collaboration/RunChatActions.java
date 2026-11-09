package agentship.platform.runtime.application.collaboration;

import agentship.platform.catalog.api.RequirementEdits;
import agentship.platform.catalog.api.RequirementEdits.Content;
import agentship.platform.runtime.application.port.ChatActionsStore;
import agentship.platform.runtime.application.port.ChatActionsStore.NodeTarget;
import agentship.platform.runtime.application.port.ChatActionsStore.Revision;
import agentship.platform.web.Actor;
import agentship.platform.web.ApiProblem;
import agentship.platform.web.RequestFields;
import com.fasterxml.jackson.databind.JsonNode;
import java.text.Normalizer;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import org.springframework.stereotype.Component;

/** The caller holds the requirement, run and active chat lease locks. */
@Component
class RunChatActions {
    record Applied(UUID target, String kind, boolean advance) {}

    private final ChatActionsStore store;
    private final RequirementEdits requirements;

    RunChatActions(ChatActionsStore store, RequirementEdits requirements) {
        this.store = store;
        this.requirements = requirements;
    }

    Applied apply(Actor actor, UUID run, Map<String, Object> locked, String action, JsonNode body) {
        if (locked.get("finished_at") != null) throw unavailable("本次运行已经结束。");
        return switch (action) {
            case "message" -> message(actor, run, body);
            case "reply", "cancel-question" -> resolve(actor, run, locked, body, action.equals("reply"));
            case "retry", "skip" -> recoverRole(actor, run, body, action.equals("retry"));
            case "propose-change", "confirm-change", "describe" -> requirement(actor, run, locked, action, body);
            case "rerun" -> rerun(actor, run, locked, body);
            default -> throw unavailable("当前运行不支持此操作。");
        };
    }

    private Applied message(Actor actor, UUID run, JsonNode body) {
        var target = node(run, body);
        String text = RequestFields.text(body, "text", 10_000);
        String role = body.has("targetRoleId") ? RequestFields.text(body, "targetRoleId", 150) : null;
        if (body.has("targetId")) throw ApiProblem.invalid();
        UUID message = UUID.randomUUID();
        if (!store.send(target, actor.id(), role, text, message)) {
            throw RequestFields.conflict("CHAT_TARGET_UNAVAILABLE", "该轮次的指定 Agent 暂不可接收消息。");
        }
        return new Applied(message, "chat_message", false);
    }

    private Applied resolve(Actor actor, UUID run, Map<String, Object> locked, JsonNode body, boolean reply) {
        if (!reply) requireInitiator(actor, locked);
        if (body.has("nodeId") || body.has("wave") || body.has("targetRoleId")) throw ApiProblem.invalid();
        UUID question = RequestFields.id(body, "targetId");
        String text = reply ? RequestFields.text(body, "text", 10_000) : "请根据已有信息继续。";
        if (!store.resolve(run, question, actor.id(), reply, text)) {
            throw RequestFields.conflict("QUESTION_UNAVAILABLE", "该问题已处理或不再可处理。");
        }
        return new Applied(question, "agent_question", true);
    }

    private Applied recoverRole(Actor actor, UUID run, JsonNode body, boolean retry) {
        UUID task = RequestFields.id(body, "targetId");
        var role = store.failedRole(run, task);
        if (role == null) throw unavailable("该角色没有可处理的失败尝试。");
        long current = ((Number) role.get("current_attempt")).longValue();
        if (body.has("expectedAttemptNumber") && RequestFields.number(body, "expectedAttemptNumber", 1, Integer.MAX_VALUE) != current) {
            throw RequestFields.conflict("STALE_ATTEMPT", "角色尝试已变化，请刷新后重试。");
        }
        UUID attempt = (UUID) role.get("attempt_id");
        if (retry) {
            attempt = UUID.randomUUID();
            store.retryRole(task, current, attempt);
        } else {
            if (!"agent".equals(role.get("kind"))) throw unavailable("协调角色必须交付最终产物，不能跳过。");
            store.skipRole(task, current, actor.id());
        }
        store.resumeExecution((UUID) role.get("execution_id"));
        return new Applied(attempt, "task_attempt", true);
    }

    private Applied requirement(Actor actor, UUID run, Map<String, Object> locked, String action, JsonNode body) {
        long revision = RequestFields.number(body, "expectedRequirementRevision", 1, Long.MAX_VALUE);
        long source = RequestFields.number(body, "expectedSourceRequirementVersion", 1, Long.MAX_VALUE);
        var node = node(run, body);
        var current = store.activeRequirement(node);
        if (current == null) throw unavailable("当前没有可修改的需求节点。");
        if (revision != ((Number) current.get("current_revision")).longValue()
                || source != ((Number) current.get("source_version")).longValue()) throw staleRequirement();
        var target = new Revision(node, actor.id(), (UUID) locked.get("requirement_id"), revision, source,
                (UUID) current.get("execution_id"));
        if (action.equals("confirm-change")) {
            requireSourceOwner(actor, locked);
            UUID proposal = RequestFields.id(body, "targetId");
            var candidate = store.proposal(target, proposal);
            if (candidate == null) throw staleRequirement();
            applyRequirement(target, candidate);
            store.confirmProposal(target, proposal);
            store.rejectStaleProposals(target);
            return new Applied(proposal, "requirement_change", true);
        }
        if (action.equals("describe")) {
            requireSourceOwner(actor, locked);
            applyRequirement(target, new Content((String) current.get("source_title"), (String) current.get("source_name_key"),
                    RequestFields.text(body, "text", 10_000).strip()));
            store.rejectStaleProposals(target);
            return new Applied(target.execution(), "node_execution", true);
        }
        JsonNode input = body.get("proposedRequirement");
        if (input == null || !input.isObject() || input.size() != 2 || !input.has("description")) throw ApiProblem.invalid();
        String title = RequestFields.text(input, "title", 120).strip();
        JsonNode descriptionInput = input.get("description");
        String description = null;
        if (!descriptionInput.isNull()) {
            if (!descriptionInput.isTextual() || descriptionInput.textValue().length() > 10_000
                    || descriptionInput.textValue().indexOf(0) >= 0) throw ApiProblem.invalid();
            String stripped = descriptionInput.textValue().strip();
            if (!stripped.isBlank()) description = stripped;
        }
        UUID proposal = UUID.randomUUID();
        store.addProposal(target, proposal, new Content(title, normalize(title), description));
        return new Applied(proposal, "requirement_change", false);
    }

    private void applyRequirement(Revision target, Content content) {
        requirements.revise(target.requirement(), content);
        store.recordRevision(target, content);
    }

    private Applied rerun(Actor actor, UUID run, Map<String, Object> locked, JsonNode body) {
        requireInitiator(actor, locked);
        var target = node(run, body);
        if (!store.canRerun(target)) throw unavailable("该节点或其下游已有不能安全替换的执行结果。");
        store.rerun(target);
        return new Applied(target.node(), "workflow_node", true);
    }

    private static NodeTarget node(UUID run, JsonNode body) {
        return new NodeTarget(run, RequestFields.id(body, "nodeId"),
                RequestFields.number(body, "wave", 1, Integer.MAX_VALUE));
    }

    private static String normalize(String title) {
        String value = Normalizer.normalize(title, Normalizer.Form.NFKC).strip().toLowerCase(Locale.ROOT);
        if (value.isBlank()) throw ApiProblem.invalid();
        return value;
    }

    private static void requireSourceOwner(Actor actor, Map<String, Object> locked) {
        requireInitiator(actor, locked);
        if (!actor.id().equals(locked.get("current_owner"))) throw new ApiProblem(403, "FORBIDDEN", "需求负责人已变更，不能修改原需求。");
    }

    private static void requireInitiator(Actor actor, Map<String, Object> locked) {
        if (!actor.id().equals(locked.get("initiator_id"))) throw new ApiProblem(403, "FORBIDDEN", "此操作只允许运行发起人。");
    }

    private static ApiProblem staleRequirement() {
        return RequestFields.conflict("STALE_VERSION", "需求版本已变化，请刷新后重新确认。");
    }

    private static ApiProblem unavailable(String message) {
        return RequestFields.conflict("ACTION_NOT_ALLOWED", message);
    }

}
