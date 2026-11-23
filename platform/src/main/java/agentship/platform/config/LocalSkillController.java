package agentship.platform.config;

import jakarta.servlet.http.HttpServletRequest;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
class LocalSkillController {
    private final LocalSkillCatalog catalog;

    LocalSkillController(LocalSkillCatalog catalog) { this.catalog = catalog; }

    @GetMapping("/api/local-skills")
    LocalSkillCatalog.Catalog list(HttpServletRequest request) {
        // Never treat proxy headers as evidence that a visitor is on this computer.
        String address = request.getRemoteAddr();
        boolean local = "127.0.0.1".equals(address) || "::1".equals(address)
                || "0:0:0:0:0:0:0:1".equals(address);
        return catalog.read(local && request.getHeader("Forwarded") == null
                && request.getHeader("X-Forwarded-For") == null);
    }
}
