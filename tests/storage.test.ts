import { test, expect } from "bun:test";
import { mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileStorage } from "../server/storage";
test("file-storage は不変オブジェクトとルート境界を守る", async () => {
  const root = await mkdtemp(join(tmpdir(), "prisx-storage-"));
  try {
    const storage = new FileStorage(root),
      bytes = new TextEncoder().encode("original");
    await storage.put("object-1", bytes);
    expect(new TextDecoder().decode(await storage.get("object-1"))).toBe(
      "original",
    );
    await expect(
      storage.put("object-1", new TextEncoder().encode("overwritten")),
    ).rejects.toThrow();
    expect(new TextDecoder().decode(await storage.get("object-1"))).toBe(
      "original",
    );
    await expect(storage.get("../outside")).rejects.toThrow();
    await symlink("/etc/passwd", join(root, "symlink"));
    await expect(storage.get("symlink")).rejects.toThrow();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
