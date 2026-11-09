package agentship.platform.runtime.application.execution;

import agentship.platform.runtime.application.collaboration.AgentInbox;
import agentship.platform.runtime.application.port.AgentTaskStore;
import agentship.platform.runtime.application.port.WorkerTaskStore;
import agentship.platform.runtime.application.port.WorkerTaskStore.TaskContext;
import agentship.platform.runtime.domain.SchedulingPolicy.Node;
import agentship.platform.web.ApiProblem;
import agentship.platform.web.RequestFields;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.Instant;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.stereotype.Component;

@Component
class AgentJobTasks {
    private static final Set<String> REPORTED_FAILURES = Set.of("AGENT_EXECUTION_FAILED", "AGENT_RESUME_REQUIRED",
            "AGENT_ARTIFACT_CONFLICT", "AGENT_ARTIFACT_REQUIRED");
    private final AgentTaskStore store;
    private final WorkerTaskStore tasks;
    private final ObjectMapper mapper;
    private final NodeScheduler scheduler;
    private final RepairCycle repairs;
    private final AgentInbox inbox;

    AgentJobTasks(AgentTaskStore store, WorkerTaskStore tasks, ObjectMapper mapper, NodeScheduler scheduler, RepairCycle repairs, AgentInbox inbox) {
        this.store = store; this.tasks = tasks; this.mapper = mapper;
        this.scheduler = scheduler;
        this.repairs = repairs;
        this.inbox = inbox;
    }

    List<Map<String, Object>> inbox(TaskContext context) { return inbox.pending(context); }

    boolean claimable(TaskContext context) {
        return store.claimable(context);
    }

    Map<String, Object> dispatch(TaskContext context, long epoch, Instant deadline) {
        var run = context.run();
        store.pinRevision(context);
        repairs.onClaim(context);
        var row = store.dispatchDetails(context.task());
        var dependencies = store.dependencies(run, row.get("node_id"));
        Map<String, Object> node = new LinkedHashMap<>();
        node.put("id", row.get("node_id"));
        node.put("name", row.get("name"));
        node.put("type", row.get("kind"));
        node.put("dependencies", dependencies);
        put(node, "purpose", row.get("purpose"));
        put(node, "agentOrder", row.get("agent_order"));

        var upstream = store.upstream(context);
        Map<String, Object> input = new LinkedHashMap<>();
        input.put("workType", run.get("work_type"));
        input.put("projectId", run.get("project_id"));
        input.put("requirementId", run.get("requirement_id"));
        input.put("requirementRevision", row.get("requirement_revision"));
        input.put("requirementName", row.get("title"));
        put(input, "requirementDescription", row.get("description"));
        input.put("workflowVersion", run.get("workflow_version"));
        input.put("roleId", row.get("role_key"));
        input.put("roleDisplayName", row.get("display_name"));
        input.put("roleInstruction", row.get("instruction"));
        put(input, "skillRef", row.get("skill_ref"));
        input.put("node", node);
        input.put("git", git(run));
        input.put("upstreamArtifacts", upstream);
        input.put("siblingArtifacts", store.siblings(context));
        if ("check".equals(row.get("kind"))) {
            input.put("checkCandidate", pinCheckCandidate(context, row, candidate(context, upstream)));
        }

        Map<String, Object> job = new LinkedHashMap<>();
        job.put("taskId", context.task());
        job.put("attemptId", context.attempt().get("attempt_id"));
        job.put("epoch", epoch);
        job.put("runId", context.runId());
        job.put("kind", context.attempt().get("kind"));
        job.put("nodeId", row.get("node_id"));
        job.put("wave", row.get("wave"));
        job.put("deadlineAt", deadline.toString());
        job.put("input", input);
        if (context.attempt().get("checkpoint") != null) {
            try {
                job.put("checkpoint", mapper.readTree(context.attempt().get("checkpoint").toString()));
            } catch (com.fasterxml.jackson.core.JsonProcessingException invalid) {
                throw new IllegalStateException(invalid);
            }
        }
        return job;
    }

