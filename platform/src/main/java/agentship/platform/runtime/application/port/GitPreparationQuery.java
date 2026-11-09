package agentship.platform.runtime.application.port;

import java.util.Map;

public interface GitPreparationQuery {
    Map<String, Object> read(Map<String, Object> run);
}
