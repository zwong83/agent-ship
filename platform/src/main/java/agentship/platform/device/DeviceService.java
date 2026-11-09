package agentship.platform.device;

import agentship.platform.identity.Tokens;
import agentship.platform.device.api.RunDevices;
import agentship.platform.web.Actor;
import agentship.platform.web.ApiProblem;
import agentship.protocol.device.DeviceProofCodec;
import com.fasterxml.jackson.databind.JsonNode;
import java.security.GeneralSecurityException;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

@Service
public class DeviceService implements RunDevices {
    private static final int PAIR_SECONDS = 300;
    private static final int CHALLENGE_SECONDS = 120;
    private static final int ONLINE_SECONDS = 30;
    private final NamedParameterJdbcTemplate jdbc;

    public DeviceService(NamedParameterJdbcTemplate jdbc) { this.jdbc = jdbc; }

    @Transactional
    public Map<String,Object> pairing(Actor actor, String origin, String requestId) {
        session(actor);
        issuanceBudget(actor, "device_pairing", 20);
        String code = Tokens.random();
        UUID id = UUID.randomUUID();
        Instant expiry = Instant.now().plusSeconds(PAIR_SECONDS);
        jdbc.update("""
                INSERT INTO device_pairing(id,account_id,session_id,code_digest,paired_origin,expires_at)
                VALUES(:id,:actor,:session,:digest,:origin,:expires)
                """, Map.of("id",id,"actor",actor.id(),"session",actor.sessionId(),"digest",Tokens.digest(code),
                "origin",origin,"expires",Timestamp.from(expiry)));
        audit(actor.id(), id, "pairing_issued", requestId);
        return Map.of("code",code,"expiresAt",expiry.toString());
    }

    @Transactional
    public Map<String,Object> challenge(Actor actor, String origin) {
        session(actor);
        issuanceBudget(actor, "device_challenge", 60);
        UUID id = UUID.randomUUID();
        String nonce = Tokens.random();
        Instant expiry = Instant.now().plusSeconds(CHALLENGE_SECONDS);
        jdbc.update("""
                INSERT INTO device_challenge(id,account_id,session_id,nonce,platform_origin,expires_at)
                VALUES(:id,:actor,:session,:nonce,:origin,:expires)
                """,Map.of("id",id,"actor",actor.id(),"session",actor.sessionId(),"nonce",DeviceProofCodec.decode(nonce),
                "origin",origin,"expires",Timestamp.from(expiry)));
        return Map.of("challengeId",id,"nonce",nonce,"expiresAt",expiry.toString());
    }

    public Map<String,Object> devices(Actor actor) {
        var ids = jdbc.query("SELECT id FROM device WHERE account_id=:actor AND revoked_at IS NULL ORDER BY display_name,id",
                Map.of("actor",actor.id()), (rs,row) -> rs.getObject("id", UUID.class));
        return Map.of("items",ids.stream().map(this::status).toList());
    }

    public Map<String,Object> status(UUID id) {
        var rows = jdbc.query("""
                SELECT id,display_name,mode,codex_status,last_seen_at,
                       revoked_at IS NULL AND last_seen_at > statement_timestamp()-interval '30 seconds' AS online
                FROM device WHERE id=:id
                """,Map.of("id",id), (rs,row) -> {
            Map<String,Object> value = new LinkedHashMap<>();
            value.put("id",id); value.put("name",rs.getString("display_name")); value.put("mode",rs.getString("mode"));
            value.put("codexStatus",rs.getString("codex_status")); value.put("connectivity",rs.getBoolean("online") ? "online" : "offline");
            Timestamp seen = rs.getTimestamp("last_seen_at");
            if (seen != null) value.put("lastSeenAt",seen.toInstant().toString());
            return value;
        });
        if (rows.isEmpty()) throw new ApiProblem(404,"NOT_FOUND","找不到该设备。");
        return rows.getFirst();
    }

