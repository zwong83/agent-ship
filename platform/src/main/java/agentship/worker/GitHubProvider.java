package agentship.worker;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.Map;

/** GitHub REST only: no shell credential handling, redirects or ambient credential files. */
final class GitHubProvider implements GitProvider {
    private static final ObjectMapper JSON=new ObjectMapper();
    private final URI endpoint;
    private final String token;
    private final HttpClient client=HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).followRedirects(HttpClient.Redirect.NEVER).build();
    GitHubProvider(String token) {
        this.token=token;
        String test=System.getProperty("agentship.test.github-api");
        endpoint=URI.create(test==null?"https://api.github.com":test);
        if(test!=null && (!Boolean.getBoolean("agentship.test.allow-fake-github") || !"http".equals(endpoint.getScheme())
                || !"127.0.0.1".equals(endpoint.getHost()) || endpoint.getPort()<1024 || !endpoint.getPath().isEmpty()
                || endpoint.getUserInfo()!=null || endpoint.getQuery()!=null || endpoint.getFragment()!=null)) throw new IllegalArgumentException("Invalid test adapter");
        if(token==null || token.isBlank()) throw new IllegalArgumentException("GitHub token required");
    }
    public Repository findRepository(String name,String requirementId,boolean requireMarker) throws Exception {
        validateName(name);
        JsonNode found=request("GET","/repos/"+name,null,false);
        if(found==null)return null;
        if(!name.equalsIgnoreCase(found.path("full_name").asText()) || found.path("id").asText().isBlank()) throw new Failure("REPOSITORY_CONFLICT",false);
        if(requireMarker && (!found.path("description").asText().equals(marker(requirementId)) || found.path("private").asBoolean(true)))
            throw new Failure("REPOSITORY_CONFLICT",false);
        String branch=found.path("default_branch").asText(); LocalGitProvider.validateBranch(branch);
        return new Repository("github",found.path("id").asText(),found.path("full_name").asText(),branch);
    }
    public void createRepository(String name,String requirementId,WriteGuard guard) throws Exception {
        validateName(name);String[] parts=name.split("/",2);
        JsonNode user=request("GET","/user",null,false);
        if(user==null)throw new Failure("GITHUB_ACCESS_DENIED",false);
        String path;
        if(parts[0].equalsIgnoreCase(user.path("login").asText()))path="/user/repos";
        else {
            JsonNode owner=request("GET","/users/"+parts[0],null,false);
            if(owner==null || !"Organization".equals(owner.path("type").asText()))throw new Failure("GITHUB_NAMESPACE_UNAVAILABLE",false);
            path="/orgs/"+parts[0]+"/repos";
        }
        guard.check();
        request("POST",path,Map.of("name",parts[1],"description",marker(requirementId),"private",false,"auto_init",true),true);
    }
    public String reference(Repository repository,String branch) throws Exception {
        LocalGitProvider.validateBranch(branch);
        verifyIdentity(repository);
        JsonNode ref=request("GET","/repos/"+repository.displayName()+"/git/ref/heads/"+encodedBranch(branch),null,false);
        if(ref==null)return null;
        String commit=ref.path("object").path("sha").asText();
        if(!("refs/heads/"+branch).equals(ref.path("ref").asText()) || !"commit".equals(ref.path("object").path("type").asText())
                || !commit.matches("[0-9a-fA-F]{40,64}"))throw new Failure("INVALID_GIT_EVIDENCE",false);
        return commit.toLowerCase(java.util.Locale.ROOT);
    }
    public void createReference(Repository repository,String branch,String commit,WriteGuard guard) throws Exception {
        LocalGitProvider.validateBranch(branch);
        if(!commit.matches("[0-9a-f]{40,64}"))throw new Failure("INVALID_GIT_EVIDENCE",false);
        verifyIdentity(repository);
        guard.check();
        request("POST","/repos/"+repository.displayName()+"/git/refs",Map.of("ref","refs/heads/"+branch,"sha",commit),true);
    }
    private void verifyIdentity(Repository repository)throws Exception {
        Repository current=findRepository(repository.displayName(),"",false);
        if(current==null || !current.repositoryId().equals(repository.repositoryId()))throw new Failure("REPOSITORY_CONFLICT",false);
    }
    private JsonNode request(String method,String path,Object body,boolean mutation) throws Exception {
        HttpRequest.Builder builder=HttpRequest.newBuilder(endpoint.resolve(path)).timeout(Duration.ofSeconds(10))
                .header("Accept","application/vnd.github+json").header("Authorization","Bearer "+token)
                .header("X-GitHub-Api-Version","2022-11-28").header("User-Agent","AgentShip-Development-Worker");
        if(body==null)builder.GET();else builder.header("Content-Type","application/json").POST(HttpRequest.BodyPublishers.ofByteArray(JSON.writeValueAsBytes(body)));
        try {
            long deadline=System.nanoTime()+java.util.concurrent.TimeUnit.SECONDS.toNanos(10);
            var response=client.send(builder.build(),HttpResponse.BodyHandlers.ofInputStream());
            try(var input=response.body()) {
                byte[] bytes=BoundedHttp.read(input,1_048_576,deadline);
                int status=response.statusCode();
                if(!mutation && status==404)return null;
                if(status<200 || status>=300)throw new Failure(status==401||status==403?"GITHUB_ACCESS_DENIED":"GITHUB_OPERATION_FAILED",mutation && (status>=500 || status==429 || status>=300&&status<400));
                if(bytes.length>1_048_576)throw new Failure("GITHUB_RESPONSE_INVALID",mutation);
                return JSON.readTree(bytes);
            }
        } catch(IOException error) { throw new Failure("GITHUB_RESULT_UNKNOWN",mutation); }
    }
    private static void validateName(String name) throws Failure {
        if(name==null || !name.matches("[A-Za-z0-9][A-Za-z0-9-]{0,38}/[A-Za-z0-9._-]{1,100}") || name.endsWith("/.") || name.endsWith("/.."))
            throw new Failure("INVALID_REPOSITORY",false);
    }
    private static String marker(String requirementId) { return "AgentShip requirement "+requirementId; }
    String fetchUrl(String name) throws Failure {
        validateName(name);
        return ("https".equals(endpoint.getScheme()) ? "https://github.com" : endpoint.toString()) + "/" + name + ".git";
    }
    private static String encodedBranch(String branch) { return URLEncoder.encode(branch,StandardCharsets.UTF_8).replace("+","%20"); }
}
