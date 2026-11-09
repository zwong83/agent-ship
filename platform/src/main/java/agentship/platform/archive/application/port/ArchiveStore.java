package agentship.platform.archive.application.port;

import java.time.Instant;
import java.util.List;
import java.util.Set;
import java.util.UUID;

public interface ArchiveStore {
    record Candidate(UUID artifact, UUID run, UUID requirement) {}
    record Entry(UUID artifact, UUID run, UUID approvedBy, Instant approvedAt, String state,
                 Long epoch, Instant leaseUntil, String exportCommit, String reasonCode) {}
    record Source(Entry archive, String commit, String ref, byte[] digest) {}
    record Lease(long epoch, Instant deadline) {}

    boolean approve(UUID artifact, UUID run, UUID device, UUID actor, Instant retryApproval);
    void auditApproval(UUID artifact, UUID run, UUID actor, String requestId);
    Entry read(UUID artifact);
    List<Entry> readVisible(UUID run, Set<UUID> visibleArtifacts);
    List<Candidate> candidates(UUID device);
    Source lockSource(UUID artifact, UUID device);
    Lease lease(UUID artifact);
    UUID ownedRun(UUID artifact, UUID device);
    Entry lockOwned(UUID artifact, UUID device);
    void pinCommit(UUID artifact, String commit);
    void failed(UUID artifact, String reason);
    void unknown(UUID artifact);
    void succeeded(UUID artifact);
}