    @Transactional
    public Map<String,Object> pair(JsonNode body, String origin, String requestId) {
        String code = text(body,"code",128), name = text(body,"name",120), mode = text(body,"mode",10);
        if (!Tokens.valid(code) || !List.of("demo","codex").contains(mode) || !"1".equals(text(body,"protocolVersion",8))) throw ApiProblem.invalid();
        byte[] publicKey;
        try {
            publicKey = DeviceProofCodec.decode(text(body,"proofPublicKey",1024));
            DeviceProofCodec.publicKey(publicKey);
        } catch (IllegalArgumentException | GeneralSecurityException error) { throw ApiProblem.invalid(); }
        var pairings = jdbc.query("""
                SELECT id,account_id,session_id,paired_origin,expires_at,consumed_at FROM device_pairing
                WHERE code_digest=:digest FOR UPDATE
                """,Map.of("digest",Tokens.digest(code)),(rs,row) -> new Pairing(rs.getObject("id",UUID.class),
                new Actor(rs.getObject("account_id",UUID.class),rs.getObject("session_id",UUID.class)),
                rs.getString("paired_origin"),rs.getTimestamp("expires_at").toInstant(),rs.getTimestamp("consumed_at")));
        if (pairings.isEmpty()) throw unavailablePair();
        Pairing pairing = pairings.getFirst();
        if (pairing.consumed != null || !pairing.expires.isAfter(Instant.now()) || !origin.equals(pairing.origin)) throw unavailablePair();
        session(pairing.actor);
        UUID id = UUID.randomUUID();
        String token = Tokens.random();
        jdbc.update("""
                INSERT INTO device(id,account_id,display_name,mode,protocol_version,paired_origin,token_digest,proof_public_key,codex_status,last_seen_at)
                VALUES(:id,:actor,:name,:mode,'1',:origin,:digest,:publicKey,:status,NULL)
                """,Map.of("id",id,"actor",pairing.actor.id(),"name",name,"mode",mode,"origin",origin,
                "digest",Tokens.digest(token),"publicKey",publicKey,"status",mode.equals("demo") ? "not_required" : "unknown"));
        jdbc.update("UPDATE device_pairing SET consumed_at=statement_timestamp() WHERE id=:id",Map.of("id",pairing.id));
        audit(pairing.actor.id(),id,"paired",requestId);
        return Map.of("deviceId",id,"token",token,"protocolVersion","1");
    }

    /** Must share the run-start transaction so rejected starts do not consume a challenge. */
    @Transactional(propagation = Propagation.MANDATORY)
    public DeviceBinding consumeProof(Actor actor, JsonNode proof, String origin) {
        session(actor);
        UUID deviceId = uuid(proof,"deviceId"), challengeId = uuid(proof,"challengeId");
        String signature = text(proof,"signature",1024);
        var challenges = jdbc.query("""
                SELECT nonce,expires_at,consumed_at FROM device_challenge
                WHERE id=:id AND account_id=:actor AND session_id=:session AND platform_origin=:origin FOR UPDATE
                """,Map.of("id",challengeId,"actor",actor.id(),"session",actor.sessionId(),"origin",origin),
                (rs,row) -> new Challenge(rs.getBytes("nonce"),rs.getTimestamp("expires_at").toInstant(),rs.getTimestamp("consumed_at")));
        if (challenges.isEmpty()) throw invalidProof();
        Challenge challenge = challenges.getFirst();
        if (challenge.consumed != null || !challenge.expires.isAfter(Instant.now())) throw invalidProof();
        var devices = jdbc.query("""
                SELECT mode,proof_public_key,codex_status,last_seen_at FROM device
                WHERE id=:id AND account_id=:actor AND paired_origin=:origin AND revoked_at IS NULL FOR UPDATE
                """,Map.of("id",deviceId,"actor",actor.id(),"origin",origin), (rs,row) -> new ProofDevice(
                rs.getString("mode"),rs.getBytes("proof_public_key"),rs.getString("codex_status"),rs.getTimestamp("last_seen_at")));
        if (devices.isEmpty()) throw invalidProof();
        ProofDevice device = devices.getFirst();
        try {
            if (!DeviceProofCodec.verify(device.key,DeviceProofCodec.message(deviceId,challengeId,
                    DeviceProofCodec.encode(challenge.nonce),origin),signature)) throw invalidProof();
        } catch (IllegalArgumentException | GeneralSecurityException error) { throw invalidProof(); }
        if (device.seen == null || device.seen.toInstant().isBefore(Instant.now().minusSeconds(ONLINE_SECONDS)))
            throw new ApiProblem(409,"DEVICE_OFFLINE","请先启动本机程序，再重新确认发起电脑。");
        if (device.mode.equals("codex") && !device.codex.equals("available"))
            throw new ApiProblem(409,"CODEX_UNAVAILABLE","本机 Codex 尚不可用，请检查后重试。");
        jdbc.update("UPDATE device_challenge SET consumed_at=statement_timestamp() WHERE id=:id",Map.of("id",challengeId));
        return new DeviceBinding(deviceId,device.mode);
    }

