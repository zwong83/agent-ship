package agentship.platform.identity;

import agentship.platform.web.Actor;
import agentship.platform.web.ApiProblem;
import java.text.Normalizer;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Optional;
import java.util.UUID;
import java.util.regex.Pattern;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class IdentityService {
    private static final Pattern USERNAME = Pattern.compile("[A-Za-z0-9_-]{1,100}");
    private static final Pattern EMAIL = Pattern.compile("[^@\\s]+@[^@\\s]+\\.[^@\\s]+");
    private static final List<String> CHANNELS = List.of("email", "phone");

    private final JdbcTemplate db;
    private final PasswordEncoder passwords;
    private final LocalVerification verification;
    private final String missingAccountHash;

    public IdentityService(JdbcTemplate db, PasswordEncoder passwords, LocalVerification verification) {
        this.db = db;
        this.passwords = passwords;
        this.verification = verification;
        this.missingAccountHash = passwords.encode(Tokens.random());
    }

    public record Registration(String name, String username, String phone, String email, String password,
                               String confirmPassword) {}
    public record Receipt(String status, List<String> requiredChannels, String registrationRef, OffsetDateTime expiresAt) {}
    public record Proof(String registrationRef, String channel, String code) {}
    public record VerificationResult(String status, List<String> verifiedChannels) {}
    public record Message(String channel, String code) {}
    public record Contact(String email, String phone) {}
    public record User(UUID id, String displayName, String username) {}
    public record Session(User user, String csrfToken) {}
    public record Login(String identifier, String password) {}
    public record Authenticated(Actor actor, User user) {}
    public record LoginResult(Session session, String cookie) {}
    private record Credentials(User user, String hash) {}
    private record RegistrationState(UUID accountId, String status, boolean emailVerified, boolean phoneVerified) {}

    @Transactional
    public Receipt register(Registration input, String requestId) {
        verification.requireAvailable();
        String name = requiredTrimmed(input.name(), 100);
        String username = requiredTrimmed(input.username(), 100);
        if (!USERNAME.matcher(username).matches() || !username.equals(input.username())) throw ApiProblem.invalid();
        String email = requiredTrimmed(input.email(), 254);
        if (!EMAIL.matcher(email).matches()) throw ApiProblem.invalid();
        String phone = normalizePhone(input.phone());
        String password = input.password();
        if (!validPassword(password) || !password.equals(input.confirmPassword())) throw ApiProblem.invalid();
        String usernameKey = key(username);
        String emailKey = key(email);
        String passwordHash = passwords.encode(password);

        db.update("""
                WITH expired AS (
                    SELECT id FROM account
                    WHERE status = 'pending' AND created_at <= statement_timestamp() - interval '24 hours'
                      AND (username_key = ? OR email_login_key = ? OR phone = ?)
                    ORDER BY id FOR UPDATE
                )
                DELETE FROM account a USING expired e
                WHERE a.id = e.id AND a.status = 'pending'
                  AND a.created_at <= clock_timestamp() - interval '24 hours'
                """, usernameKey, emailKey, phone);

        UUID accountId = UUID.randomUUID();
        var expiry = db.query("""
                INSERT INTO account (id,display_name,username,username_key,email,email_login_key,phone,password_hash,status)
                VALUES (?,?,?,?,?,?,?,?,'pending') ON CONFLICT DO NOTHING
                RETURNING created_at + interval '24 hours'
                """, (rs, row) -> rs.getObject(1, OffsetDateTime.class),
                accountId, name, username, usernameKey, email, emailKey, phone, passwordHash)
                .stream().findFirst().orElseThrow(() -> new ApiProblem(409, "IDENTIFIER_UNAVAILABLE", "所填注册标识不可用。"));

        String reference = Tokens.random();
        db.update("INSERT INTO registration_scope (account_id,reference_digest) VALUES (?,?)",
                accountId, Tokens.digest(reference));
        audit(accountId, "register", requestId);
        return new Receipt("verification_required", CHANNELS, reference, expiry);
    }

    @Transactional
    public VerificationResult verify(Proof proof, String requestId) {
        verification.requireAvailable();
        if (!Tokens.valid(proof.registrationRef()) || proof.channel() == null || !CHANNELS.contains(proof.channel())
                || proof.code() == null || !proof.code().matches("[0-9]{8}")) throw proofRejected();

        var ids = db.query("""
                SELECT a.id FROM registration_scope r JOIN account a ON a.id = r.account_id
                WHERE r.reference_digest = ? FOR UPDATE OF a
                """, (rs, row) -> rs.getObject(1, UUID.class), Tokens.digest(proof.registrationRef()));
        if (ids.isEmpty()) throw proofRejected();
        var state = state(proof.registrationRef()).orElseThrow(IdentityService::proofRejected);
        if (!Tokens.equal(verification.code(proof.registrationRef(), proof.channel()), proof.code())) throw proofRejected();

        if (proof.channel().equals("email") ? state.emailVerified() : state.phoneVerified()) {
            return verificationResult(state);
        }

        var changed = db.query("""
                UPDATE account SET
                    email_verified_at = CASE WHEN ? = 'email' THEN statement_timestamp() ELSE email_verified_at END,
                    phone_verified_at = CASE WHEN ? = 'phone' THEN statement_timestamp() ELSE phone_verified_at END,
                    status = CASE WHEN (? = 'email' OR email_verified_at IS NOT NULL)
                                   AND (? = 'phone' OR phone_verified_at IS NOT NULL)
                                  THEN 'active' ELSE 'pending' END
                WHERE id = ? AND status = 'pending' AND created_at > clock_timestamp() - interval '24 hours'
                RETURNING id,status,email_verified_at IS NOT NULL,phone_verified_at IS NOT NULL
                """, (rs, row) -> new RegistrationState(rs.getObject(1, UUID.class), rs.getString(2),
                        rs.getBoolean(3), rs.getBoolean(4)), proof.channel(), proof.channel(), proof.channel(),
                proof.channel(), state.accountId()).stream().findFirst().orElseThrow(IdentityService::proofRejected);

        if (changed.status().equals("active")) provisionPersonalProject(changed.accountId());
        audit(changed.accountId(), changed.status().equals("active") ? "activate_account" : "verify_contact", requestId);
        return verificationResult(changed);
    }

    public List<Message> developmentInbox(String reference) {
        if (!verification.enabled()) throw new ApiProblem(404, "NOT_FOUND", "未找到所请求的内容。");
        var state = state(reference).orElseThrow(IdentityService::proofRejected);
        if (!state.status().equals("pending")) return List.of();
        List<Message> messages = new ArrayList<>(2);
        if (!state.emailVerified()) messages.add(new Message("email", verification.code(reference, "email")));
        if (!state.phoneVerified()) messages.add(new Message("phone", verification.code(reference, "phone")));
        return messages;
    }

    @Transactional
    public LoginResult login(Login input, String requestId) {
        String identifier = requiredTrimmed(input.identifier(), 254);
        if (!validPassword(input.password())) throw ApiProblem.unauthenticated();
        var credentials = db.query("""
                SELECT id,display_name,username,password_hash FROM account
                WHERE status = 'active' AND CASE WHEN ? THEN email_login_key = ? ELSE username_key = ? END
                """, (rs, row) -> new Credentials(new User(rs.getObject(1, UUID.class), rs.getString(2), rs.getString(3)),
                rs.getString(4)), identifier.contains("@"), key(identifier), key(identifier)).stream().findFirst();
        boolean matches = passwords.matches(input.password(), credentials.map(Credentials::hash).orElse(missingAccountHash));
        if (!matches || credentials.isEmpty()) throw ApiProblem.unauthenticated();

        User user = credentials.get().user();
        String token = Tokens.random();
        db.update("""
                INSERT INTO account_session (id,account_id,token_digest,expires_at)
                VALUES (?,?,?,statement_timestamp()+interval '12 hours')
                """, UUID.randomUUID(), user.id(), Tokens.digest(token));
        audit(user.id(), "login", requestId);
        return new LoginResult(new Session(user, Tokens.csrf(token)), token);
    }

    public Optional<Authenticated> authenticate(String token) {
        if (!Tokens.valid(token)) return Optional.empty();
        return db.query("""
                SELECT a.id,s.id,a.display_name,a.username FROM account_session s JOIN account a ON a.id=s.account_id
                WHERE s.token_digest=? AND s.revoked_at IS NULL AND s.expires_at > statement_timestamp()
                  AND a.status='active'
                """, (rs, row) -> {
            UUID accountId = rs.getObject(1, UUID.class);
            return new Authenticated(new Actor(accountId, rs.getObject(2, UUID.class)),
                    new User(accountId, rs.getString(3), rs.getString(4)));
        }, Tokens.digest(token)).stream().findFirst();
    }

    public Contact contact(Actor actor) {
        return db.query("SELECT email,phone FROM account WHERE id=? AND active_browser_session(?,?)",
                (rs, row) -> new Contact(rs.getString(1), rs.getString(2)), actor.id(), actor.id(), actor.sessionId())
                .stream().findFirst().orElseThrow(ApiProblem::unauthenticated);
    }

    @Transactional
    public void logout(Actor actor, String requestId) {
        int count = db.update("""
                UPDATE account_session SET revoked_at=statement_timestamp()
                WHERE id=? AND account_id=? AND revoked_at IS NULL
                """, actor.sessionId(), actor.id());
        db.update("""
                UPDATE chat_lease SET holder_account_id=NULL,holder_session_id=NULL,holder_tab_id=NULL,
                    heartbeat_until=NULL,grace_until=NULL WHERE holder_session_id=?
                """, actor.sessionId());
        if (count == 1) audit(actor.id(), "logout", requestId);
    }

    @Scheduled(fixedDelay = 60_000, initialDelay = 60_000)
    public void cleanExpired() {
        db.update("""
                WITH expired AS (
                    SELECT id FROM account
                    WHERE status='pending' AND created_at <= statement_timestamp()-interval '24 hours'
                    ORDER BY created_at,id LIMIT 100 FOR UPDATE SKIP LOCKED
                )
                DELETE FROM account a USING expired e WHERE a.id=e.id AND a.status='pending'
                  AND a.created_at <= clock_timestamp()-interval '24 hours'
                """);
    }

    private Optional<RegistrationState> state(String reference) {
        if (!Tokens.valid(reference)) return Optional.empty();
        return db.query("""
                SELECT a.id,a.status,a.email_verified_at IS NOT NULL,a.phone_verified_at IS NOT NULL
                FROM registration_scope r JOIN account a ON a.id=r.account_id
                WHERE r.reference_digest=? AND a.status IN ('pending','active')
                  AND a.created_at > clock_timestamp()-interval '24 hours'
                """, (rs, row) -> new RegistrationState(rs.getObject(1, UUID.class), rs.getString(2),
                rs.getBoolean(3), rs.getBoolean(4)), Tokens.digest(reference)).stream().findFirst();
    }

    private VerificationResult verificationResult(RegistrationState state) {
        List<String> channels = new ArrayList<>(2);
        if (state.emailVerified()) channels.add("email");
        if (state.phoneVerified()) channels.add("phone");
        return new VerificationResult(state.status().equals("active") ? "active" : "verification_required", channels);
    }

    private void provisionPersonalProject(UUID accountId) {
        UUID projectId = UUID.randomUUID();
        db.update("INSERT INTO project (id,name) VALUES (?,?)", projectId, "个人工作区");
        db.update("""
                INSERT INTO project_permission (project_id,account_id,capability,granted_by)
                VALUES (?,?,'view_project',?),(?,?,'create_requirement',?)
                """, projectId, accountId, accountId, projectId, accountId, accountId);
    }

    private void audit(UUID accountId, String action, String requestId) {
        db.update("""
                INSERT INTO audit_event (id,request_id,actor_account_id,target_kind,target_id,action,outcome)
                VALUES (?,?,?,'account',?,?,'accepted')
                """, UUID.randomUUID(), requestId,
                action.equals("register") || action.equals("verify_contact") ? null : accountId, accountId, action);
    }

    private static String requiredTrimmed(String value, int max) {
        if (value == null || value.isBlank() || value.codePointCount(0, value.length()) > max
                || value.indexOf(0) >= 0) throw ApiProblem.invalid();
        return value.strip();
    }

    private static String key(String value) {
        return Normalizer.normalize(value, Normalizer.Form.NFC).toLowerCase(Locale.ROOT);
    }

    private static String normalizePhone(String value) {
        String input = requiredTrimmed(value, 40);
        if (!input.matches("[+][0-9() .-]+")) throw ApiProblem.invalid();
        String phone = input.replaceAll("[() .-]", "");
        if (!phone.matches("[+][1-9][0-9]{1,14}")) throw ApiProblem.invalid();
        return phone;
    }

    private static boolean validPassword(String password) {
        if (password == null || password.length() > 256 || password.indexOf(0) >= 0) return false;
        int size = password.codePointCount(0, password.length());
        return size >= 15 && size <= 128;
    }

    private static ApiProblem proofRejected() {
        return new ApiProblem(400, "INVALID_REQUEST", "验证码无效或注册已过期。");
    }
}
