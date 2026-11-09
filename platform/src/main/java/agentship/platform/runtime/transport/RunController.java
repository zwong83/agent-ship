package agentship.platform.runtime.transport;

import agentship.platform.runtime.application.launch.RunService;
import agentship.platform.web.Actor;
import agentship.platform.web.ApiErrors;
import agentship.platform.web.PlatformOrigin;
import com.fasterxml.jackson.databind.JsonNode;
import jakarta.servlet.http.HttpServletRequest;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;

@RestController
class RunController {
    private final RunService service;
    RunController(RunService service) { this.service = service; }

    @PostMapping("/api/runs")
    @ResponseStatus(HttpStatus.CREATED)
    Map<String,Object> start(@RequestAttribute("actor") Actor actor, @RequestBody JsonNode body,
            @RequestHeader("Idempotency-Key") String key, HttpServletRequest request) {
        return service.start(actor, body, key, PlatformOrigin.from(request), ApiErrors.requestId(request));
    }

    @GetMapping("/api/runs")
    Map<String,Object> list(@RequestAttribute("actor") Actor actor,
            @RequestParam(name="projectId",required=false) UUID project,
            @RequestParam(name="q",required=false) String query,
            @RequestParam(name="cursor",required=false) String cursor,
            @RequestParam(name="pageSize",required=false) Integer pageSize) {
        return service.list(actor,project,query,cursor,pageSize);
    }

    @GetMapping("/api/runs/{runId}/events")
    Map<String,Object> events(@RequestAttribute("actor") Actor actor, @PathVariable("runId") UUID id,
            @RequestParam(name="cursor",required=false) String cursor,
            @RequestParam(name="pageSize",required=false) Integer size) {
        return service.events(actor,id,cursor,size);
    }
}
