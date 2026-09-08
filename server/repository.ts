import { and, eq, desc } from "drizzle-orm";
import { db, sqlite } from "./db";
import {
  entities,
  records,
  revisions,
  workspaces,
  memberships,
} from "./schema";
import {
  canonical,
  contentFingerprint,
  normalizeTag,
  validTag,
  refs,
  validateValue,
  type Entity,
  type Statement,
  type Value,
  type Query,
  type PropertyDefinition,
} from "../src/domain";
import { checkTime, matchTime } from "../src/time";
import { extractMarkdown } from "./markdown";
import { validateProperty, validateSchemaDefinition } from "../src/constraints";
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public detail?: unknown,
  ) {
    super(message);
  }
}
const now = () => new Date().toISOString();
const id = () => crypto.randomUUID();
export class Repository {
  constructor(
    readonly workspaceId: string,
    readonly userId: string,
  ) {}
  list(includeDeleted = false): Entity[] {
    return db
      .select()
      .from(entities)
      .where(eq(entities.workspaceId, this.workspaceId))
      .all()
      .map((r) => r.data as Entity)
      .filter((e) => includeDeleted || !e.deleted);
  }
  entity(entityId: string): Entity {
    const r = db
      .select()
      .from(entities)
      .where(
        and(
          eq(entities.id, entityId),
          eq(entities.workspaceId, this.workspaceId),
        ),
      )
      .get();
    if (!r) throw new ApiError(404, "見つかりません");
    return r.data as Entity;
  }
  record(recordId: string, type?: string): any {
    const r = db
      .select()
      .from(records)
      .where(
        and(
          eq(records.id, recordId),
          eq(records.workspaceId, this.workspaceId),
        ),
      )
      .get();
    if (!r || (type && r.type !== type))
      throw new ApiError(404, "見つかりません");
    return r.data;
  }
  records(type?: string, entityId?: string): any[] {
    return db
      .select()
      .from(records)
      .where(
        and(
          eq(records.workspaceId, this.workspaceId),
          type ? eq(records.type, type) : undefined,
          entityId ? eq(records.entityId, entityId) : undefined,
        ),
      )
      .all()
      .map((r) => r.data);
  }
  putRecord(type: string, data: any, entityId?: string) {
    db.insert(records)
      .values({
        id: data.id,
        workspaceId: this.workspaceId,
        entityId: entityId || null,
        type,
        revision: data.revision || 1,
        data,
      })
      .onConflictDoUpdate({
        target: records.id,
        set: { data, type, revision: data.revision || 1 },
      })
      .run();
  }
  history(targetId?: string) {
    return db
      .select()
      .from(revisions)
      .where(
        and(
          eq(revisions.workspaceId, this.workspaceId),
          targetId ? eq(revisions.targetId, targetId) : undefined,
        ),
      )
      .orderBy(desc(revisions.createdAt))
      .all();
  }
  snapshot(type: string, targetId: string, data: any) {
    db.insert(revisions)
      .values({
        id: id(),
        workspaceId: this.workspaceId,
        targetId,
        type,
        data,
        createdAt: now(),
        createdBy: this.userId,
      })
      .run();
  }
  create(name: string, kind: Entity["kind"] = "item"): Entity {
    if (!["item", "tag", "property", "class"].includes(kind) || !name.trim())
      throw new ApiError(422, "名前・種別が不正");
    if (kind === "tag" && !validTag(name))
      throw new ApiError(422, "タグ名が不正");
    if (kind === "property" && name.startsWith("core:"))
      throw new ApiError(422, "予約済み名前空間");
    if (kind === "tag" || kind === "property") {
      const same = this.list().find(
        (e) =>
          e.kind === kind &&
          (kind === "tag"
            ? normalizeTag(e.name) === normalizeTag(name)
            : e.name === name),
      );
      if (same) return same;
    }
    const e: Entity = {
      id: id(),
      workspaceId: this.workspaceId,
      name: name.trim(),
      aliases: [],
      kind,
      revision: 1,
      createdAt: now(),
      createdBy: this.userId,
      deleted: false,
    };
    this.writeEntity(e);
    return e;
  }
  writeEntity(e: Entity) {
    db.insert(entities)
      .values({
        id: e.id,
        workspaceId: this.workspaceId,
        name: e.name,
        kind: e.kind,
        revision: e.revision,
        data: e,
      })
      .onConflictDoUpdate({
        target: entities.id,
        set: { name: e.name, kind: e.kind, revision: e.revision, data: e },
      })
      .run();
    this.snapshot("entity", e.id, e);
  }
  update(entityId: string, input: any) {
    return sqlite.transaction(() => {
      const e = this.entity(entityId);
      this.expect(e.revision, input.expectedRevision);
      if (typeof input.name === "string" && input.name.trim()) {
        if (e.kind === "property" && e.name.startsWith("core:"))
          throw new ApiError(422, "組み込みキー");
        if (
          ["tag", "property"].includes(e.kind) &&
          this.list().some(
            (x) =>
              x.id !== e.id &&
              x.kind === e.kind &&
              normalizeTag(x.name) === normalizeTag(input.name),
          )
        )
          throw new ApiError(422, "名前が重複");
        if (e.name !== input.name)
          e.aliases = [...new Set([...e.aliases, e.name])];
        e.name = input.name.trim();
      }
      if (typeof input.deleted === "boolean") e.deleted = input.deleted;
      e.revision++;
      this.writeEntity(e);
      return e;
    })();
  }
  expect(actual: number, expected: unknown) {
    if (actual !== expected)
      throw new ApiError(409, "競合：最新の版を読み込んでください", {
        actualRevision: actual,
      });
  }
  statements(entityId: string): Statement[] {
    this.entity(entityId);
    return this.records("statement", entityId).map((s) => ({
      ...s,
      evidence: this.records("evidence", entityId).filter(
        (e) => e.fingerprint === s.fingerprint,
      ),
      assessments: this.records("assessment", entityId).filter(
        (a) => a.fingerprint === s.fingerprint,
      ),
    }));
  }
  saveStatement(subjectId: string, input: any) {
    return sqlite.transaction(() => {
      this.entity(subjectId);
      let old: Statement | undefined;
      if (input.id) {
        old = this.record(input.id, "statement");
        if (old!.subjectId !== subjectId)
          throw new ApiError(422, "対象が不一致");
        this.expect(old!.revision, input.expectedRevision);
      }
      const property = this.entity(input.propertyId);
      if (["core:tag", "core:instanceOf"].includes(property.name)) {
        if (
          input.value?.kind !== "entity-ref" ||
          this.entity(input.value.entityId).kind !==
            (property.name === "core:tag" ? "tag" : "class")
        )
          throw new ApiError(422, "参照先の種別が不正");
      }
      if (property.kind !== "property") throw new ApiError(422, "キーが必要");
      const errors = validateValue(input.value);
      if (!["normal", "preferred", "deprecated"].includes(input.rank))
        errors.push("rank: 不正");
      if (input.rank !== "normal" && !input.rankReason?.trim())
        errors.push("rankReason: 理由が必要");
      if (!Array.isArray(input.qualifiers))
        errors.push("qualifiers: 配列が必要");
      else
        for (const [i, q] of input.qualifiers.entries()) {
          this.entity(q.propertyId);
          errors.push(...validateValue(q.value, `qualifiers.${i}.value`));
        }
      errors.push(...checkTime(input.validTime));
      const t = input.validTime;
      if (
        !t ||
        !["unspecified", "timeless", "point", "interval"].includes(t.kind)
      )
        errors.push("validTime: 期間が不正");
      if (t?.kind === "interval") {
        if (!t.start || !t.end || !t.timezone)
          errors.push("validTime: 境界・タイムゾーンが必要");
        else if (t.start.value && t.end.value && t.start.value >= t.end.value)
          errors.push("validTime: 終了は開始より後");
      }
      if (errors.length) throw new ApiError(422, errors.join("、"), errors);
      for (const r of [
        ...refs(input.value),
        ...input.qualifiers.flatMap((q: any) => refs(q.value)),
      ])
        this.entity(r.id);
      const checkStatementRefs = (v: Value) => {
        if (v.kind === "statement-ref") this.record(v.statementId, "statement");
        if (v.kind === "array") v.items.forEach(checkStatementRefs);
        if (v.kind === "object")
          Object.values(v.fields).forEach(checkStatementRefs);
      };
      checkStatementRefs(input.value);
      const def = this.records("property", property.id)[0] as
        (PropertyDefinition & { id: string }) | undefined;
      if (def?.enforcement === "strict") {
        const violations = validateProperty(input.value, def);
        if (violations.length)
          throw new ApiError(422, violations.join("、"), violations);
        if (
          def.referenceRequired &&
          !this.records("evidence", subjectId).some(
            (e) =>
              e.fingerprint ===
              new Bun.CryptoHasher("sha256")
                .update(
                  contentFingerprint({
                    subjectId,
                    propertyId: property.id,
                    value: input.value,
                    qualifiers: input.qualifiers,
                    validTime: input.validTime,
                  }),
                )
                .digest("hex"),
          )
        )
          throw new ApiError(422, "reference: 出典が必要");
      }

      if (property.name === "core:subclassOf" && input.rank !== "deprecated") {
        if (
          this.entity(subjectId).kind !== "class" ||
          input.value.kind !== "entity-ref" ||
          this.entity(input.value.entityId).kind !== "class"
        )
          throw new ApiError(422, "クラス参照が必要");
        const edges = this.records("statement").filter(
          (s) =>
            s.propertyId === property.id &&
            s.rank !== "deprecated" &&
            s.id !== old?.id,
        );
        const visit = (n: string, seen = new Set<string>()): boolean =>
          n === subjectId ||
          (!seen.has(n) &&
            (seen.add(n),
            edges
              .filter((s) => s.subjectId === n && s.value.kind === "entity-ref")
              .some((s) => visit(s.value.entityId, seen))));
        if (visit(input.value.entityId))
          throw new ApiError(422, "継承が循環します");
      }
      const s: Statement = {
        id: old?.id || id(),
        subjectId,
        propertyId: property.id,
        value: input.value,
        qualifiers: input.qualifiers,
        validTime: input.validTime,
        rank: input.rank,
        rankReason: input.rankReason || "",
        revision: (old?.revision || 0) + 1,
        revisionId: id(),
        fingerprint: "",
        origin: old?.origin || "manual",
        createdBy: old?.createdBy || this.userId,
        createdAt: old?.createdAt || now(),
      };
      this.assertClassConstraints(subjectId, [
        ...this.records("statement", subjectId).filter((x) => x.id !== s.id),
        s,
      ]);
      s.fingerprint = new Bun.CryptoHasher("sha256")
        .update(contentFingerprint(s))
        .digest("hex");
      this.putRecord("statement", s, subjectId);
      this.snapshot("statement", s.id, s);
      return s;
    })();
  }
  deleteStatement(
    subjectId: string,
    statementId: string,
    expectedRevision: number,
  ) {
    return sqlite.transaction(() => {
      const s = this.record(statementId, "statement");
      if (s.subjectId !== subjectId) throw new ApiError(422, "対象が不一致");
      this.expect(s.revision, expectedRevision);
      this.assertClassConstraints(
        subjectId,
        this.records("statement", subjectId).filter(
          (x) => x.id !== statementId,
        ),
      );
      const tombstone = { ...s, revision: s.revision + 1, deleted: true };
      this.putRecord("deleted-statement", tombstone, subjectId);
      this.snapshot("statement-delete", statementId, tombstone);
      return tombstone;
    })();
  }
  saveStatementBatch(subjectId: string, input: any) {
    return sqlite.transaction(() => {
      const current = this.records("statement", subjectId);
      const versions = (xs: any[]) =>
        canonical(
          xs
            .map((s) => ({ id: s.id, revision: s.revision }))
            .sort((a, b) => a.id.localeCompare(b.id)),
        );
      if (!Array.isArray(input.expected) || !Array.isArray(input.statements))
        throw new ApiError(422, "主張集合が必要");
      if (versions(current) !== versions(input.expected))
        throw new ApiError(409, "主張集合が競合");
      const nextIds = input.statements
        .filter((s: any) => s.id)
        .map((s: any) => s.id);
      if (new Set(nextIds).size !== nextIds.length)
        throw new ApiError(422, "主張 ID が重複");
      const result = input.statements.map((s: any) =>
        this.saveStatement(subjectId, { ...s, expectedRevision: s.revision }),
      );
      for (const s of current)
        if (!nextIds.includes(s.id))
          this.deleteStatement(subjectId, s.id, s.revision);
      return result;
    })();
  }
  classIds(
    subjectId: string,
    subjectStatements = this.records("statement", subjectId),
  ) {
    const today = new Date().toISOString().slice(0, 10),
      all = this.records("statement"),
      properties = new Map(this.list().map((e) => [e.id, e.name]));
    const applicable = (s: any) =>
      s.rank !== "deprecated" && matchTime(s.validTime, today) === "match";
    const roots = subjectStatements
      .filter(
        (s) =>
          properties.get(s.propertyId) === "core:instanceOf" &&
          applicable(s) &&
          s.value.kind === "entity-ref",
      )
      .map((s) => s.value.entityId);
    const seen = new Set<string>();
    const visit = (id: string) => {
      if (seen.has(id)) return;
      seen.add(id);
      for (const s of all.filter(
        (s) =>
          s.subjectId === id &&
          properties.get(s.propertyId) === "core:subclassOf" &&
          applicable(s) &&
          s.value.kind === "entity-ref",
      ))
        visit(s.value.entityId);
    };
    roots.forEach(visit);
    return [...seen];
  }
  assertClassConstraints(
    subjectId: string,
    subjectStatements = this.records("statement", subjectId),
    override?: { entityId: string; definition: any },
  ) {
    const keys = new Set(
      subjectStatements
        .filter((s) => s.rank !== "deprecated")
        .map((s) => s.propertyId),
    );
    for (const classId of this.classIds(subjectId, subjectStatements)) {
      const def =
        override?.entityId === classId
          ? override.definition
          : this.records("class", classId)[0];
      if (!def?.enabled || def.enforcement !== "strict") continue;
      for (const key of def.requiredKeys || [])
        if (!keys.has(key))
          throw new ApiError(422, "class: 必須キー " + this.entity(key).name);
      if (def.closed)
        for (const key of keys)
          if (
            !this.entity(key).name.startsWith("core:") &&
            !(def.allowedKeys || []).includes(key) &&
            !(def.requiredKeys || []).includes(key)
          )
            throw new ApiError(
              422,
              "class: 許可されないキー " + this.entity(key).name,
            );
    }
  }
  saveDefinition(entityId: string, input: any) {
    return sqlite.transaction(() => {
      const e = this.entity(entityId);
      if (!["property", "class"].includes(e.kind))
        throw new ApiError(422, "キーまたはクラスが必要");
      const old = this.records(e.kind, entityId)[0];
      this.expect(old?.revision || 0, input.expectedRevision);
      const def = input.definition;
      if (!def || !["none", "warn", "strict"].includes(def.enforcement))
        throw new ApiError(422, "enforcement: 不正");
      if (def.valueSchema) {
        const errors = validateSchemaDefinition(def.valueSchema);
        if (errors.length) throw new ApiError(422, errors.join("、"));
        validateProperty({ kind: "scalar", value: "" }, def);
      }
      if (e.kind === "property" && def.enforcement === "strict") {
        for (const s of this.records("statement").filter(
          (s) => s.propertyId === entityId,
        )) {
          const errors = validateProperty(s.value, def);
          if (
            def.referenceRequired &&
            !this.records("evidence", s.subjectId).some(
              (ev) => ev.fingerprint === s.fingerprint,
            )
          )
            errors.push("reference: 出典が必要");
          if (errors.length)
            throw new ApiError(422, "既存主張が違反: " + s.id, {
              statementId: s.id,
              errors,
            });
        }
      }
      if (e.kind === "class") {
        for (const key of [
          ...(def.requiredKeys || []),
          ...(def.allowedKeys || []),
        ])
          if (this.entity(key).kind !== "property")
            throw new ApiError(422, "キー ID が必要");
        if (def.enforcement === "strict")
          for (const entity of this.list())
            this.assertClassConstraints(entity.id, undefined, {
              entityId,
              definition: def,
            });
      }
      const data = {
        ...def,
        id: old?.id || id(),
        revision: (old?.revision || 0) + 1,
        definedAt: now(),
      };
      this.putRecord(e.kind, data, entityId);
      this.snapshot(e.kind + "-schema", entityId, data);
      return data;
    })();
  }
  commitContent(entityId: string, input: any, object: any, text?: string) {
    return sqlite.transaction(() => {
      const e = this.entity(entityId);
      const current = e.currentContentRevisionId
        ? this.record(e.currentContentRevisionId, "content")
        : null;
      this.expect(current?.revision || 0, input.expectedRevision);
      const prior = this.records("upload", entityId).find(
        (u) => u.key === input.idempotencyKey,
      );
      if (prior) return this.record(prior.contentId, "content");
      const content = {
        id: id(),
        entityId,
        objectId: object.id,
        originalFilename: input.filename || e.name,
        declaredContentType: input.contentType,
        effectiveContentType: object.type,
        detectedContentType: object.detected,
        size: object.size,
        sha256: object.hash,
        revision: (current?.revision || 0) + 1,
        createdBy: this.userId,
        createdAt: now(),
      };
      this.putRecord("content", content, entityId);
      e.currentContentRevisionId = content.id;
      e.contentType = content.effectiveContentType;
      e.revision++;
      this.writeEntity(e);
      const parsed =
        object.type === "text/markdown"
          ? extractMarkdown(text || "")
          : { tags: [], links: [] };
      const derived = {
        id: "derived-" + entityId,
        contentRevisionId: content.id,
        tags: parsed.tags.map((t) => {
          const tag =
            this.list().find(
              (e) =>
                e.kind === "tag" &&
                [e.name, ...e.aliases].some(
                  (a) => normalizeTag(a) === t.normalized,
                ),
            ) || this.create(t.label, "tag");
          return { ...t, entityId: tag.id };
        }),
        links: parsed.links.map((l) => {
          const candidates = l.target.startsWith("id:")
            ? this.list().filter((e) => e.id === l.target.slice(3))
            : this.list().filter((e) =>
                [e.name, ...e.aliases].includes(l.target),
              );
          return {
            ...l,
            entityId: candidates.length === 1 ? candidates[0].id : null,
          };
        }),
      };
      this.putRecord("derived", derived, entityId);
      sqlite.query("DELETE FROM entity_fts WHERE entityId=?").run(entityId);
      sqlite
        .query(
          "INSERT INTO entity_fts(entityId,workspaceId,body) VALUES(?,?,?)",
        )
        .run(entityId, this.workspaceId, text || "");
      this.putRecord(
        "upload",
        { id: id(), key: input.idempotencyKey, contentId: content.id },
        entityId,
      );
      this.snapshot("content", entityId, content);
      return content;
    })();
  }
  tags(e: Entity) {
    const explicit = this.statements(e.id)
      .filter(
        (s) =>
          this.entity(s.propertyId).name === "core:tag" &&
          s.rank !== "deprecated",
      )
      .flatMap((s) => refs(s.value).map((r) => r.id));
    return [
      ...new Set([
        ...explicit,
        ...(this.records("derived", e.id)[0]?.tags || []).map(
          (t: any) => t.entityId,
        ),
      ]),
    ] as string[];
  }
  search(query: Query) {
    const list = this.list();
    const match = (e: Entity, q: Query): boolean => {
      if (q.kind === "and") return q.conditions.every((c) => match(e, c));
      if (q.kind === "or") return q.conditions.some((c) => match(e, c));
      if (q.kind === "not") return !match(e, q.condition);
      if (q.kind === "statement")
        return this.statements(e.id).some(
          (s) =>
            (!q.propertyId || s.propertyId === q.propertyId) &&
            (!q.rank || s.rank === q.rank) &&
            (!q.value || canonical(q.value) === canonical(s.value)),
        );
      if (!("value" in q)) return false;
      const v = q.value.toLocaleLowerCase();
      if (q.kind === "type") return e.contentType === v;
      if (q.kind === "tag")
        return this.tags(e).some((t) => {
          const tag = this.entity(t);
          return [tag.name, ...tag.aliases, tag.id].some(
            (x) => normalizeTag(x) === normalizeTag(v),
          );
        });
      if (q.kind === "has")
        return this.statements(e.id).some((s) =>
          [
            s.propertyId,
            this.entity(s.propertyId).name.toLocaleLowerCase(),
          ].includes(v),
        );
      if (q.kind === "class")
        return this.statements(e.id).some(
          (s) =>
            this.entity(s.propertyId).name === "core:instanceOf" &&
            refs(s.value).some((r) =>
              [r.id, this.entity(r.id).name.toLocaleLowerCase()].includes(v),
            ),
        );
      if (
        [e.name, ...e.aliases, JSON.stringify(this.statements(e.id))].some(
          (x) => x.toLocaleLowerCase().includes(v),
        )
      )
        return true;
      if ([...v].length >= 3)
        return !!sqlite
          .query(
            "SELECT 1 FROM entity_fts WHERE entityId=? AND workspaceId=? AND entity_fts MATCH ?",
          )
          .get(e.id, this.workspaceId, '"' + v.replaceAll('"', '""') + '"');
      return !!sqlite
        .query(
          "SELECT 1 FROM entity_fts WHERE entityId=? AND workspaceId=? AND body LIKE ? ESCAPE '\\'",
        )
        .get(e.id, this.workspaceId, "%" + v.replace(/[\\%_]/g, "\\$&") + "%");
    };
    return list
      .filter((e) => match(e, query))
      .map((e) => ({ ...e, tags: this.tags(e) }));
  }
  graph() {
    const nodes = this.list();
    const edges: any[] = [];
    for (const e of nodes) {
      for (const s of this.statements(e.id))
        for (const r of refs(s.value))
          edges.push({
            id: s.id + r.path,
            source: e.id,
            target: r.id,
            type: this.entity(s.propertyId).name,
            statementId: s.id,
            path: r.path,
            rank: s.rank,
          });
      for (const ev of this.records("evidence", e.id))
        edges.push({
          id: ev.id,
          source: e.id,
          target: ev.reference.sourceId,
          type: ev.relation,
          statementRevisionId: ev.targetStatementRevisionId,
        });
      const d = this.records("derived", e.id)[0];
      for (const t of d?.tags || [])
        if (
          !edges.some(
            (x) =>
              x.source === e.id &&
              x.target === t.entityId &&
              x.type === "core:tag",
          )
        )
          edges.push({
            id: e.id + t.entityId,
            source: e.id,
            target: t.entityId,
            type: "tag-derived",
            offset: t.offset,
          });
      for (const l of d?.links || [])
        if (l.entityId)
          edges.push({
            id: e.id + l.offset,
            source: e.id,
            target: l.entityId,
            type: "body-link",
            offset: l.offset,
          });
    }
    return {
      nodes: nodes.slice(0, 1000),
      edges: edges
        .filter((e) => nodes.slice(0, 1000).some((n) => n.id === e.target))
        .slice(0, 3000),
      truncated: nodes.length > 1000 || edges.length > 3000,
    };
  }
}
export function ensureWorkspace(
  userId: string,
  name = "マイワークスペース",
  force = false,
) {
  const existing = db
    .select()
    .from(memberships)
    .where(eq(memberships.userId, userId))
    .all();
  if (existing.length && !force) return existing[0].workspaceId;
  return sqlite.transaction(() => {
    const w = id();
    db.insert(workspaces).values({ id: w, name, createdAt: now() }).run();
    db.insert(memberships)
      .values({ id: id(), workspaceId: w, userId, role: "owner" })
      .run();
    const repo = new Repository(w, userId);
    for (const name of [
      "instanceOf",
      "subclassOf",
      "tag",
      "relatedTo",
      "partOf",
      "externalId",
      "sameAs",
    ]) {
      const e = repo.create(name, "property");
      e.name = "core:" + name;
      repo.writeEntity(e);
    }
    for (const name of [
      "Entity",
      "File",
      "MarkdownDocument",
      "Image",
      "Audio",
      "Video",
      "Source",
      "Person",
      "Organization",
      "Concept",
      "Event",
    ])
      repo.create(name, "class");
    return w;
  })();
}
export function authorized(workspaceId: string, userId: string) {
  if (
    !db
      .select()
      .from(memberships)
      .where(
        and(
          eq(memberships.workspaceId, workspaceId),
          eq(memberships.userId, userId),
        ),
      )
      .get()
  )
    throw new ApiError(403, "権限がありません");
  return new Repository(workspaceId, userId);
}
