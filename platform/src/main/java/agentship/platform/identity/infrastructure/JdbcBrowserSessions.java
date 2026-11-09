package agentship.platform.identity.infrastructure;

import agentship.platform.identity.api.BrowserSessions;
import agentship.platform.web.ApiProblem;
import java.util.Map;
import java.util.UUID;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
class JdbcBrowserSessions implements BrowserSessions {
    private final NamedParameterJdbcTemplate jdbc;

    JdbcBrowserSessions(NamedParameterJdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @Override
    public void requireActive(UUID account, UUID session) {
        Boolean active = jdbc.queryForObject("SELECT active_browser_session(:actor,:session)",
                Map.of("actor", account, "session", session), Boolean.class);
        if (!Boolean.TRUE.equals(active)) throw ApiProblem.unauthenticated();
    }
}
