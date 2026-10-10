package com.kindergarten.teacherservice.logging;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.slf4j.MDC;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;
import org.springframework.web.servlet.HandlerMapping;

@Component
public class RequestLoggingFilter extends OncePerRequestFilter {
    private static final Logger LOG = LoggerFactory.getLogger(RequestLoggingFilter.class);

    @EventListener(ApplicationReadyEvent.class)
    public void ready() {
        LOG.info("service_started");
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response,
                                  FilterChain chain) throws ServletException, IOException {
        String supplied = request.getHeader("X-Request-ID");
        String id = supplied != null && supplied.matches("[A-Za-z0-9_-]{1,64}")
                ? supplied : UUID.randomUUID().toString();
        response.setHeader("X-Request-ID", id);
        long start = System.nanoTime();
        int status = 0;
        try {
            MDC.put("request_id", id);
            chain.doFilter(request, response);
        } catch (ServletException | IOException | RuntimeException error) {
            status = 500;
            MDC.put("error_type", error.getClass().getSimpleName());
            throw error;
        } finally {
            status = status == 0 ? response.getStatus() : status;
            Object route = request.getAttribute(HandlerMapping.BEST_MATCHING_PATTERN_ATTRIBUTE);
            String pattern = route == null ? "unmatched" : route.toString();
            boolean quiet = status < 400 && (request.getMethod().equals("OPTIONS")
                    || pattern.equals("/health") || pattern.equals("/ready"));
            if (!quiet) {
                MDC.put("method", request.getMethod());
                MDC.put("route", pattern);
                MDC.put("status", Integer.toString(status));
                MDC.put("duration_ms", Double.toString((System.nanoTime() - start) / 1_000_000.0));
                if (status >= 500) LOG.error("http_request");
                else if (status >= 400) LOG.warn("http_request");
                else if (request.getMethod().equals("GET") || request.getMethod().equals("HEAD")) LOG.debug("http_request");
                else LOG.info("http_request");
            }
            MDC.remove("request_id");
            MDC.remove("method");
            MDC.remove("route");
            MDC.remove("status");
            MDC.remove("duration_ms");
            MDC.remove("error_type");
        }
    }
}
