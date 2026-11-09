package agentship.platform.runtime.application.port;

import java.util.List;
import java.util.Map;
import java.util.UUID;

public interface RepairStore {
    List<Map<String, Object>> eligibleChecks(UUID run);
    void limitReached(Map<String, Object> run, UUID node);
    Integer recheckSource(Map<String, Object> run, UUID check);
    void stop(Map<String, Object> run, UUID check);
    boolean actionAvailable(Map<String, Object> run, UUID check, String state);
    int startRound(Map<String, Object> run, UUID check, UUID actor);
    List<Map<String, Object>> usedRoute(Map<String, Object> run, UUID check);
    List<Map<String, Object>> activeRounds(UUID run);
    void finishRound(Map<String, Object> run, UUID check, int number);
    void markClaimed(Map<String, Object> run, UUID node);
    int nextWave(Map<String, Object> run, UUID check);
    void newExecution(Map<String, Object> run, UUID node, int wave, String state);
    void pendingCheck(Map<String, Object> run, UUID node, int wave, Integer round);
}
