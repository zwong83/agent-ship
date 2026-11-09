package agentship.platform.web;

import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.GetMapping;

@Controller
public class WorkspacePages {
    @GetMapping({"/login", "/register", "/requirements", "/requirements/{id}",
            "/flows", "/flows/{id}", "/agents", "/agents/{id}",
            "/runs", "/runs/new", "/runs/{id}", "/runs/{id}/chat", "/devices"})
    public String workspace() {
        return "forward:/index.html";
    }
}
