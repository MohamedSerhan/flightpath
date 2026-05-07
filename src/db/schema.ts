import { sqliteTable, integer, text, uniqueIndex, index } from "drizzle-orm/sqlite-core";

export const listings = sqliteTable(
  "listings",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    sourceId: text("source_id").notNull(),
    externalId: text("external_id").notNull(),
    title: text("title").notNull(),
    rawTitle: text("raw_title").notNull(),
    employer: text("employer"),
    location: text("location"),
    state: text("state"),
    url: text("url").notNull(),
    description: text("description"),
    postedAt: integer("posted_at").notNull(),
    fetchedAt: integer("fetched_at").notNull(),
    jobCategory: text("job_category"),
    hoursRequired: integer("hours_required"),
    ratingsRequired: text("ratings_required"),
  },
  (t) => ({
    sourceUnique: uniqueIndex("listings_source_external_uq").on(t.sourceId, t.externalId),
    postedIdx: index("listings_posted_idx").on(t.postedAt),
    categoryIdx: index("listings_category_idx").on(t.jobCategory),
    stateIdx: index("listings_state_idx").on(t.state),
  }),
);

export const sources = sqliteTable("sources", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  lastRunAt: integer("last_run_at"),
  lastSuccessAt: integer("last_success_at"),
  lastCount: integer("last_count"),
  lastError: text("last_error"),
});

export type ListingRow = typeof listings.$inferSelect;
export type ListingInsert = typeof listings.$inferInsert;
export type SourceRow = typeof sources.$inferSelect;
