package agentship.platform.runtime.application.port;

import java.util.UUID;

public interface GitStartGrants {
    void grant(UUID run, UUID actor);
}
