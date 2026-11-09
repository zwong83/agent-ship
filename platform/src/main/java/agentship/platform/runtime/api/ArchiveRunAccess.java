package agentship.platform.runtime.api;

import java.util.UUID;

/** Archive calls these operations inside its existing transaction. */
public interface ArchiveRunAccess {
    record Run(UUID id, UUID requirementId, UUID deviceId, UUID currentOwner, UUID initiator,
               String state, String mode, String repositoryName, String repositoryId, String baseCommit) {}

    Run lockArchiveRun(UUID run);
    Run tryLockArchiveRun(UUID run, UUID requirement);
    boolean matchesFinalArtifact(UUID run, UUID artifact, String commit);
    void archiveChanged(UUID run);
}
