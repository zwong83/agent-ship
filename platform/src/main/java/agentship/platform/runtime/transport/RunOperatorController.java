package agentship.platform.runtime.transport;

import agentship.platform.identity.IdentityController;
import agentship.platform.runtime.application.collaboration.RunOperatorService;
import agentship.platform.web.Actor;
import agentship.platform.web.ApiErrors;
import com.fasterxml.jackson.databind.JsonNode;
import jakarta.servlet.http.HttpServletRequest;
import java.util.Map;
import java.util.UUID;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/runs/{runId}")
class RunOperatorController {
    private final RunOperatorService service;

    RunOperatorController(RunOperatorService service) {
        this.service = service;
    }

    @PostMapping("/chat")
    Map<String, Object> lease(@RequestAttribute("actor") Actor actor, @PathVariable("runId") UUID run,
            @RequestBody JsonNode body, HttpServletRequest request) {
        return service.lease(actor, run, body, IdentityController.sessionCookie(request));
    }

    @GetMapping("/chat")
    Map<String, Object> chat(@RequestAttribute("actor") Actor actor, @PathVariable("runId") UUID run,
            @RequestParam("tabId") UUID tab, @RequestParam("epoch") long epoch,
            @RequestHeader("X-Chat-Lease") String proof,
            @RequestParam(name="cursor",required=false) String cursor,
            @RequestParam(name="pageSize",required=false) Integer pageSize, HttpServletRequest request) {
        return service.chat(actor, run, tab, epoch, proof, IdentityController.sessionCookie(request), cursor, pageSize);
    }

    @GetMapping("/repair-control")
    Map<String, Object> targets(@RequestAttribute("actor") Actor actor, @PathVariable("runId") UUID run) {
        return service.targets(actor, run);
    }

    @PostMapping("/actions")
    Map<String, Object> action(@RequestAttribute("actor") Actor actor, @PathVariable("runId") UUID run,
            @RequestBody JsonNode body, @RequestHeader("Idempotency-Key") String key, HttpServletRequest request) {
        return service.action(actor, run, body, key, IdentityController.sessionCookie(request), ApiErrors.requestId(request));
    }

    @GetMapping("/chat/access")
    Map<String, Object> access(@RequestAttribute("actor") Actor actor, @PathVariable("runId") UUID run) {
        return service.access(actor, run);
    }

    @PostMapping("/chat/access")
    Map<String, Object> changeAccess(@RequestAttribute("actor") Actor actor, @PathVariable("runId") UUID run,
            @RequestBody JsonNode body, @RequestHeader("Idempotency-Key") String key, HttpServletRequest request) {
        return service.changeAccess(actor, run, body, key, ApiErrors.requestId(request));
    }
}
