import {
  sqliteTable,
  text,
  integer,
  index,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
export const user = sqliteTable("auth_user", {
  id: text().primaryKey(),
  name: text().notNull(),
  email: text().notNull().unique(),
  emailVerified: integer({ mode: "boolean" }).notNull(),
  image: text(),
  createdAt: integer({ mode: "timestamp" }).notNull(),
  updatedAt: integer({ mode: "timestamp" }).notNull(),
});
export const session = sqliteTable("auth_session", {
  id: text().primaryKey(),
  expiresAt: integer({ mode: "timestamp" }).notNull(),
  token: text().notNull().unique(),
  createdAt: integer({ mode: "timestamp" }).notNull(),
  updatedAt: integer({ mode: "timestamp" }).notNull(),
  ipAddress: text(),
  userAgent: text(),
  userId: text()
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
});
export const account = sqliteTable("auth_account", {
  id: text().primaryKey(),
  accountId: text().notNull(),
  providerId: text().notNull(),
  userId: text()
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accessToken: text(),
  refreshToken: text(),
  idToken: text(),
  accessTokenExpiresAt: integer({ mode: "timestamp" }),
  refreshTokenExpiresAt: integer({ mode: "timestamp" }),
  scope: text(),
  password: text(),
  createdAt: integer({ mode: "timestamp" }).notNull(),
  updatedAt: integer({ mode: "timestamp" }).notNull(),
});
export const verification = sqliteTable("auth_verification", {
  id: text().primaryKey(),
  identifier: text().notNull(),
  value: text().notNull(),
  expiresAt: integer({ mode: "timestamp" }).notNull(),
  createdAt: integer({ mode: "timestamp" }),
  updatedAt: integer({ mode: "timestamp" }),
});
export const workspaces = sqliteTable("workspaces", {
  id: text().primaryKey(),
  name: text().notNull(),
  createdAt: text().notNull(),
});
export const memberships = sqliteTable("memberships", {
  id: text().primaryKey(),
  workspaceId: text()
    .notNull()
    .references(() => workspaces.id),
  userId: text()
    .notNull()
    .references(() => user.id),
  role: text().notNull(),
});
export const entities = sqliteTable(
  "entities",
  {
    id: text().primaryKey(),
    workspaceId: text()
      .notNull()
      .references(() => workspaces.id),
    name: text().notNull(),
    kind: text().notNull(),
    revision: integer().notNull(),
    data: text({ mode: "json" }).notNull(),
  },
  (t) => [index("entity_workspace").on(t.workspaceId)],
);
export const records = sqliteTable(
  "records",
  {
    id: text().primaryKey(),
    workspaceId: text()
      .notNull()
      .references(() => workspaces.id),
    entityId: text().references(() => entities.id),
    type: text().notNull(),
    revision: integer().notNull(),
    data: text({ mode: "json" }).notNull(),
  },
  (t) => [index("records_scope").on(t.workspaceId, t.entityId, t.type)],
);
export const revisions = sqliteTable("revisions", {
  id: text().primaryKey(),
  workspaceId: text()
    .notNull()
    .references(() => workspaces.id),
  targetId: text().notNull(),
  type: text().notNull(),
  data: text({ mode: "json" }).notNull(),
  createdAt: text().notNull(),
  createdBy: text().notNull(),
});
