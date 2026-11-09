package agentship.platform.runtime.application.port;

import agentship.platform.runtime.domain.GitPlan;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;

public interface GitPreparationStore {
    record Operation(UUID id, String key, String effect, String target, String state, String providerResult) {}
    record Observation(String outcome, UUID repository, String branch, String commit) {}
    record Repository(UUID id, String name, String provider, String providerId) {}

    Operation ensure(UUID requirement, UUID run, String mode, GitPlan.Operation operation);
    UUID operationId(String key);
    Instant grantDeadline(UUID run, String effect, String target, UUID owner);
    void associateTask(UUID operation, UUID task);
    void dispatch(UUID operation, UUID task, long epoch, Instant deadline);
    boolean scopedToTask(UUID operation, UUID task);
    List<UUID> successfulRepositories(UUID operation);
    Observation confirmedObservation(UUID operation);
    Observation observe(UUID operation, UUID task, String target, Instant at, String providerResult, Observation observation);
    void markUnknown(UUID operation);
    Repository ensureRepository(String provider, String providerId, String name, String defaultBranch);
    Repository repository(UUID id);
    void defaultBranch(UUID repository, String branch);
    void completeRun(UUID run, UUID repository, String base, String branch, String commit, String defaultBranch);
    void markPreparing(UUID run);
    Map<String, Object> revision(UUID run, Object revision);
}
