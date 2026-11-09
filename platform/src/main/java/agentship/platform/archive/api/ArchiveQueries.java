package agentship.platform.archive.api;

import java.util.Map;
import java.util.Set;
import java.util.UUID;

public interface ArchiveQueries {
    /** Called with artifact IDs visible to the actor in the enclosing read transaction. */
    Map<UUID, Map<String, Object>> views(UUID run, Set<UUID> visibleArtifacts);
}
