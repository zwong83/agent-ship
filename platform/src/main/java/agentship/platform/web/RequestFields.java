package agentship.platform.web;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import java.util.UUID;

public final class RequestFields {
    private RequestFields() {}
    public static String text(JsonNode body,String field,int maximum) {
        JsonNode value=body==null?null:body.get(field);
        if(value==null || !value.isTextual() || value.textValue().isBlank() || value.textValue().length()>maximum || value.textValue().indexOf(0)>=0) throw ApiProblem.invalid();
        return value.textValue();
    }
    public static UUID id(JsonNode body,String field) {
        String value=text(body,field,36);
        try { UUID id=UUID.fromString(value); if(!id.toString().equalsIgnoreCase(value)) throw ApiProblem.invalid(); return id; }
        catch(IllegalArgumentException invalid) { throw ApiProblem.invalid(); }
    }
    public static long number(JsonNode body,String field,long minimum,long maximum) {
        JsonNode value=body==null?null:body.get(field);
        if(value==null || !value.isIntegralNumber() || !value.canConvertToLong() || value.longValue()<minimum || value.longValue()>maximum) throw ApiProblem.invalid();
        return value.longValue();
    }
    public static Instant instant(JsonNode body,String field) {
        try { return Instant.parse(text(body,field,64)); }
        catch(java.time.format.DateTimeParseException invalid) { throw ApiProblem.invalid(); }
    }
    public static String json(ObjectMapper mapper,Object value) {
        try { return mapper.writeValueAsString(value); }
        catch(com.fasterxml.jackson.core.JsonProcessingException failure) { throw new IllegalStateException(failure); }
    }
    public static byte[] digest(ObjectMapper mapper,JsonNode value) {
        try { return MessageDigest.getInstance("SHA-256").digest(mapper.writeValueAsBytes(canonical(value))); }
        catch(java.security.GeneralSecurityException|com.fasterxml.jackson.core.JsonProcessingException failure) { throw new IllegalStateException(failure); }
    }
    private static Object canonical(JsonNode node) {
        if(node.isObject()) { Map<String,Object> values=new TreeMap<>(); node.fields().forEachRemaining(entry->values.put(entry.getKey(),canonical(entry.getValue()))); return values; }
        if(node.isArray()) { List<Object> values=new ArrayList<>(); node.forEach(item->values.add(canonical(item))); return values; }
        return node;
    }
    public static ApiProblem conflict(String code,String message) { return new ApiProblem(409,code,message); }
}
