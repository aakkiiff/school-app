package com.kindergarten.teacherservice.logging;

import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.encoder.EncoderBase;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;

public class JsonLogEncoder extends EncoderBase<ILoggingEvent> {
    private final ObjectMapper mapper = new ObjectMapper();

    @Override
    public byte[] encode(ILoggingEvent record) {
        Map<String, Object> fields = new LinkedHashMap<>();
        fields.put("timestamp", Instant.ofEpochMilli(record.getTimeStamp()).toString());
        fields.put("level", record.getLevel().toString());
        fields.put("service", "teacherservice");
        boolean applicationEvent = record.getLoggerName().equals(RequestLoggingFilter.class.getName());
        fields.put("event", applicationEvent ? record.getMessage() : "runtime_event");
        fields.put("logger", record.getLoggerName());
        Map<String, String> context = record.getMDCPropertyMap();
        for (String key : new String[] {"request_id", "method", "route", "error_type"}) {
            if (context.containsKey(key)) fields.put(key, context.get(key));
        }
        if (context.containsKey("status")) fields.put("status", Integer.parseInt(context.get("status")));
        if (context.containsKey("duration_ms")) fields.put("duration_ms", Double.parseDouble(context.get("duration_ms")));
        if (record.getThrowableProxy() != null) {
            fields.put("error_type", record.getThrowableProxy().getClassName());
        }
        String message = "Runtime warning or error; see logger and error_type.";
        if (applicationEvent && record.getMessage().equals("http_request")) {
            int status = (Integer) fields.get("status");
            message = status >= 500 ? "HTTP request failed." : status >= 400
                    ? "HTTP request rejected." : "HTTP request completed.";
        } else if (applicationEvent && record.getMessage().equals("service_started")) {
            message = "Service started.";
        }
        fields.put("message", message);
        try {
            return (mapper.writeValueAsString(fields) + "\n").getBytes(StandardCharsets.UTF_8);
        } catch (JsonProcessingException error) {
            throw new IllegalStateException("Cannot encode log event", error);
        }
    }

    @Override
    public byte[] headerBytes() { return null; }

    @Override
    public byte[] footerBytes() { return null; }
}
