package agentship.platform.runtime.application.port;

import agentship.platform.web.Actor;
import java.util.Map;
import java.util.UUID;

public interface ChatView {
    Map<String, Object> read(Actor actor, UUID run, String lease, String cursor, Integer size);
}
