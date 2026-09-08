import { mkdir, open, link, lstat, realpath, unlink } from "node:fs/promises";
import { constants } from "node:fs";
import { resolve, join } from "node:path";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
export interface ObjectStore {
  put(id: string, bytes: Uint8Array): Promise<void>;
  get(id: string): Promise<Uint8Array>;
  head(id: string): Promise<number>;
  delete(id: string): Promise<void>;
}
export class FileStorage implements ObjectStore {
  constructor(readonly root: string) {}
  async path(id: string) {
    if (!/^[a-zA-Z0-9-]+$/.test(id)) throw new Error("Invalid object ID");
    await mkdir(this.root, { recursive: true });
    const root = resolve(this.root);
    if ((await realpath(root)) !== root)
      throw new Error("Symlink root forbidden");
    const path = join(root, id);
    try {
      if ((await lstat(path)).isSymbolicLink())
        throw new Error("Symlink forbidden");
    } catch (e: any) {
      if (e.code !== "ENOENT") throw e;
    }
    return path;
  }
  async put(id: string, bytes: Uint8Array) {
    const path = await this.path(id);
    const tmp = await this.path(crypto.randomUUID());
    const f = await open(tmp, "wx", 0o600);
    try {
      await f.writeFile(bytes);
      await f.sync();
    } finally {
      await f.close();
    }
    try {
      await link(tmp, path);
      const dir = await open(resolve(this.root), "r");
      try {
        await dir.sync();
      } finally {
        await dir.close();
      }
    } finally {
      await unlink(tmp);
    }
  }
  async get(id: string) {
    const f = await open(
      await this.path(id),
      constants.O_RDONLY | constants.O_NOFOLLOW,
    );
    try {
      return new Uint8Array(await f.readFile());
    } finally {
      await f.close();
    }
  }
  async head(id: string) {
    const f = await open(
      await this.path(id),
      constants.O_RDONLY | constants.O_NOFOLLOW,
    );
    try {
      return (await f.stat()).size;
    } finally {
      await f.close();
    }
  }
  async delete(id: string) {
    await unlink(await this.path(id));
  }
}
export class S3Compat implements ObjectStore {
  client: S3Client;
  constructor(
    readonly config: {
      endpoint: string;
      region: string;
      bucket: string;
      prefix: string;
      forcePathStyle: boolean;
      credentials: { accessKeyId: string; secretAccessKey: string };
    },
  ) {
    this.client = new S3Client(config);
  }
  key(id: string) {
    if (!/^[a-zA-Z0-9-]+$/.test(id)) throw new Error("Invalid object ID");
    return this.config.prefix + id;
  }
  async put(id: string, bytes: Uint8Array) {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.config.bucket,
        Key: this.key(id),
        Body: bytes,
        IfNoneMatch: "*",
      }),
    );
    const saved = await this.get(id);
    if (
      new Bun.CryptoHasher("sha256").update(saved).digest("hex") !==
      new Bun.CryptoHasher("sha256").update(bytes).digest("hex")
    )
      throw new Error("Checksum mismatch");
  }
  async get(id: string) {
    const r = await this.client.send(
      new GetObjectCommand({ Bucket: this.config.bucket, Key: this.key(id) }),
    );
    if (!r.Body) throw new Error("not-found");
    return r.Body.transformToByteArray();
  }
  async head(id: string) {
    return (
      (
        await this.client.send(
          new HeadObjectCommand({
            Bucket: this.config.bucket,
            Key: this.key(id),
          }),
        )
      ).ContentLength || 0
    );
  }
  async delete(id: string) {
    await this.client.send(
      new DeleteObjectCommand({
        Bucket: this.config.bucket,
        Key: this.key(id),
      }),
    );
  }
}
export function objectStore(): ObjectStore {
  return process.env.OBJECT_STORAGE === "s3"
    ? new S3Compat({
        endpoint: process.env.S3_ENDPOINT!,
        region: process.env.S3_REGION || "auto",
        bucket: process.env.S3_BUCKET!,
        prefix: process.env.S3_PREFIX || "prisx/",
        forcePathStyle: process.env.S3_PATH_STYLE !== "false",
        credentials: {
          accessKeyId: process.env.S3_ACCESS_KEY_ID!,
          secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
        },
      })
    : new FileStorage(resolve(process.env.DATA_DIR || "data", "objects"));
}