    private Map<String, Object> git(Map<String, Object> run) {
        Map<String, Object> repository = new LinkedHashMap<>();
        repository.put("provider", run.get("repository_provider"));
        repository.put("repositoryId", run.get("provider_repository_id"));
        repository.put("displayName", run.get("repository_name"));
        put(repository, "defaultBranch", run.get("git_default_branch"));
        return Map.of("repository", repository, "baseBranch", run.get("base_branch"), "workBranch", run.get("work_branch"),
                "baseCommit", run.get("base_commit"), "headCommit", run.get("base_commit"));
    }

    private Map<String, Object> candidate(TaskContext context, List<Map<String, Object>> upstream) {
        if (!upstream.isEmpty() && upstream.getFirst().get("commit") != null) {
            var latest = upstream.getFirst();
            return Map.of("commit", latest.get("commit"), "version", latest.get("sourceRef"));
        }
        var run = context.run();
        return Map.of("commit", run.get("base_commit"), "version", "git:" + run.get("provider_repository_id") + "@" + run.get("base_commit"));
    }

    private Map<String, Object> pinCheckCandidate(TaskContext context, Map<String, Object> node,
                                                   Map<String, Object> candidate) {
        store.pinCheckCandidate(context, node, candidate);
        return checkCandidate(context, node.get("node_id"), node.get("wave"), candidate);
    }

    private Map<String, Object> checkCandidate(TaskContext context, Object node, Object wave,
                                                Map<String, Object> fallback) {
        var pinned = store.checkCandidate(context, node, wave);
        return pinned == null ? fallback : pinned;
    }

    void event(TaskContext context, String type, JsonNode result, UUID eventId) {
        switch (type) {
            case "progress" -> progress(context, result);
            case "complete" -> complete(context, result);
            case "failure" -> failure(context, result);
            case "question" -> question(context, result, eventId);
            case "message" -> message(context, result, eventId);
            default -> throw ApiProblem.invalid();
        }
    }

    private void progress(TaskContext context, JsonNode result) {
        if (result.has("external")) throw ApiProblem.invalid();
        inbox.acknowledge(context, result);
        for (String field : List.of("threadId", "turnId", "providerRequestId", "providerOperationKey", "workspaceRevision")) {
            if (result.has(field)) RequestFields.text(result, field, 500);
        }
        String thread = null;
        if (result.has("threadId")) {
            thread = RequestFields.text(result, "threadId", 500);
            Object previous = context.attempt().get("session_ref");
            // A new session may replace a lost one only after a lease is reclaimed.
            if (previous != null && !previous.equals(thread) && ((Number) context.attempt().get("last_event_sequence")).longValue() != 0) {
                throw RequestFields.conflict("SESSION_MISMATCH", "任务会话与当前尝试不一致");
            }
            if (previous != null && !previous.equals(thread)) inbox.unresolvedPending(context);
        }
        String checkpoint = RequestFields.json(mapper, result);
        if (checkpoint.length() > 32_768) throw ApiProblem.invalid();
        store.progress(context, thread, checkpoint);
    }

    private void complete(TaskContext context, JsonNode result) {
        if (result.has("external") || result.has("handoffs") && !result.path("handoffs").isEmpty()) throw ApiProblem.invalid();
        JsonNode artifacts = result.get("artifacts");
        if (artifacts == null || !artifacts.isArray() || artifacts.size() != 1) {
            throw RequestFields.conflict("AGENT_ARTIFACT_REQUIRED", "Agent 必须提交一项有效产物");
        }
        inbox.unresolvedPending(context);
        boolean coordinator = "coordinator".equals(context.attempt().get("kind"));
        UUID artifact = saveArtifact(context, artifacts.get(0), coordinator);
        Node node = scheduler.nodes(context.run()).stream()
                .filter(item -> item.execution().equals(context.attempt().get("execution_id"))).findFirst().orElseThrow();
        tasks.succeed(context);
        if (coordinator) {
            String reason = null;
            if ("check".equals(node.kind())) reason = saveCheck(context, node, result.get("check"), artifact);
            else if (result.has("check")) throw ApiProblem.invalid();
            if ("requirement".equals(node.purpose()) && !store.hasDescription(context)) reason = "AGENT_REQUIREMENT_REQUIRED";
            store.nodeState(context, reason == null ? "complete" : "needs_attention");
        } else if (result.has("check")) {
            throw ApiProblem.invalid();
        }
        scheduler.advance(context.run());
    }

