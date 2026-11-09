package agentship.platform;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableScheduling;

@SpringBootApplication
@EnableScheduling
public class PlatformApplication {
    public static void main(String[] args) {
        if (args.length > 0 && args[0].equals("--worker")) {
            agentship.worker.WorkerMain.main(args);
            return;
        }
        SpringApplication.run(PlatformApplication.class, args);
    }
}
