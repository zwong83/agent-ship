package agentship.platform.catalog.infrastructure;

import agentship.platform.catalog.api.RequirementRepositories;
import agentship.platform.web.ApiProblem;
import java.util.Map;
import java.util.UUID;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
class JdbcRequirementRepositories implements RequirementRepositories {
    private final NamedParameterJdbcTemplate jdbc;

    JdbcRequirementRepositories(NamedParameterJdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @Override
    public void associate(UUID requirement, UUID repository) {
        UUID existing = jdbc.queryForObject("SELECT repository_id FROM requirement WHERE id=:id",
                Map.of("id", requirement), UUID.class);
        if (existing != null && !existing.equals(repository)) {
            throw new ApiProblem(409, "GIT_TARGET_CONFLICT", "The requirement has been associated with other warehouses, please confirm manually.");
        }
        if (existing == null) {
            jdbc.update("UPDATE requirement SET repository_id=:repository WHERE id=:id",
                    Map.of("repository", repository, "id", requirement));
            jdbc.update("UPDATE configuration SET version=version+1,updated_at=statement_timestamp() WHERE id=:id",
                    Map.of("id", requirement));
        }
    }
}
