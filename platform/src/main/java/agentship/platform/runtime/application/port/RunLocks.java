package agentship.platform.runtime.application.port;

import java.util.Map;
import java.util.UUID;

/** Runtime writes acquire the configuration row before the run row. */
public interface RunLocks {
    UUID requirementId(UUID run);
    Map<String, Object> lock(UUID run, UUID requirement, boolean skipLocked);
}
