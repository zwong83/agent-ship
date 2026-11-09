package agentship.platform.web;

import agentship.platform.identity.IdentityController;
import agentship.platform.identity.IdentityService;
import agentship.platform.identity.Tokens;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.net.URI;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.dao.DataAccessException;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.config.annotation.web.configurers.AbstractHttpConfigurer;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.crypto.password.Pbkdf2PasswordEncoder;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter;
import org.springframework.web.filter.OncePerRequestFilter;

@Configuration
@EnableWebSecurity
public class PlatformSecurity {
    @Bean
    PasswordEncoder passwordEncoder() {
        return Pbkdf2PasswordEncoder.defaultsForSpringSecurity_v5_8();
    }

    @Bean
    SecurityFilterChain platformFilterChain(HttpSecurity http, IdentityService identity, ObjectMapper json,
            @Value("${agentship.secure-cookie}") boolean secureCookie,
            @Value("${server.address}") String bindAddress) throws Exception {
        if (!secureCookie && !Set.of("127.0.0.1", "::1").contains(bindAddress)) {
            throw new IllegalStateException("An insecure session cookie requires a loopback bind address");
        }
        return http
                // The session-cookie filter validates the contract token on every authenticated write.
                .csrf(AbstractHttpConfigurer::disable)
                .sessionManagement(session -> session.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
                .requestCache(AbstractHttpConfigurer::disable)
                .formLogin(AbstractHttpConfigurer::disable)
                .httpBasic(AbstractHttpConfigurer::disable)
                .logout(AbstractHttpConfigurer::disable)
                .headers(headers -> headers.contentSecurityPolicy(policy -> policy.policyDirectives(
                        "default-src 'self'; connect-src 'self' http://127.0.0.1:4781; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'")))
                .authorizeHttpRequests(auth -> auth
                        .requestMatchers(HttpMethod.GET, "/api/me", "/api/dev/registration-messages").permitAll()
                        .requestMatchers(HttpMethod.POST, "/api/register", "/api/register/verify", "/api/login", "/api/worker/pair", "/api/worker/poll", "/api/worker/jobs/*/event", "/api/worker/jobs/*/authorize-external",
                                "/api/worker/archive/poll", "/api/worker/archive/authorize", "/api/worker/archive/result").permitAll()
                        .requestMatchers("/api/**").authenticated()
                        .anyRequest().permitAll())
                .exceptionHandling(errors -> errors.authenticationEntryPoint((request, response, ignored) ->
                        writeError(json, request, response, ApiProblem.unauthenticated())))
                .addFilterBefore(new SessionFilter(identity, json), UsernamePasswordAuthenticationFilter.class)
                .build();
    }

    private static void writeError(ObjectMapper json, HttpServletRequest request, HttpServletResponse response,
                                   ApiProblem error) throws IOException {
        response.setStatus(error.status());
        response.setContentType(MediaType.APPLICATION_JSON_VALUE);
        if (error.details().get("retryAfterSeconds") instanceof Number seconds) {
            response.setHeader(HttpHeaders.RETRY_AFTER, seconds.toString());
        }
        json.writeValue(response.getOutputStream(), ApiErrors.body(error, request));
    }

    private static final class SessionFilter extends OncePerRequestFilter {
        private static final Set<String> READ_METHODS = Set.of("GET", "HEAD", "OPTIONS");
        private static final Set<String> PUBLIC_WRITES = Set.of("/api/login", "/api/register", "/api/register/verify", "/api/worker/pair");
        private static final int AUTH_REQUESTS_PER_MINUTE = 60;
        private final IdentityService identity;
        private final ObjectMapper json;
        private final Map<String, Integer> authAttempts = new HashMap<>();
        private long currentWindow = -1;

        private SessionFilter(IdentityService identity, ObjectMapper json) {
            this.identity = identity;
            this.json = json;
        }

        @Override
        protected boolean shouldNotFilter(HttpServletRequest request) {
            return !request.getServletPath().startsWith("/api/");
        }

        @Override
        protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
                throws ServletException, IOException {
            response.setHeader("X-Request-Id", ApiErrors.requestId(request));
            response.setHeader(HttpHeaders.CACHE_CONTROL, "no-store");
            try {
                authenticateRequest(request);
            } catch (ApiProblem error) {
                writeError(json, request, response, error);
                return;
            } catch (DataAccessException error) {
                writeError(json, request, response,
                        new ApiProblem(503, "TEMPORARILY_UNAVAILABLE", "平台暂不可用，请稍后重试。"));
                return;
            }
            chain.doFilter(request, response);
        }

        private void authenticateRequest(HttpServletRequest request) {
            boolean write = !READ_METHODS.contains(request.getMethod());
            boolean publicWrite = request.getMethod().equals("POST") && PUBLIC_WRITES.contains(request.getServletPath());
            if (write) requireSameOrigin(request);
            if (publicWrite) requireBudget(request.getRemoteAddr(), request.getServletPath());

            if (request.getMethod().equals("POST") && (Set.of("/api/worker/pair", "/api/worker/poll").contains(request.getServletPath())
                    || request.getServletPath().matches("/api/worker/jobs/[0-9a-fA-F-]{36}/(event|authorize-external)")
                    || request.getServletPath().matches("/api/worker/archive/(poll|authorize|result)"))) return;

            String token = IdentityController.sessionCookie(request);
            var principal = identity.authenticate(token);
            if (principal.isEmpty()) return;

            if (write && !publicWrite && !Tokens.equal(Tokens.csrf(token), request.getHeader("X-CSRF-Token"))) {
                throw new ApiProblem(403, "FORBIDDEN", "请求来源或会话校验失败。");
            }
            var authenticated = principal.get();
            request.setAttribute("actor", authenticated.actor());
            request.setAttribute("identity", authenticated);
            SecurityContextHolder.getContext().setAuthentication(
                    UsernamePasswordAuthenticationToken.authenticated(authenticated.actor(), null, List.of()));
        }

        private synchronized void requireBudget(String address, String path) {
            long window = System.currentTimeMillis() / 60_000;
            if (window != currentWindow) {
                authAttempts.clear();
                currentWindow = window;
            }
            String key = address + path;
            if ((!authAttempts.containsKey(key) && authAttempts.size() >= 10_000)
                    || authAttempts.merge(key, 1, Integer::sum) > AUTH_REQUESTS_PER_MINUTE) {
                throw new ApiProblem(429, "TOO_MANY_REQUESTS", "请求过多，请稍后重试。",
                        Map.of("retryAfterSeconds", 60));
            }
        }

        private static void requireSameOrigin(HttpServletRequest request) {
            if ("cross-site".equals(request.getHeader("Sec-Fetch-Site"))) throw forbiddenOrigin();
            String origin = request.getHeader("Origin");
            if (origin == null) return;
            try {
                URI parsed = URI.create(origin);
                int port = parsed.getPort() >= 0 ? parsed.getPort() : "https".equals(parsed.getScheme()) ? 443 : 80;
                if (!Objects.equals(parsed.getScheme(), request.getScheme())
                        || !request.getServerName().equalsIgnoreCase(parsed.getHost())
                        || port != request.getServerPort() || parsed.getUserInfo() != null
                        || parsed.getRawQuery() != null || parsed.getRawFragment() != null || !parsed.getPath().isEmpty()) {
                    throw forbiddenOrigin();
                }
            } catch (IllegalArgumentException e) {
                throw forbiddenOrigin();
            }
        }

        private static ApiProblem forbiddenOrigin() {
            return new ApiProblem(403, "FORBIDDEN", "请求来源或会话校验失败。");
        }
    }
}
