import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  file,
  s3,
  sqlite,
  type ObjectStore,
  type PrisxConfig,
  type RelationalAdaptor,
} from "./adapters";
export { defineConfig } from "./adapters";
export type { PrisxConfig } from "./adapters";
export interface ResolvedConfig {
  host: string;
  port: number;
  appUrl: string;
  authSecret?: string;
  maxUploadBytes: number;
  relationalAdaptor: RelationalAdaptor;
  objectAdaptor: ObjectStore;
}
async function loadUserConfig(): Promise<PrisxConfig | undefined> {
  const explicit = process.env.PRISX_CONFIG;
  const candidates = explicit
    ? [resolve(explicit)]
    : [
        resolve("prisx.config.ts"),
        resolve("prisx.config.mts"),
        resolve("prisx.config.js"),
      ];
  for (const candidate of candidates) {
    if (await Bun.file(candidate).exists()) {
      const mod = await import(pathToFileURL(candidate).href);
      return (mod.default ?? mod) as PrisxConfig;
    }
  }
}
function envObjectStore(): ObjectStore {
  return process.env.OBJECT_STORAGE === "s3"
    ? s3({
        endpoint: process.env.S3_ENDPOINT!,
        region: process.env.S3_REGION || "auto",
        bucket: process.env.S3_BUCKET!,
        prefix: process.env.S3_PREFIX || "prisx/",
        forcePathStyle: process.env.S3_PATH_STYLE !== "false",
        accessKeyId: process.env.S3_ACCESS_KEY_ID!,
        secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
      })
    : file({ dir: (process.env.DATA_DIR || "data") + "/objects" });
}
const user = await loadUserConfig();
export const config: ResolvedConfig = {
  host: user?.host ?? process.env.HOST ?? "127.0.0.1",
  port: user?.port ?? Number(process.env.PORT || 3100),
  appUrl: user?.appUrl ?? process.env.APP_URL ?? "",
  authSecret: user?.authSecret ?? process.env.BETTER_AUTH_SECRET,
  maxUploadBytes:
    user?.maxUploadBytes ?? Number(process.env.MAX_UPLOAD_BYTES || 104857600),
  relationalAdaptor:
    user?.relationalAdaptor ??
    sqlite({ path: (process.env.DATA_DIR || "data") + "/prisx.sqlite" }),
  objectAdaptor: user?.objectAdaptor ?? envObjectStore(),
};
config.appUrl ||= `http://localhost:${config.port}`;