package agentship.platform.runtime.application.port;

import java.util.List;
import java.util.Map;
import java.util.UUID;

public interface AgentInboxStore {
    List<Map<String, Object>> pending(UUID run, UUID task, String session);
    int updateDelivery(UUID run, UUID task, String session, List<UUID> ids, String status);
    boolean delivered(UUID run, UUID task, String session, UUID inbox);
    boolean replied(UUID run, UUID task, UUID inbox);
    void markUnknown(UUID run, UUID task, String session);
    void recordQuestion(UUID run, UUID task, UUID attempt, UUID event, String session, String body);
    void recordMessage(UUID run, UUID task, UUID event, UUID reply, String body);
}
