package agentship.platform.web;

import agentship.protocol.device.DeviceProofCodec;
import jakarta.servlet.http.HttpServletRequest;

public final class PlatformOrigin {
    private PlatformOrigin() {}

    public static String from(HttpServletRequest request) {
        return DeviceProofCodec.normalizeOrigin(request.getScheme() + "://" + request.getServerName()
                + ":" + request.getServerPort());
    }
}
