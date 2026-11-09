package agentship.platform.archive.application;

import agentship.platform.archive.api.ArchiveQueries;
import agentship.platform.archive.application.port.ArchiveStore;
import agentship.platform.device.api.WorkerDevices;
import agentship.platform.identity.api.BrowserSessions;
import agentship.platform.runtime.api.ArchiveRunAccess;
import agentship.platform.web.Actor;
import agentship.platform.web.ApiProblem;
import agentship.platform.web.RequestFields;
import com.fasterxml.jackson.databind.JsonNode;
import java.time.Instant;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;

/** Each approval fixes one coordinator snapshot and one create-only tag. */
@Service
public class ArtifactArchiveService implements ArchiveQueries {
    private static final Set<String> RETRYABLE_FAILURES = Set.of(
            "ARCHIVE_SOURCE_UNAVAILABLE", "ARCHIVE_TARGET_UNAVAILABLE", "ARCHIVE_GRANT_REQUIRED");
    private static final Set<String> FAILED_REASONS = Set.of("ARCHIVE_SOURCE_UNAVAILABLE", "ARCHIVE_PRIVATE_FILE",
            "ARCHIVE_TAG_CONFLICT", "ARCHIVE_TARGET_UNAVAILABLE", "ARCHIVE_GRANT_REQUIRED");
    private final ArchiveStore store;
    private final ArchiveRunAccess runs;
    private final WorkerDevices devices;
    private final BrowserSessions sessions;

    ArtifactArchiveService(ArchiveStore store, ArchiveRunAccess runs, WorkerDevices devices, BrowserSessions sessions) {
        this.store = store;
        this.runs = runs;
        this.devices = devices;
        this.sessions = sessions;
    }

    @Transactional
    public Map<String, Object> approve(Actor actor, UUID runId, JsonNode body, String requestId) {
        UUID artifact = RequestFields.id(body, "artifactId");
        String expected = sha(body, "expectedCommit");
        Instant retryAt = body.has("retryApprovalAt") ? RequestFields.instant(body, "retryApprovalAt") : null;
        if (!body.path("publicApproved").isBoolean() || !body.path("publicApproved").booleanValue()) throw ApiProblem.invalid();
        var run = lockRun(runId);
        sessions.requireActive(actor.id(), actor.sessionId());
        if (!actor.id().equals(run.currentOwner()) || !actor.id().equals(run.initiator())) throw missing();
        if (!"completed".equals(run.state())) throw RequestFields.conflict("ARCHIVE_NOT_READY", "流程完成后可归档已交付产物。");
        if (!runs.matchesFinalArtifact(runId, artifact, expected)) {
            throw RequestFields.conflict("ARCHIVE_CANDIDATE_CHANGED", "请选择当前已完成节点的产物。");
        }
        if (store.approve(artifact, runId, run.deviceId(), actor.id(), retryAt)) {
            store.auditApproval(artifact, runId, actor.id(), requestId);
            runs.archiveChanged(runId);
        }
        return view(store.read(artifact));
    }

    @Transactional
    public Map<String, Object> poll(String authorization) {
        var device = devices.authenticate(authorization);
        for (var candidate : store.candidates(device.id())) {
            var run = runs.tryLockArchiveRun(candidate.run(), candidate.requirement());
            if (run == null) continue;
            var source = store.lockSource(candidate.artifact(), device.id());
            if (source == null) continue;
            var entry = source.archive();
            devices.requireActive(device.id(), true);
            if (entry.exportCommit() == null && !grantCurrent(run, entry)) {
                store.failed(candidate.artifact(), "ARCHIVE_GRANT_REQUIRED");
                continue;
            }
            var lease = store.lease(candidate.artifact());
            Map<String, Object> job = new LinkedHashMap<>();
            job.put("artifactId", candidate.artifact());
            job.put("runId", candidate.run());
            job.put("epoch", lease.epoch());
            job.put("deadlineAt", lease.deadline().toString());
            job.put("approvedAt", entry.approvedAt().toString());
            job.put("mode", run.mode());
            job.put("repositoryName", run.repositoryName());
            job.put("repositoryId", run.repositoryId());
            job.put("requirementId", run.requirementId());
            job.put("baseCommit", run.baseCommit());
            job.put("sourceCommit", source.commit());
            job.put("sourceRef", source.ref());
            job.put("contentDigest", "sha256:" + HexFormat.of().formatHex(source.digest()));
            job.put("ref", tag(entry));
            if (entry.exportCommit() != null) job.put("exportCommit", entry.exportCommit());
            return Map.of("job", job);
        }
        return Map.of();
    }

