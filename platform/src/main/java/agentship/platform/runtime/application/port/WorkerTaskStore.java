package agentship.platform.runtime.application.port;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;

public interface WorkerTaskStore {
    record TaskContext(UUID task, Map<String, Object> run, Map<String, Object> attempt) {
        public UUID runId() { return (UUID) run.get("id"); }
        public UUID deviceId() { return (UUID) run.get("device_id"); }
        public long epoch() { return ((Number) attempt.get("lease_epoch")).longValue(); }
        public boolean isGit() { return "git".equals(attempt.get("kind")); }
    }

    record Candidate(UUID id, UUID requirement, UUID run, String kind, int stage, int node, int role) {
        public boolean isGit() { return "git".equals(kind); }
    }

    List<Candidate> candidates(UUID device, boolean agents);
    Candidate renewal(UUID device, UUID task, boolean agents);
    long nextEpoch();
    void renew(TaskContext task, Instant deadline);
    void lease(TaskContext task, long epoch, Instant deadline);
    void recordEvent(TaskContext task, UUID receipt, long sequence, String type, String key);
    void saveGitProgress(TaskContext task, String checkpoint);
    void succeed(TaskContext task);
    void eventAccepted(TaskContext task, long sequence);
    TaskContext lock(UUID device, UUID task, boolean skipLocked);
    void attention(TaskContext context, String code);
}
