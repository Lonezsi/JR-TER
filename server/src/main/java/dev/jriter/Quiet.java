package dev.jriter;

import org.apache.catalina.core.StandardHost;
import org.apache.catalina.valves.ErrorReportValve;
import org.springframework.boot.web.embedded.tomcat.TomcatServletWebServerFactory;
import org.springframework.boot.web.server.WebServerFactoryCustomizer;
import org.springframework.stereotype.Component;

/** Tomcat's own error page (a bad URL that never reaches Spring) prints "Apache Tomcat/10.x": it does not now. */
@Component
public class Quiet implements WebServerFactoryCustomizer<TomcatServletWebServerFactory> {
    public static class Valve extends ErrorReportValve {
        public Valve() {
            setShowServerInfo(false);
            setShowReport(false);
        }
    }

    @Override
    public void customize(TomcatServletWebServerFactory factory) {
        factory.addContextCustomizers(ctx -> {
            if (ctx.getParent() instanceof StandardHost h) h.setErrorReportValveClass(Valve.class.getName());
        });
    }
}
