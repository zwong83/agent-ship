package agentship.platform.identity;

import agentship.platform.web.ApiProblem;
import java.nio.ByteBuffer;
import java.util.Base64;
import java.util.Locale;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

@Component
public class LocalVerification {
    private final byte[] key;

    public LocalVerification(@Value("${agentship.local-verification}") boolean enabled,
                             @Value("${agentship.verification-key}") String key,
                             @Value("${server.address}") String address) {
        if (!enabled) {
            this.key = null;
            return;
        }
        if (!"127.0.0.1".equals(address) && !"::1".equals(address)) {
            throw new IllegalStateException("Local verification requires a loopback bind address");
        }
        try {
            this.key = Base64.getUrlDecoder().decode(key);
        } catch (IllegalArgumentException e) {
            throw new IllegalStateException("Local verification requires a base64url key");
        }
        if (this.key.length < 32) throw new IllegalStateException("Local verification key must have at least 32 bytes");
    }

    public boolean enabled() { return key != null; }

    public void requireAvailable() {
        if (!enabled()) throw new ApiProblem(503, "TEMPORARILY_UNAVAILABLE", "验证渠道暂不可用。");
    }

    public String code(String reference, String channel) {
        requireAvailable();
        long value = Integer.toUnsignedLong(ByteBuffer.wrap(Tokens.hmac(key, "registration:" + reference + ":" + channel)).getInt());
        return String.format(Locale.ROOT, "%08d", value % 100_000_000);
    }
}