    private UUID saveArtifact(TaskContext context, JsonNode artifact, boolean coordinator) {
        String kind = RequestFields.text(artifact, "kind", 20);
        if (!(coordinator ? "product" : "other").equals(kind)) throw ApiProblem.invalid();
        String title = RequestFields.text(artifact, "title", 200);
        String commit = RequestFields.text(artifact, "commit", 64);
        String source = RequestFields.text(artifact, "sourceRef", 450);
        String digest = RequestFields.text(artifact, "contentDigest", 71);
        Object attemptId = context.attempt().get("attempt_id");
        String expected = "local-git:" + context.runId() + "/" + context.task() + "/" + attemptId + "@" + commit
                + ":.agentship-results/" + attemptId + "/result.md";
        var run = context.run();
        if (!commit.matches("[0-9a-f]{40}|[0-9a-f]{64}") || !source.equals(expected) || !digest.matches("sha256:[0-9a-f]{64}")
                || !run.get("provider_repository_id").equals(RequestFields.text(artifact, "repositoryId", 200))
                || !run.get("work_branch").equals(RequestFields.text(artifact, "workBranch", 250))) {
            throw RequestFields.conflict("AGENT_ARTIFACT_REQUIRED", "产物证据不属于当前任务、尝试或仓库");
        }
        return store.saveArtifact(context, kind, title, source, HexFormat.of().parseHex(digest.substring(7)), commit);
    }

    private String saveCheck(TaskContext context, Node node, JsonNode result, UUID artifact) {
        String supplied = result == null ? "" : result.path("outcome").asText();
        String outcome = Set.of("pass", "repair").contains(supplied) ? supplied : "unresolved";
        String commit = null;
        String version = null;
        if (!"unresolved".equals(outcome)) {
            commit = RequestFields.text(result, "testedCommit", 64);
            version = RequestFields.text(result, "testedArtifactVersion", 450);
            var expected = checkCandidate(context, node.id(), node.wave(), candidate(context, store.upstream(context)));
            if (!commit.equals(expected.get("commit")) || !version.equals(expected.get("version"))) {
                throw RequestFields.conflict("CHECK_CANDIDATE_MISMATCH", "检查结果与已固定的候选产物不一致");
            }
        }
        String reason = switch (outcome) {
            case "repair" -> "AGENT_REPAIR_REQUIRED";
            case "unresolved" -> "AGENT_CHECK_UNRESOLVED";
            default -> null;
        };
        store.recordCheck(context, node, outcome, commit, version, reason, artifact);
        if ("pass".equals(outcome)) store.skipRepairBranch(context, node);
        return reason;
    }

    private void failure(TaskContext context, JsonNode result) {
        String code = RequestFields.text(result, "reasonCode", 100);
        RequestFields.text(result, "message", 4000);
        if (!result.path("retryable").isBoolean() || result.has("external")) throw ApiProblem.invalid();
        if (!REPORTED_FAILURES.contains(code)) code = "AGENT_EXECUTION_FAILED";
        inbox.unresolvedPending(context);
        store.fail(context, code);
        store.nodeState(context, "needs_attention");
        scheduler.advance(context.run());
    }

    private void question(TaskContext context, JsonNode result, UUID eventId) {
        String session = session(context, result);
        inbox.recordQuestion(context, eventId, session, RequestFields.text(result, "text", 8000));
        store.awaitReply(context);
        store.nodeState(context, "waiting_reply");
        scheduler.advance(context.run());
    }

    private void message(TaskContext context, JsonNode result, UUID eventId) {
        String session = session(context, result);
        UUID reply = result.has("inReplyToInboxId") ? RequestFields.id(result, "inReplyToInboxId") : null;
        String text = RequestFields.text(result, "text", 8000);
        if (reply != null && inbox.alreadyReplied(context, session, reply)) return;
        inbox.recordMessage(context, eventId, reply, text);
    }

    private String session(TaskContext context, JsonNode result) {
        String session = RequestFields.text(result, "sessionRef", 500);
        if (!session.equals(context.attempt().get("session_ref"))) {
            throw RequestFields.conflict("SESSION_MISMATCH", "任务会话与当前尝试不一致");
        }
        return session;
    }

    private static void put(Map<String, Object> value, String key, Object field) {
        if (field != null) value.put(key, field);
    }
}
