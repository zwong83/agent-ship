package agentship.platform.catalog.api;

import java.util.UUID;

public interface RequirementEdits {
    record Content(String title, String nameKey, String description) {}

    /** Updates the requirement and its configuration version under the existing requirement lock. */
    void revise(UUID requirement, Content content);
}
