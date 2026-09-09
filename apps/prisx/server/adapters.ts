import { mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { Database } from "bun:sqlite";
import { drizzle, type BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import * as schema from "./schema";
import { FileStorage, S3Compat, type ObjectStore } from "./storage";
export type { ObjectStore };
export interface PrisxConfig {
  host?: string;
  port?: number;
  appUrl?: string;
  authSecret?: string;
  maxUploadBytes?: number;
  relationalAdaptor?: RelationalAdaptor;
  objectAdaptor?: ObjectStore;
}
export function defineConfig(config: PrisxConfig): PrisxConfig {
  return config;
}
export interface RelationalAdaptor {
  sqlite: Database;
  db: BunSQLiteDatabase<typeof schema>;
  dataDir: string;
}
export function sqlite(options: { path?: string } = {}): RelationalAdaptor {
  const path = resolve(options.path ?? "data/prisx.sqlite");
  mkdirSync(dirname(path), { recursive: true });
  const database = new Database(path, { create: true });
  return {
    sqlite: database,
    db: drizzle(database, { schema }),
    dataDir: dirname(path),
  };
}
export function file(options: { dir: string }): ObjectStore {
  return new FileStorage(resolve(options.dir));
}
export function s3(options: {
  endpoint: string;
  region?: string;
  bucket: string;
  prefix?: string;
  forcePathStyle?: boolean;
  accessKeyId: string;
  secretAccessKey: string;
}): ObjectStore {
  return new S3Compat({
    endpoint: options.endpoint,
    region: options.region || "auto",
    bucket: options.bucket,
    prefix: options.prefix || "prisx/",
    forcePathStyle: options.forcePathStyle !== false,
    credentials: {
      accessKeyId: options.accessKeyId,
      secretAccessKey: options.secretAccessKey,
    },
  });
}