package creatorflow.db;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.List;

final class SqlJson {

    private static final ObjectMapper JSON = new ObjectMapper();
    private static final TypeReference<List<String>> STRING_LIST = new TypeReference<>() { };

    private SqlJson() {
    }

    static String strings(List<String> values) {
        try {
            return JSON.writeValueAsString(values == null ? List.of() : values);
        } catch (JsonProcessingException e) {
            throw new IllegalArgumentException("Could not serialize string list", e);
        }
    }

    static List<String> strings(String value) {
        if (value == null || value.isBlank()) return List.of();
        try {
            return List.copyOf(JSON.readValue(value, STRING_LIST));
        } catch (JsonProcessingException e) {
            throw new IllegalStateException("Stored JSON is invalid", e);
        }
    }
}