    private void issuanceBudget(Actor actor, String table, int maximum) {
        jdbc.query("SELECT pg_advisory_xact_lock(hashtextextended(:scope,0))",Map.of("scope",table+":"+actor.id()),rs -> {});
        // Table is one of two internal constants, never a request field.
        Long count = jdbc.queryForObject("SELECT count(*) FROM " + table + " WHERE account_id=:actor AND expires_at>statement_timestamp()",
                Map.of("actor",actor.id()),Long.class);
        if (count != null && count >= maximum) throw new ApiProblem(429,"TOO_MANY_REQUESTS","请求过多，请稍后重试。",Map.of("retryAfterSeconds",60));
    }

    private void session(Actor actor) {
        var sessions = jdbc.query("""
                SELECT s.id FROM account_session s JOIN account a ON a.id=s.account_id
                WHERE s.id=:session AND s.account_id=:actor AND a.status='active'
                  AND s.revoked_at IS NULL AND s.expires_at>statement_timestamp()
                FOR SHARE OF s,a
                """,Map.of("actor",actor.id(),"session",actor.sessionId()),(rs,row) -> rs.getObject("id",UUID.class));
        if (sessions.isEmpty()) throw ApiProblem.unauthenticated();
    }

    private void audit(UUID actor, UUID id, String action, String requestId) {
        jdbc.update("""
                INSERT INTO audit_event(id,request_id,actor_account_id,target_kind,target_id,action,outcome)
                VALUES(:id,:request,:actor,'device',:target,:action,'accepted')
                """,Map.of("id",UUID.randomUUID(),"request",requestId,"actor",actor,"target",id,"action",action));
    }

    private static String text(JsonNode body, String name, int max) {
        JsonNode value = body == null ? null : body.get(name);
        if (value == null || !value.isTextual() || value.asText().isBlank() || value.asText().length() > max) throw ApiProblem.invalid();
        return value.asText();
    }
    private static UUID uuid(JsonNode body, String name) {
        try { return UUID.fromString(text(body,name,36)); } catch (IllegalArgumentException error) { throw ApiProblem.invalid(); }
    }
    private static ApiProblem unavailablePair() { return new ApiProblem(409,"PAIRING_UNAVAILABLE","配对码无效、已使用或已过期，请重新生成。"); }
    private static ApiProblem invalidProof() { return new ApiProblem(409,"DEVICE_PROOF_INVALID","设备确认无效或已过期，请重新确认发起电脑。"); }
    private record Pairing(UUID id, Actor actor, String origin, Instant expires, Timestamp consumed) {}
    private record Challenge(byte[] nonce, Instant expires, Timestamp consumed) {}
    private record ProofDevice(String mode, byte[] key, String codex, Timestamp seen) {}
}
