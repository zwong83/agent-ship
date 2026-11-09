package agentship.platform.config;

import agentship.platform.web.Actor;
import agentship.platform.web.ApiErrors;
import com.fasterxml.jackson.databind.JsonNode;
import jakarta.servlet.http.HttpServletRequest;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
class ConfigController {
    private final ConfigService service;

    ConfigController(ConfigService service) {
        this.service = service;
    }

    @GetMapping("/api/projects")
    ConfigService.Page<Map<String,Object>> projects(@RequestAttribute("actor") Actor actor,
            @RequestParam(name = "q", required = false) String query,
            @RequestParam(name = "cursor", required = false) String cursor,
            @RequestParam(name = "pageSize", required = false) Integer pageSize) {
        return service.listProjects(actor,query,cursor,pageSize);
    }

    @GetMapping("/api/catalog")
    ConfigService.Page<ConfigService.AgentChoice> catalog(@RequestAttribute("actor") Actor actor,
            @RequestParam(name = "flowId", required = false) UUID flow,
            @RequestParam(name = "q", required = false) String query,
            @RequestParam(name = "cursor", required = false) String cursor,
            @RequestParam(name = "pageSize", required = false) Integer pageSize) {
        return service.catalog(actor,flow,query,cursor,pageSize);
    }

    @GetMapping("/api/objects/{kind}")
    ConfigService.Page<Map<String,Object>> list(@RequestAttribute("actor") Actor actor,
            @PathVariable("kind") String kind,
            @RequestParam(name = "projectId", required = false) UUID project,
            @RequestParam(name = "q", required = false) String query,
            @RequestParam(name = "purpose", defaultValue = "view") String purpose,
            @RequestParam(name = "requirementId", required = false) UUID requirement,
            @RequestParam(name = "cursor", required = false) String cursor,
            @RequestParam(name = "pageSize", required = false) Integer pageSize) {
        return service.list(actor,ConfigService.Kind.fromPath(kind),project,query,purpose,requirement,cursor,pageSize);
    }

    @PostMapping("/api/objects/{kind}")
    @ResponseStatus(HttpStatus.CREATED)
    Map<String,Object> create(@RequestAttribute("actor") Actor actor,
            @PathVariable("kind") String kind, @RequestHeader("Idempotency-Key") String key,
            @RequestBody JsonNode body, HttpServletRequest request) {
        return service.create(actor,ConfigService.Kind.fromPath(kind),key,body,ApiErrors.requestId(request));
    }

    @GetMapping("/api/objects/{kind}/{objectId}")
    Map<String,Object> detail(@RequestAttribute("actor") Actor actor, @PathVariable("kind") String kind,
            @PathVariable("objectId") UUID id) {
        return service.detail(actor,ConfigService.Kind.fromPath(kind),id);
    }

    @PatchMapping("/api/objects/{kind}/{objectId}")
    Map<String,Object> update(@RequestAttribute("actor") Actor actor, @PathVariable("kind") String kind,
            @PathVariable("objectId") UUID id, @RequestHeader("Idempotency-Key") String key,
            @RequestBody JsonNode body, HttpServletRequest request) {
        return service.update(actor,ConfigService.Kind.fromPath(kind),id,key,body,ApiErrors.requestId(request));
    }

    @PostMapping("/api/objects/{kind}/{objectId}/ownership")
    ConfigService.OwnershipReceipt ownership(@RequestAttribute("actor") Actor actor,
            @PathVariable("kind") String kind, @PathVariable("objectId") UUID id,
            @RequestHeader("Idempotency-Key") String key, @RequestBody JsonNode body, HttpServletRequest request) {
        return service.changeOwner(actor,ConfigService.Kind.fromPath(kind),id,key,body,ApiErrors.requestId(request));
    }
}
