package agentship.platform.device.api;

import java.util.UUID;

public interface WorkerDevices {
    record Device(UUID id, String mode) {}

    Device authenticate(String authorization);
    void requireActive(UUID device, boolean lockForShare);
    void heartbeat(UUID device, String codexStatus);
}
