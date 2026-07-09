package creatorflow.model;

import java.time.Instant;

/** A collection of related assets. {@code assetCount} is filled in by repository queries. */
public record Project(long id, String name, String description, Instant createdAt, int assetCount) {
}
