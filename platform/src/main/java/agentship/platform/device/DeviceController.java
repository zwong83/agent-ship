package agentship.platform.device;

import agentship.platform.web.Actor;
import agentship.platform.web.ApiErrors;
import agentship.platform.web.PlatformOrigin;
import com.fasterxml.jackson.databind.JsonNode;
import jakarta.servlet.http.HttpServletRequest;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
class DeviceController {
    private final DeviceService service;
    DeviceController(DeviceService service) { this.service = service; }

    @GetMapping("/api/devices")
    Map<String,Object> devices(@RequestAttribute("actor") Actor actor) { return service.devices(actor); }

    @PostMapping("/api/devices/pair")
    @ResponseStatus(HttpStatus.CREATED)
    Map<String,Object> pairCode(@RequestAttribute("actor") Actor actor, HttpServletRequest request) {
        return service.pairing(actor,PlatformOrigin.from(request),ApiErrors.requestId(request));
    }

    @PostMapping("/api/devices/challenge")
    @ResponseStatus(HttpStatus.CREATED)
    Map<String,Object> challenge(@RequestAttribute("actor") Actor actor, HttpServletRequest request) {
        return service.challenge(actor,PlatformOrigin.from(request));
    }

    @PostMapping("/api/worker/pair")
    @ResponseStatus(HttpStatus.CREATED)
    Map<String,Object> pair(@RequestBody JsonNode body, HttpServletRequest request) {
        return service.pair(body,PlatformOrigin.from(request),ApiErrors.requestId(request));
    }

}
