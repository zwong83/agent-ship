package agentship.platform.runtime.transport;

import agentship.platform.runtime.application.execution.WorkerJobService;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.Map;
import java.util.UUID;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RestController;

@RestController
class WorkerJobController {
    private final WorkerJobService service;
    WorkerJobController(WorkerJobService service) { this.service=service; }

    @PostMapping("/api/worker/poll")
    Map<String,Object> poll(@RequestHeader(name="Authorization",required=false) String authorization,
                           @RequestBody JsonNode body) {
        return service.poll(authorization,body);
    }

    @PostMapping("/api/worker/jobs/{taskId}/authorize-external")
    Map<String,Object> authorize(@PathVariable("taskId") UUID task,
            @RequestHeader(name="Authorization",required=false) String authorization,
            @RequestHeader("Idempotency-Key") String key,@RequestBody JsonNode body) {
        return service.authorize(authorization,task,key,body);
    }
    @PostMapping("/api/worker/jobs/{taskId}/event")
    Map<String,Object> event(@PathVariable("taskId") UUID task,
            @RequestHeader(name="Authorization",required=false) String authorization,
            @RequestHeader("Idempotency-Key") String key,@RequestBody JsonNode body) {
        return service.event(authorization,task,key,body);
    }
}
