package agentship.platform.runtime.application.port;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;

public interface ChatOperatorStore {
    record LeaseKey(UUID run, UUID actor, UUID session, UUID tab) {}
    record Lease(long epoch, Instant heartbeatDue) {}
    record Command(UUID run, UUID actor, String scope, String key, byte[] digest) {}

    Lease acquire(LeaseKey key);
    String holderName(UUID run);
    boolean release(LeaseKey key, long epoch);
    Lease renew(LeaseKey key, long epoch);
    void lockLease(UUID run);
    boolean hasActiveLease(LeaseKey key, long epoch);
    boolean canChat(UUID run, UUID actor);
    boolean isInitiator(UUID run, UUID actor);
    List<Map<String, Object>> targets(UUID run);
    Long checkWave(UUID run, UUID check);
    List<Map<String, Object>> guests(UUID run);
    UUID activeAccount(String username);
    boolean isDeputy(UUID requirement, UUID account);
    void grant(UUID run, UUID target, UUID actor);
    void revoke(UUID run, UUID target);
    UUID reserve(Command command);
    void accept(Command command, UUID receipt, UUID target, String kind, String action, String requestId);
}
