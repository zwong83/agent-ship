package agentship.platform.device.infrastructure;

import agentship.platform.device.api.WorkerDevices;
import agentship.platform.identity.Tokens;
import agentship.platform.web.ApiProblem;
import java.util.Map;
import java.util.UUID;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
class JdbcWorkerDevices implements WorkerDevices {
    private final NamedParameterJdbcTemplate jdbc;

    JdbcWorkerDevices(NamedParameterJdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @Override
    public Device authenticate(String authorization) {
        String token = authorization != null && authorization.startsWith("Bearer ") ? authorization.substring(7) : null;
        if (!Tokens.valid(token)) throw ApiProblem.unauthenticated();
        var devices = jdbc.query("SELECT id,mode FROM device WHERE token_digest=:digest AND revoked_at IS NULL",
                Map.of("digest", Tokens.digest(token)),
                (rs, row) -> new Device(rs.getObject("id", UUID.class), rs.getString("mode")));
        if (devices.isEmpty()) throw ApiProblem.unauthenticated();
        return devices.getFirst();
    }

    @Override
    public void requireActive(UUID device, boolean lockForShare) {
        var active = jdbc.queryForList("SELECT id FROM device WHERE id=:id AND revoked_at IS NULL"
                + (lockForShare ? " FOR SHARE" : ""), Map.of("id", device));
        if (active.isEmpty()) throw ApiProblem.unauthenticated();
    }

    @Override
    public void heartbeat(UUID device, String codexStatus) {
        int count = jdbc.update("UPDATE device SET last_seen_at=statement_timestamp(),codex_status=:status WHERE id=:id AND revoked_at IS NULL",
                Map.of("status", codexStatus, "id", device));
        if (count != 1) throw ApiProblem.unauthenticated();
    }
}
