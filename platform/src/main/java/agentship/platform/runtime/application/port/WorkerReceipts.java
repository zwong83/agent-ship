package agentship.platform.runtime.application.port;

import java.util.UUID;

public interface WorkerReceipts {
    UUID reserve(UUID device, String scope, String key, byte[] digest);
    void finish(UUID device, String scope, String key, String kind, UUID result);
}
