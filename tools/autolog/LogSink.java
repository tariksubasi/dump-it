package ulug;

import com.mendix.core.Core;
import com.mendix.logging.ILogNode;
import com.mendix.systemwideinterfaces.core.IContext;
import communitycommons.proxies.LogLevel;
import java.util.Collections;
import java.util.Set;

public final class LogSink {
    public static String currentMicroflow(IContext context) {
        try {
            var stack = context.getActionStack();
            if (stack.isEmpty()) return "<unknown>";
            return stack.peek().getActionName();
        } catch (Exception e) {
            return "<unknown>";
        }
    }

    public static Set<String> allowedAttributes() {
        return Collections.emptySet();
    }

    public static void dispatch(ILogNode log, LogLevel level, String node, String message) {
        try {
            if (level == LogLevel.Trace) {
                log.trace(message);
            } else if (level == LogLevel.Debug) {
                log.debug(message);
            } else if (level == LogLevel.Info) {
                log.info(message);
            } else if (level == LogLevel.Warning) {
                log.warn(message);
            } else if (level == LogLevel.Error) {
                log.error(message);
            } else {
                log.info(message);
            }
        } catch (Throwable ignored) {}
    }
}
