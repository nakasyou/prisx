import { db, sqlite } from "./db";
import { entities, records, revisions } from "./schema";
import { eq } from "drizzle-orm";
import { ApiError, type Repository } from "./repository";
import { validateValue, refs, contentFingerprint } from "../src/domain";
import type { ObjectStore } from "./storage";
export async function importArchive(
  repo: Repository,
  store: ObjectStore,
  a: any,
) {
  if (
    a?.format !== "prisx" ||
    a.version !== 1 ||
    !Array.isArray(a.entities) ||
    !Array.isArray(a.records) ||
    !Array.isArray(a.history) ||
    !a.objects ||
    typeof a.objects !== "object"
  )
    throw new ApiError(422, "アーカイブ形式が不正");
  if (
    repo.records().length ||
    repo
      .list()
      .some(
        (e) =>
          e.kind === "item" ||
          e.kind === "tag" ||
          (e.kind === "property" && !e.name.startsWith("core:")),
      )
  )
    throw new ApiError(409, "空のワークスペースにインポートしてください");
  const safeId = (x: unknown) =>
    typeof x === "string" && /^[a-zA-Z0-9-]+$/.test(x);
  const ids = new Set<string>();
  for (const e of a.entities) {
    if (
      !safeId(e.id) ||
      ids.has(e.id) ||
      typeof e.name !== "string" ||
      !["item", "tag", "property", "class"].includes(e.kind) ||
      !Number.isInteger(e.revision) ||
      e.revision < 1
    )
      throw new ApiError(422, "エンティティが不正");
    ids.add(e.id);
    if (db.select().from(entities).where(eq(entities.id, e.id)).get())
      throw new ApiError(
        409,
        "同じ ID が存在します。空の保存先へインポートしてください",
      );
  }
  const recIds = new Set<string>();
  for (const r of a.records) {
    if (!safeId(r.id) || recIds.has(r.id))
      throw new ApiError(422, "レコード ID が不正");
    recIds.add(r.id);
    if (db.select().from(records).where(eq(records.id, r.id)).get())
      throw new ApiError(409, "レコード ID が競合");
  }
  const statementIds = new Set(
    a.records
      .filter((r: any) => r.subjectId && r.propertyId)
      .map((r: any) => r.id),
  );
  for (const r of a.records) {
    if (r.subjectId && r.propertyId) {
      if (
        !ids.has(r.subjectId) ||
        !ids.has(r.propertyId) ||
        validateValue(r.value).length ||
        !Array.isArray(r.qualifiers) ||
        refs(r.value).some((x) => !ids.has(x.id))
      )
        throw new ApiError(422, "主張の参照・値が不正");
      if (
        r.fingerprint !==
        new Bun.CryptoHasher("sha256")
          .update(contentFingerprint(r))
          .digest("hex")
      )
        throw new ApiError(422, "主張ハッシュが不一致");
    }
  }
  if (
    !Array.isArray(a.recordEnvelopes) ||
    a.recordEnvelopes.length !== a.records.length ||
    new Set(a.recordEnvelopes.map((r: any) => r.id)).size !== a.records.length
  )
    throw new ApiError(422, "レコード構造が不正");
  for (const e of a.entities) {
    if (
      e.currentContentRevisionId &&
      !a.records.some(
        (r: any) =>
          r.id === e.currentContentRevisionId &&
          r.entityId === e.id &&
          r.objectId,
      )
    )
      throw new ApiError(422, "現在コンテンツ参照が不正");
  }
  const objects = new Map<string, Uint8Array>();
  for (const c of a.records.filter((r: any) => r.objectId)) {
    if (
      !safeId(c.objectId) ||
      typeof a.objects[c.objectId] !== "string" ||
      !ids.has(c.entityId)
    )
      throw new ApiError(422, "コンテンツが不正");
    const bytes = new Uint8Array(Buffer.from(a.objects[c.objectId], "base64"));
    if (
      bytes.length !== c.size ||
      new Bun.CryptoHasher("sha256").update(bytes).digest("hex") !== c.sha256
    )
      throw new ApiError(422, "コンテンツハッシュが不一致");
    objects.set(c.objectId, bytes);
  }
  for (const [id, bytes] of objects) {
    let existing: Uint8Array | undefined;
    try {
      existing = await store.get(id);
    } catch {}
    if (existing) {
      if (
        new Bun.CryptoHasher("sha256").update(existing).digest("hex") !==
        new Bun.CryptoHasher("sha256").update(bytes).digest("hex")
      )
        throw new ApiError(409, "オブジェクト ID が競合");
    } else await store.put(id, bytes);
  }
  sqlite.transaction(() => {
    db.delete(revisions)
      .where(eq(revisions.workspaceId, repo.workspaceId))
      .run();
    db.delete(entities).where(eq(entities.workspaceId, repo.workspaceId)).run();
    for (const e of a.entities) {
      const data = { ...e, workspaceId: repo.workspaceId };
      db.insert(entities)
        .values({
          id: e.id,
          workspaceId: repo.workspaceId,
          name: e.name,
          kind: e.kind,
          revision: e.revision,
          data,
        })
        .run();
    }
    // Version 1 archives carry table envelopes to preserve every record's identity and type.
    if (!Array.isArray(a.recordEnvelopes))
      throw new ApiError(422, "レコード構造がありません");
    for (const envelope of a.recordEnvelopes) {
      if (
        !recIds.has(envelope.id) ||
        ![
          "statement",
          "deleted-statement",
          "content",
          "derived",
          "upload",
          "view",
          "evidence",
          "assessment",
          "property",
          "class",
          "draft",
        ].includes(envelope.type) ||
        (envelope.entityId && !ids.has(envelope.entityId))
      )
        throw new ApiError(422, "レコード構造が不正");
      const data = a.records.find((r: any) => r.id === envelope.id);
      db.insert(records)
        .values({
          id: envelope.id,
          workspaceId: repo.workspaceId,
          entityId: envelope.entityId || null,
          type: envelope.type,
          revision: envelope.revision,
          data,
        })
        .run();
    }
    for (const h of a.history) {
      if (
        !safeId(h.id) ||
        typeof h.createdBy !== "string" ||
        typeof h.createdAt !== "string"
      )
        throw new ApiError(422, "履歴が不正");
      db.insert(revisions)
        .values({ ...h, workspaceId: repo.workspaceId })
        .run();
    }
  })();
  // Full text is derived from current content only.
  for (const e of a.entities) {
    if (!e.currentContentRevisionId) continue;
    const c = a.records.find((r: any) => r.id === e.currentContentRevisionId);
    if (
      c &&
      (c.effectiveContentType.startsWith("text/") ||
        c.effectiveContentType === "application/json")
    ) {
      const bytes = objects.get(c.objectId);
      if (bytes)
        sqlite
          .query(
            "INSERT INTO entity_fts(entityId,workspaceId,body) VALUES(?,?,?)",
          )
          .run(e.id, repo.workspaceId, new TextDecoder().decode(bytes));
    }
  }
  return {
    entities: a.entities.length,
    records: a.records.length,
    objects: objects.size,
  };
}
