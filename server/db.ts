import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { mkdirSync } from "node:fs";
import * as schema from "./schema";
mkdirSync(process.env.DATA_DIR || "data", { recursive: true });
export const sqlite = new Database(
  (process.env.DATA_DIR || "data") + "/prisx.sqlite",
  { create: true },
);
sqlite.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
CREATE TABLE IF NOT EXISTS auth_user(id TEXT PRIMARY KEY,name TEXT NOT NULL,email TEXT NOT NULL UNIQUE,emailVerified INTEGER NOT NULL,image TEXT,createdAt INTEGER NOT NULL,updatedAt INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS auth_session(id TEXT PRIMARY KEY,expiresAt INTEGER NOT NULL,token TEXT NOT NULL UNIQUE,createdAt INTEGER NOT NULL,updatedAt INTEGER NOT NULL,ipAddress TEXT,userAgent TEXT,userId TEXT NOT NULL REFERENCES auth_user(id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS auth_account(id TEXT PRIMARY KEY,accountId TEXT NOT NULL,providerId TEXT NOT NULL,userId TEXT NOT NULL REFERENCES auth_user(id) ON DELETE CASCADE,accessToken TEXT,refreshToken TEXT,idToken TEXT,accessTokenExpiresAt INTEGER,refreshTokenExpiresAt INTEGER,scope TEXT,password TEXT,createdAt INTEGER NOT NULL,updatedAt INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS auth_verification(id TEXT PRIMARY KEY,identifier TEXT NOT NULL,value TEXT NOT NULL,expiresAt INTEGER NOT NULL,createdAt INTEGER,updatedAt INTEGER);
CREATE TABLE IF NOT EXISTS workspaces(id TEXT PRIMARY KEY,name TEXT NOT NULL,createdAt TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS memberships(id TEXT PRIMARY KEY,workspaceId TEXT NOT NULL REFERENCES workspaces(id),userId TEXT NOT NULL REFERENCES auth_user(id),role TEXT NOT NULL,UNIQUE(workspaceId,userId));
CREATE TABLE IF NOT EXISTS entities(id TEXT PRIMARY KEY,workspaceId TEXT NOT NULL REFERENCES workspaces(id),name TEXT NOT NULL,kind TEXT NOT NULL,revision INTEGER NOT NULL,data TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS entity_workspace ON entities(workspaceId);
CREATE TABLE IF NOT EXISTS records(id TEXT PRIMARY KEY,workspaceId TEXT NOT NULL REFERENCES workspaces(id),entityId TEXT REFERENCES entities(id),type TEXT NOT NULL,revision INTEGER NOT NULL,data TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS records_scope ON records(workspaceId,entityId,type);
CREATE TABLE IF NOT EXISTS revisions(id TEXT PRIMARY KEY,workspaceId TEXT NOT NULL REFERENCES workspaces(id),targetId TEXT NOT NULL,type TEXT NOT NULL,data TEXT NOT NULL,createdAt TEXT NOT NULL,createdBy TEXT NOT NULL);
CREATE VIRTUAL TABLE IF NOT EXISTS entity_fts USING fts5(entityId UNINDEXED,workspaceId UNINDEXED,body,tokenize='trigram');
PRAGMA user_version=1;`);
export const db = drizzle(sqlite, { schema });
