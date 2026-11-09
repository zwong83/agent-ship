package agentship.platform.catalog.api;

import java.util.UUID;

public interface RequirementRepositories {
    /** Associates verified evidence while the caller holds the requirement configuration lock. */
    void associate(UUID requirement, UUID repository);
}
