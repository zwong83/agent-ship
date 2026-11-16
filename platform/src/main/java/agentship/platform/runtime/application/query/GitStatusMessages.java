package agentship.platform.runtime.application.query;

public final class GitStatusMessages {
    private GitStatusMessages() {}

    public static String message(String code) {
        return switch(code) {
            case "AGENT_EXECUTION_PENDING"->"The warehouse and branches are ready, waiting to initiate the computer to receive the Agent task";
            case "GIT_OUTCOME_UNKNOWN"->"The result of the Git operation is temporarily uncertain and is waiting for read-only verification by the computer; the write operation will not be initiated repeatedly.";
            case "GIT_TARGET_CONFLICT","GIT_EVIDENCE_MISMATCH"->"The warehouse or branch is inconsistent with expectations and requires manual confirmation.";
            case "GIT_AUTH_REQUIRED","GIT_PERMISSION_DENIED"->"The GitHub credentials or warehouse permissions of the initiating computer need to be checked";
            case "EXTERNAL_GRANT_REQUIRED"->"The Git operation authorization has expired or the person in charge has changed and needs to be reconfirmed.";
            case "GIT_PROVIDER_UNAVAILABLE"->"The Git service is temporarily unavailable. You need to check the network or service status.";
            case "GIT_REPOSITORY_EMPTY"->"There is no initial submission available in the warehouse, and the initial content needs to be supplemented first.";
            case "GIT_NAMESPACE_UNAVAILABLE"->"The GitHub user or organization filled in is not available, need to check name and permissions";
            case "GIT_BASE_BRANCH_UNAVAILABLE"->"Unable to confirm the base branch, you need to check the default branch and dev branch of the warehouse";
            case "GIT_PREPARATION_FAILED"->"Git preparation failed, need to check and process";
            default->"Waiting for the initiating computer to perform Git preparation tasks";
        };
    }
}
