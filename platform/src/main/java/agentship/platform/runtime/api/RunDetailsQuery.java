package agentship.platform.runtime.api;

import agentship.platform.web.Actor;
import java.util.Map;
import java.util.UUID;

public interface RunDetailsQuery {
    /** Artifact projections reference the same fields that are included in the response body. */
    record Details(Map<String, Object> body, Map<UUID, Map<String, Object>> artifacts) {}

    Details detail(Actor actor, UUID run);
}
