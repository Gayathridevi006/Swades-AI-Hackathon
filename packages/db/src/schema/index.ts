import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const chunks = pgTable("chunks", {
  id: text("id").primaryKey(),
  data: text("data"),
  createdAt: timestamp("created_at").defaultNow()
});