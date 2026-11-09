package agentship.platform.identity;

import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.Base64;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;

public final class Tokens {
    private static final SecureRandom RANDOM = new SecureRandom();

    private Tokens() {}

    public static String random() {
        byte[] bytes = new byte[32];
        RANDOM.nextBytes(bytes);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }

    public static boolean valid(String token) {
        return token != null && token.matches("[A-Za-z0-9_-]{43}");
    }

    public static byte[] digest(String token) {
        try {
            return MessageDigest.getInstance("SHA-256").digest(bytes(token));
        } catch (GeneralSecurityException e) {
            throw new IllegalStateException(e);
        }
    }

    public static byte[] hmac(byte[] key, String input) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(key, "HmacSHA256"));
            return mac.doFinal(bytes(input));
        } catch (GeneralSecurityException e) {
            throw new IllegalStateException(e);
        }
    }

    public static String csrf(String token) {
        return Base64.getUrlEncoder().withoutPadding().encodeToString(hmac(bytes(token), "agentship-csrf"));
    }

    public static boolean equal(String expected, String supplied) {
        return supplied != null && MessageDigest.isEqual(bytes(expected), bytes(supplied));
    }

    private static byte[] bytes(String input) {
        return input.getBytes(StandardCharsets.UTF_8);
    }
}
