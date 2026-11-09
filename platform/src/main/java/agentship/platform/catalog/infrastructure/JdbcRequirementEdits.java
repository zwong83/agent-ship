package agentship.platform.catalog.infrastructure;

import agentship.platform.catalog.api.RequirementEdits;
import agentship.platform.web.ApiProblem;
import java.util.UUID;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
class JdbcRequirementEdits implements RequirementEdits {
    private final NamedParameterJdbcTemplate jdbc;

    JdbcRequirementEdits(NamedParameterJdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @Override
    public void revise(UUID requirement, Content content) {
        var args = new MapSqlParameterSource("requirement", requirement).addValue("title", content.title())
                .addValue("nameKey", content.nameKey()).addValue("description", content.description());
        try {
            jdbc.update("UPDATE requirement SET name=:title,name_key=:nameKey,description=:description WHERE id=:requirement", args);
        } catch (DuplicateKeyException duplicate) {
            throw new ApiProblem(409, "REQUIREMENT_EXISTS", "已有同名需求，请使用其他名称。");
        }
        jdbc.update("UPDATE configuration SET version=version+1,updated_at=statement_timestamp() WHERE id=:requirement", args);
    }
}