    @Transactional
    public Map<String, Object> authorize(String authorization, JsonNode body) {
        var job = owned(authorization, body);
        var entry = job.entry();
        fence(entry, body);
        String export = sha(body, "exportCommit");
        if (entry.exportCommit() != null) {
            if (!export.equals(entry.exportCommit())) throw RequestFields.conflict("ARCHIVE_CANDIDATE_CHANGED", "归档快照已固定。");
            return Map.of("decision", "reconcile");
        }
        if (!grantCurrent(job.run(), entry)) {
            throw new ApiProblem(403, "ARCHIVE_GRANT_REQUIRED", "归档授权已过期或负责人已变更。");
        }
        Instant limit = Instant.now().plusSeconds(25);
        Instant grantLimit = entry.approvedAt().plusSeconds(86_400);
        if (grantLimit.isBefore(limit)) limit = grantLimit;
        if (entry.leaseUntil().isBefore(limit)) limit = entry.leaseUntil();
        if (!limit.isAfter(Instant.now())) throw stale();
        store.pinCommit(entry.artifact(), export);
        return Map.of("decision", "dispatch", "expiresAt", limit.toString());
    }

    @Transactional
    public Map<String, Object> result(String authorization, JsonNode body) {
        var entry = owned(authorization, body).entry();
        String state = RequestFields.text(body, "state", 20);
        if (!Set.of("succeeded", "failed", "unknown").contains(state)) throw ApiProblem.invalid();
        if ("succeeded".equals(state)) {
            if (!sha(body, "observedCommit").equals(entry.exportCommit()) ||
                    !tag(entry).equals(RequestFields.text(body, "ref", 180))) {
                throw RequestFields.conflict("ARCHIVE_EVIDENCE_MISMATCH", "归档证据与已固定的标签或提交不符。");
            }
            if ("succeeded".equals(entry.state())) return Map.of("accepted", true, "duplicate", true);
        }
        fence(entry, body);
        if ("failed".equals(state)) {
            String reason = RequestFields.text(body, "reasonCode", 80);
            store.failed(entry.artifact(), FAILED_REASONS.contains(reason) ? reason : "ARCHIVE_TARGET_UNAVAILABLE");
        } else if ("unknown".equals(state)) {
            store.unknown(entry.artifact());
        } else {
            store.succeeded(entry.artifact());
        }
        runs.archiveChanged(entry.run());
        return Map.of("accepted", true);
    }

    @Override
    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    public Map<UUID, Map<String, Object>> views(UUID run, Set<UUID> visibleArtifacts) {
        Map<UUID, Map<String, Object>> views = new LinkedHashMap<>();
        for (var entry : store.readVisible(run, visibleArtifacts)) {
            views.put(entry.artifact(), view(entry));
        }
        return views;
    }

    private record Owned(ArchiveRunAccess.Run run, ArchiveStore.Entry entry) {}

    private Owned owned(String authorization, JsonNode body) {
        var device = devices.authenticate(authorization);
        UUID artifact = RequestFields.id(body, "artifactId");
        UUID runId = store.ownedRun(artifact, device.id());
        if (runId == null) throw missing();
        var run = lockRun(runId);
        var entry = store.lockOwned(artifact, device.id());
        devices.requireActive(device.id(), true);
        return new Owned(run, entry);
    }

    private static void fence(ArchiveStore.Entry entry, JsonNode body) {
        long epoch = RequestFields.number(body, "epoch", 1, Long.MAX_VALUE);
        if (!"leased".equals(entry.state()) || entry.epoch() != epoch || !entry.leaseUntil().isAfter(Instant.now())) {
            throw stale();
        }
    }

    private static boolean grantCurrent(ArchiveRunAccess.Run run, ArchiveStore.Entry entry) {
        return "completed".equals(run.state()) && entry.approvedBy().equals(run.currentOwner()) &&
                entry.approvedAt().plusSeconds(86_400).isAfter(Instant.now());
    }

    private ArchiveRunAccess.Run lockRun(UUID runId) {
        var run = runs.lockArchiveRun(runId);
        if (run == null) throw missing();
        return run;
    }

    private static Map<String, Object> view(ArchiveStore.Entry entry) {
        Map<String, Object> view = new LinkedHashMap<>();
        view.put("state", entry.state());
        view.put("ref", tag(entry));
        if ("succeeded".equals(entry.state())) view.put("commit", entry.exportCommit());
        if (entry.reasonCode() != null) view.put("reasonCode", entry.reasonCode());
        if ("failed".equals(entry.state()) && entry.exportCommit() == null
                && entry.reasonCode() != null && RETRYABLE_FAILURES.contains(entry.reasonCode())) {
            view.put("retryable", true);
            view.put("retryApprovalAt", entry.approvedAt().toString());
        }
        return view;
    }

    private static String tag(ArchiveStore.Entry entry) {
        return "refs/tags/agentship/" + entry.run() + "/" + entry.artifact();
    }

    private static String sha(JsonNode body, String field) {
        String sha = RequestFields.text(body, field, 64);
        if (!sha.matches("[0-9a-f]{40}|[0-9a-f]{64}")) throw ApiProblem.invalid();
        return sha;
    }

    private static ApiProblem missing() { return new ApiProblem(404, "NOT_FOUND", "归档任务不存在或没有访问权限。"); }
    private static ApiProblem stale() { return RequestFields.conflict("ARCHIVE_LEASE_LOST", "归档任务租约已失效。"); }
}
