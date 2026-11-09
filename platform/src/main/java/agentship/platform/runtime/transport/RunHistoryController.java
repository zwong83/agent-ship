package agentship.platform.runtime.transport;

import agentship.platform.runtime.application.query.RunAttemptHistory;
import agentship.platform.web.Actor;
import java.util.Map;
import java.util.UUID;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
class RunHistoryController {
    private final RunAttemptHistory history;

    RunHistoryController(RunAttemptHistory history) { this.history = history; }

    @GetMapping("/api/runs/{runId}/attempts")
    Map<String, Object> attempts(@RequestAttribute("actor") Actor actor, @PathVariable("runId") UUID run,
            @RequestParam(name="nodeId",required=false) UUID node, @RequestParam(name="taskId",required=false) UUID task,
            @RequestParam(name="cursor",required=false) String cursor, @RequestParam(name="pageSize",required=false) Integer pageSize) {
        return history.read(actor, run, node, task, cursor, pageSize);
    }

    @GetMapping("/api/runs/{runId}/artifacts")
    Map<String, Object> artifacts(@RequestAttribute("actor") Actor actor, @PathVariable("runId") UUID run,
            @RequestParam(name="cursor",required=false) String cursor, @RequestParam(name="pageSize",required=false) Integer pageSize) {
        return history.readArtifacts(actor, run, cursor, pageSize);
    }

    @GetMapping("/api/runs/{runId}/artifacts/{artifactId}")
    Map<String, Object> artifact(@RequestAttribute("actor") Actor actor, @PathVariable("runId") UUID run,
            @PathVariable("artifactId") UUID artifact) {
        return history.readArtifact(actor, run, artifact);
    }
}
