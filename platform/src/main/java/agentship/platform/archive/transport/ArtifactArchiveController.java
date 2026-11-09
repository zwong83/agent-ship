package agentship.platform.archive.transport;

import agentship.platform.archive.application.ArtifactArchiveService;
import agentship.platform.web.Actor;
import agentship.platform.web.ApiErrors;
import com.fasterxml.jackson.databind.JsonNode;
import jakarta.servlet.http.HttpServletRequest;
import java.util.Map;
import java.util.UUID;
import org.springframework.web.bind.annotation.*;

@RestController
class ArtifactArchiveController {
    private final ArtifactArchiveService archives;

    ArtifactArchiveController(ArtifactArchiveService archives) {
        this.archives = archives;
    }

    @PostMapping("/api/runs/{runId}/archives")
    Map<String,Object> approve(@RequestAttribute("actor") Actor actor, @PathVariable("runId") UUID run,
            @RequestBody JsonNode body, HttpServletRequest request) {
        return archives.approve(actor, run, body, ApiErrors.requestId(request));
    }

    @PostMapping("/api/worker/archive/poll")
    Map<String,Object> poll(@RequestHeader("Authorization") String authorization) {
        return archives.poll(authorization);
    }

    @PostMapping("/api/worker/archive/authorize")
    Map<String,Object> authorize(@RequestHeader("Authorization") String authorization, @RequestBody JsonNode body) {
        return archives.authorize(authorization, body);
    }

    @PostMapping("/api/worker/archive/result")
    Map<String,Object> result(@RequestHeader("Authorization") String authorization, @RequestBody JsonNode body) {
        return archives.result(authorization, body);
    }
}
