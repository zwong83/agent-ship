package agentship.worker;

import java.io.IOException;
import java.io.InputStream;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

final class BoundedHttp {
    private BoundedHttp() {}
    static byte[] read(InputStream input,int maximum,long deadlineNanos)throws IOException {
        try(var reader=Executors.newVirtualThreadPerTaskExecutor()) {
            var future=reader.submit(()->input.readNBytes(maximum+1));
            try {
                long remaining=deadlineNanos-System.nanoTime();
                if(remaining<=0)throw new java.util.concurrent.TimeoutException();
                byte[] result=future.get(remaining,TimeUnit.NANOSECONDS);
                if(result.length>maximum)throw new IOException("Response exceeds limit");
                return result;
            }catch(Exception failure) {
                input.close();future.cancel(true);
                throw new IOException("Response body unavailable");
            }
        }
    }
}
