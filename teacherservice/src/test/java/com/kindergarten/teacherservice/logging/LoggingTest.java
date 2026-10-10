package com.kindergarten.teacherservice.logging;

import ch.qos.logback.classic.Level;
import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.LoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.slf4j.LoggerFactory;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.web.servlet.HandlerMapping;

import static org.junit.jupiter.api.Assertions.*;

class LoggingTest {
    private final ObjectMapper mapper = new ObjectMapper();
    private final JsonLogEncoder encoder = new JsonLogEncoder();

    @Test
    void encodesJsonWithoutFrameworkMessagesOrExceptionDetails() throws Exception {
        LoggingEvent record = new LoggingEvent();
        record.setLoggerName("org.mongodb.driver");
        record.setLevel(Level.ERROR);
        record.setMessage("mongodb://user:password@server\nprivate name");
        record.setTimeStamp(System.currentTimeMillis());
        record.setMDCPropertyMap(Map.of());
        String line = new String(encoder.encode(record), StandardCharsets.UTF_8);
        JsonNode json = mapper.readTree(line);
        assertEquals("teacherservice", json.get("service").asText());
        assertEquals("runtime_event", json.get("event").asText());
        assertFalse(line.contains("password"));
        assertEquals(2, line.split("\n", -1).length);
    }

    @Test
    void summarizesRequestsWithoutQueryOrRecordIdsAndSkipsPreflight() throws Exception {
        Logger logger = (Logger) LoggerFactory.getLogger(RequestLoggingFilter.class);
        Level original = logger.getLevel();
        ListAppender<ch.qos.logback.classic.spi.ILoggingEvent> appender = new ListAppender<>();
        appender.start();
        logger.setLevel(Level.INFO);
        logger.addAppender(appender);
        try {
            RequestLoggingFilter filter = new RequestLoggingFilter();
            MockHttpServletRequest request = new MockHttpServletRequest("GET", "/teachers/private-name");
            request.setQueryString("token=password");
            request.addHeader("X-Request-ID", "request-123");
            MockHttpServletResponse response = new MockHttpServletResponse();
            filter.doFilter(request, response, (req, res) -> {
                req.setAttribute(HandlerMapping.BEST_MATCHING_PATTERN_ATTRIBUTE, "/teachers/{id}");
                ((MockHttpServletResponse) res).setStatus(500);
            });
            assertEquals("request-123", response.getHeader("X-Request-ID"));
            assertEquals(1, appender.list.size());
            JsonNode json = mapper.readTree(encoder.encode(appender.list.get(0)));
            assertEquals("/teachers/{id}", json.get("route").asText());
            assertEquals("ERROR", json.get("level").asText());
            assertEquals(500, json.get("status").asInt());
            assertEquals("HTTP request failed.", json.get("message").asText());
            assertTrue(json.get("duration_ms").asDouble() >= 0);
            assertFalse(json.toString().contains("password"));
            filter.doFilter(new MockHttpServletRequest("OPTIONS", "/teachers"),
                    new MockHttpServletResponse(), (req, res) -> {});
            for (int i = 0; i < 10; i++) {
                filter.doFilter(new MockHttpServletRequest("GET", "/teachers"),
                        new MockHttpServletResponse(), (req, res) -> {});
            }
            assertEquals(1, appender.list.size());
            assertNull(org.slf4j.MDC.get("request_id"));
        } finally {
            logger.detachAppender(appender);
            logger.setLevel(original);
            appender.stop();
        }
    }
}
