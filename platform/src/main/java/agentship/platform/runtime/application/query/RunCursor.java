package agentship.platform.runtime.application.query;

import agentship.platform.web.ApiProblem;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.DataInputStream;
import java.io.DataOutputStream;
import java.io.IOException;
import java.security.GeneralSecurityException;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.Base64;
import java.util.UUID;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.stereotype.Component;

@Component
class RunCursor {
    private final byte[] key = new SecureRandom().generateSeed(32);

    record Position(String name, UUID id) {}

    Position decode(String token, String scope) {
        if (token == null) {
            return null;
        }
        if (token.isEmpty() || token.length() > 4096) {
            throw expired();
        }
        try {
            String[] parts = token.split("\\.",-1);
            if (parts.length != 2) {
                throw expired();
            }
            var decoder = Base64.getUrlDecoder();
            byte[] body = decoder.decode(parts[0]);
            if (!MessageDigest.isEqual(sign(body),decoder.decode(parts[1]))) {
                throw expired();
            }
            try (var input = new DataInputStream(new ByteArrayInputStream(body))) {
                if (!scope.equals(input.readUTF())) {
                    throw expired();
                }
                Position position = new Position(input.readUTF(),new UUID(input.readLong(),input.readLong()));
                if (input.read() != -1) {
                    throw expired();
                }
                return position;
            }
        } catch (IllegalArgumentException | IOException invalid) {
            throw expired();
        }
    }

    String encode(String scope, Position position) {
        try (var buffer = new ByteArrayOutputStream(); var output = new DataOutputStream(buffer)) {
            output.writeUTF(scope);
            output.writeUTF(position.name());
            output.writeLong(position.id().getMostSignificantBits());
            output.writeLong(position.id().getLeastSignificantBits());
            byte[] body = buffer.toByteArray();
            var encoder = Base64.getUrlEncoder().withoutPadding();
            return encoder.encodeToString(body) + "." + encoder.encodeToString(sign(body));
        } catch (IOException impossible) {
            throw new IllegalStateException("Cannot encode run cursor",impossible);
        }
    }

    private byte[] sign(byte[] body) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(key,"HmacSHA256"));
            return mac.doFinal(body);
        } catch (GeneralSecurityException unavailable) {
            throw new IllegalStateException("Cannot sign run cursor",unavailable);
        }
    }

    private static ApiProblem expired() {
        return new ApiProblem(410,"CURSOR_EXPIRED","分页已失效，请重新查询");
    }
}
