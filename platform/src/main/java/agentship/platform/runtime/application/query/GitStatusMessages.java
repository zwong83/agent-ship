package agentship.platform.runtime.application.query;

public final class GitStatusMessages {
    private GitStatusMessages() {}

    public static String message(String code) {
        return switch(code) {
            case "AGENT_EXECUTION_PENDING"->"仓库与分支已就绪，等待发起电脑领取 Agent 任务";
            case "GIT_OUTCOME_UNKNOWN"->"Git 操作结果暂不确定，正在等待电脑只读核对；不会重复发起写操作";
            case "GIT_TARGET_CONFLICT","GIT_EVIDENCE_MISMATCH"->"仓库或分支与预期不一致，需要人工确认";
            case "GIT_AUTH_REQUIRED","GIT_PERMISSION_DENIED"->"发起电脑的 GitHub 凭证或仓库权限需要检查";
            case "EXTERNAL_GRANT_REQUIRED"->"Git 操作授权已过期或主负责人已变更，需要重新确认";
            case "GIT_PROVIDER_UNAVAILABLE"->"Git 服务暂不可用，需要检查网络或服务状态";
            case "GIT_REPOSITORY_EMPTY"->"仓库没有可用的初始提交，需要先补充初始内容";
            case "GIT_NAMESPACE_UNAVAILABLE"->"填写的 GitHub 用户或组织不可用，需要检查名称和权限";
            case "GIT_BASE_BRANCH_UNAVAILABLE"->"无法确认基础分支，需要检查仓库的默认分支与 dev 分支";
            case "GIT_PREPARATION_FAILED"->"Git 准备失败，需要检查后处理";
            default->"等待发起电脑执行 Git 准备任务";
        };
    }
}
