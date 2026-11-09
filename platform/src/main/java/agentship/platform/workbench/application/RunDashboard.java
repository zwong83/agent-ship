package agentship.platform.workbench.application;

import agentship.platform.archive.api.ArchiveQueries;
import agentship.platform.runtime.api.RunDetailsQuery;
import agentship.platform.web.Actor;
import java.util.Map;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;

@Service
public class RunDashboard {
    private final RunDetailsQuery runs;
    private final ArchiveQueries archives;

    RunDashboard(RunDetailsQuery runs, ArchiveQueries archives) {
        this.runs = runs;
        this.archives = archives;
    }

    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    public Map<String, Object> read(Actor actor, UUID run) {
        var details = runs.detail(actor, run);
        archives.views(run, details.artifacts().keySet()).forEach(
                (artifact, view) -> details.artifacts().get(artifact).put("archive", view));
        return details.body();
    }
}
