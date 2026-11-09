package agentship.platform.web;

import jakarta.servlet.http.HttpServletRequest;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataAccessResourceFailureException;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.ServletRequestBindingException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;
import org.springframework.web.servlet.resource.NoResourceFoundException;

@RestControllerAdvice
public class ApiErrors {
    @ExceptionHandler(ApiProblem.class)
    public ResponseEntity<Map<String, Object>> failure(ApiProblem problem, HttpServletRequest request) {
        var response = ResponseEntity.status(problem.status()).header(HttpHeaders.CACHE_CONTROL, "no-store");
        if (problem.details().get("retryAfterSeconds") instanceof Number seconds) {
            response.header(HttpHeaders.RETRY_AFTER, seconds.toString());
        }
        return response.body(body(problem, request));
    }

    @ExceptionHandler({HttpMessageNotReadableException.class, ServletRequestBindingException.class,
            MethodArgumentTypeMismatchException.class})
    public ResponseEntity<Map<String, Object>> invalid(Exception ignored, HttpServletRequest request) {
        return failure(ApiProblem.invalid(), request);
    }

    @ExceptionHandler(NoResourceFoundException.class)
    public ResponseEntity<Map<String, Object>> notFound(Exception ignored, HttpServletRequest request) {
        return failure(new ApiProblem(404, "NOT_FOUND", "未找到所请求的内容。"), request);
    }

    @ExceptionHandler(DataAccessResourceFailureException.class)
    public ResponseEntity<Map<String, Object>> unavailable(Exception ignored, HttpServletRequest request) {
        return failure(new ApiProblem(503, "TEMPORARILY_UNAVAILABLE", "平台暂不可用，请稍后重试。"), request);
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<Map<String, Object>> unexpected(Exception exception, HttpServletRequest request) {
        LoggerFactory.getLogger(ApiErrors.class).error("Request {} failed ({})",
                requestId(request), exception.getClass().getSimpleName());
        return failure(new ApiProblem(500, "INTERNAL_ERROR", "请求暂时无法完成。"), request);
    }

    public static String requestId(HttpServletRequest request) {
        if (request.getAttribute("requestId") instanceof String id) {
            return id;
        }
        String id = UUID.randomUUID().toString();
        request.setAttribute("requestId", id);
        return id;
    }

    public static Map<String, Object> body(ApiProblem problem, HttpServletRequest request) {
        Map<String, Object> error = new LinkedHashMap<>();
        error.put("code", problem.code());
        error.put("message", problem.getMessage());
        error.put("requestId", requestId(request));
        error.put("retryable", problem.status() == 429 || problem.status() == 503);
        if (!problem.details().isEmpty()) error.put("details", problem.details());
        return Map.of("error", error);
    }
}
