package agentship.platform.web;

import java.util.Map;

public final class ApiProblem extends RuntimeException {
    private final int status;
    private final String code;
    private final Map<String, Object> details;

    public ApiProblem(int status, String code, String message) {
        this(status, code, message, Map.of());
    }

    public ApiProblem(int status, String code, String message, Map<String, Object> details) {
        super(message);
        this.status = status;
        this.code = code;
        this.details = Map.copyOf(details);
    }

    public int status() { return status; }
    public String code() { return code; }
    public Map<String, Object> details() { return details; }

    public static ApiProblem invalid() {
        return new ApiProblem(400, "INVALID_REQUEST", "请检查输入后重试。");
    }

    public static ApiProblem unauthenticated() {
        return new ApiProblem(401, "UNAUTHENTICATED", "请使用有效的账号登录。");
    }
}
