package agentship.platform.workbench.transport;

import agentship.platform.web.Actor;
import agentship.platform.workbench.application.RunDashboard;
import java.util.Map;
import java.util.UUID;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RestController;

@RestController
class RunDashboardController {
    private final RunDashboard dashboard;

    RunDashboardController(RunDashboard dashboard) {
        this.dashboard = dashboard;
    }

    @GetMapping("/api/runs/{runId}")
    Map<String, Object> detail(@RequestAttribute("actor") Actor actor, @PathVariable("runId") UUID run) {
        return dashboard.read(actor, run);
    }
}
