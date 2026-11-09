package agentship.platform.device.api;

import agentship.platform.web.Actor;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.Map;
import java.util.UUID;

public interface RunDevices {
    record DeviceBinding(UUID id, String mode) {}

    DeviceBinding consumeProof(Actor actor, JsonNode proof, String origin);
    Map<String, Object> status(UUID device);
}
