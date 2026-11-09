package agentship.platform.identity;

import agentship.platform.web.Actor;
import agentship.platform.web.ApiErrors;
import agentship.platform.web.ApiProblem;
import jakarta.servlet.http.HttpServletRequest;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseCookie;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api")
public class IdentityController {
    public static final String SESSION_COOKIE = "agentship_session";

    private final IdentityService identity;
    private final boolean secureCookie;

    public IdentityController(IdentityService identity, @Value("${agentship.secure-cookie}") boolean secureCookie) {
        this.identity = identity;
        this.secureCookie = secureCookie;
    }

    @GetMapping("/me")
    public IdentityService.Session me(HttpServletRequest request,
            @RequestAttribute(name = "identity", required = false) IdentityService.Authenticated authenticated) {
        return authenticated == null ? new IdentityService.Session(null, null)
                : new IdentityService.Session(authenticated.user(), Tokens.csrf(sessionCookie(request)));
    }

    @GetMapping("/me/contact")
    public IdentityService.Contact contact(@RequestAttribute Actor actor) {
        return identity.contact(actor);
    }

    @PostMapping("/register")
    public ResponseEntity<IdentityService.Receipt> register(@RequestBody IdentityService.Registration input,
                                                           HttpServletRequest request) {
        return ResponseEntity.accepted().body(identity.register(input, ApiErrors.requestId(request)));
    }

    @PostMapping("/register/verify")
    public IdentityService.VerificationResult verify(@RequestBody IdentityService.Proof proof,
                                                      HttpServletRequest request) {
        return identity.verify(proof, ApiErrors.requestId(request));
    }

    @GetMapping("/dev/registration-messages")
    public Map<String, List<IdentityService.Message>> developmentInbox(@RequestParam String registrationRef,
                                                                        HttpServletRequest request) {
        if (!localHost(request.getServerName()) || !localHost(request.getRemoteAddr())) {
            throw new ApiProblem(404, "NOT_FOUND", "未找到所请求的内容。");
        }
        return Map.of("messages", identity.developmentInbox(registrationRef));
    }

    @PostMapping("/login")
    public ResponseEntity<IdentityService.Session> login(@RequestBody IdentityService.Login input,
                                                        HttpServletRequest request) {
        var result = identity.login(input, ApiErrors.requestId(request));
        return ResponseEntity.ok().header(HttpHeaders.SET_COOKIE, cookie(result.cookie(), Duration.ofHours(12)))
                .body(result.session());
    }

    @PostMapping("/logout")
    public ResponseEntity<Map<String, Boolean>> logout(@RequestAttribute Actor actor, HttpServletRequest request) {
        identity.logout(actor, ApiErrors.requestId(request));
        return ResponseEntity.ok().header(HttpHeaders.SET_COOKIE, cookie("", Duration.ZERO))
                .body(Map.of("accepted", true));
    }

    private String cookie(String token, Duration duration) {
        return ResponseCookie.from(SESSION_COOKIE, token).httpOnly(true).secure(secureCookie)
                .sameSite("Strict").path("/").maxAge(duration).build().toString();
    }

    public static String sessionCookie(HttpServletRequest request) {
        if (request.getCookies() == null) return null;
        for (var cookie : request.getCookies()) {
            if (SESSION_COOKIE.equals(cookie.getName())) return cookie.getValue();
        }
        return null;
    }

    private static boolean localHost(String value) {
        return "127.0.0.1".equals(value) || "localhost".equalsIgnoreCase(value)
                || "::1".equals(value) || "[::1]".equals(value) || "0:0:0:0:0:0:0:1".equals(value);
    }
}
