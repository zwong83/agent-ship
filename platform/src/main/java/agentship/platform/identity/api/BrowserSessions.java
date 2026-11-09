package agentship.platform.identity.api;

import java.util.UUID;

public interface BrowserSessions {
    void requireActive(UUID account, UUID session);
}
