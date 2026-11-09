package agentship.platform.runtime.infrastructure;

import agentship.platform.runtime.application.port.GitStartGrants;
import agentship.platform.runtime.domain.GitPlan;
import java.util.Map;
import java.util.UUID;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
class JdbcGitStartGrants implements GitStartGrants {
    private final NamedParameterJdbcTemplate jdbc;

    JdbcGitStartGrants(NamedParameterJdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @Override
    public void grant(UUID runId,UUID actor) {
        var run=jdbc.queryForMap("SELECT r.*,p.display_name AS repository_name FROM run r LEFT JOIN repository p ON p.id=r.repository_id WHERE r.id=:id",Map.of("id",runId));
        for(var op : GitPlan.operations(run)) jdbc.update("""
                INSERT INTO run_external_grant(run_id,effect,target_key,approved_by,policy_ref,approved_at,expires_at)
                VALUES(:run,:effect,:target,:actor,'run-start-git-v1',statement_timestamp(),statement_timestamp()+interval '24 hours')
                """,Map.of("run",runId,"effect",op.effect(),"target",op.targetId(),"actor",actor));
    }
}
