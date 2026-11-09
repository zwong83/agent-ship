package agentship.protocol.device;

import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.KeyFactory;
import java.security.PrivateKey;
import java.security.PublicKey;
import java.security.Signature;
import java.security.spec.X509EncodedKeySpec;
import java.util.Base64;
import java.util.UUID;

/** Shared canonical proof format; credentials never cross the browser bridge. */
public final class DeviceProofCodec {
    private DeviceProofCodec() {}

    public static String normalizeOrigin(String value) {
        URI uri = URI.create(value);
        if ((!"http".equals(uri.getScheme()) && !"https".equals(uri.getScheme())) || uri.getHost() == null
                || uri.getUserInfo() != null || uri.getRawQuery() != null || uri.getRawFragment() != null
                || (!uri.getPath().isEmpty() && !uri.getPath().equals("/"))) {
            throw new IllegalArgumentException("Invalid platform origin");
        }
        int port = uri.getPort();
        String suffix = port < 0 || port == ("https".equals(uri.getScheme()) ? 443 : 80) ? "" : ":" + port;
        return uri.getScheme() + "://" + uri.getHost().toLowerCase(java.util.Locale.ROOT) + suffix;
    }

    public static byte[] message(UUID device, UUID challenge, String nonce, String origin) {
        return String.join("\n", "agentship-device-proof-v1", device.toString(), challenge.toString(),
                nonce, normalizeOrigin(origin)).getBytes(StandardCharsets.UTF_8);
    }

    public static String encode(byte[] bytes) { return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes); }

    public static byte[] decode(String text) {
        if (text == null || text.length() > 1024 || !text.matches("[A-Za-z0-9_-]+")) throw new IllegalArgumentException();
        byte[] result = Base64.getUrlDecoder().decode(text);
        if (!encode(result).equals(text)) throw new IllegalArgumentException();
        return result;
    }

    public static PublicKey publicKey(byte[] encoded) throws GeneralSecurityException {
        return KeyFactory.getInstance("Ed25519").generatePublic(new X509EncodedKeySpec(encoded));
    }

    public static String sign(PrivateKey key, byte[] message) throws GeneralSecurityException {
        Signature signature = Signature.getInstance("Ed25519");
        signature.initSign(key);
        signature.update(message);
        return encode(signature.sign());
    }

    public static boolean verify(byte[] key, byte[] message, String proof) throws GeneralSecurityException {
        Signature signature = Signature.getInstance("Ed25519");
        signature.initVerify(publicKey(key));
        signature.update(message);
        byte[] bytes = decode(proof);
        return bytes.length == 64 && signature.verify(bytes);
    }
}
