import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db, sqlite } from "./db";
import { workspaces, memberships, records } from "./schema";
import { and, eq } from "drizzle-orm";
import { ApiError, authorized, ensureWorkspace } from "./repository";
import { config } from "./config";
import { parseQuery } from "../src/domain";
import { resolve } from "node:path";
import { importWikidata } from "./wikidata";
import { importArchive } from "./archive";
const port = config.port;
const secretPath = config.relationalAdaptor.dataDir + "/auth-secret";
if (!config.authSecret) {
  if (!(await Bun.file(secretPath).exists()))
    await Bun.write(secretPath, crypto.randomUUID() + crypto.randomUUID(), {
      mode: 0o600,
    });
  process.env.BETTER_AUTH_SECRET = await Bun.file(secretPath).text();
}
const auth = betterAuth({
  database: drizzleAdapter(db, { provider: "sqlite" }),
  baseURL: config.appUrl,
  trustedOrigins: [config.appUrl, "http://localhost:5173"],
  secret: config.authSecret || process.env.BETTER_AUTH_SECRET,
  emailAndPassword: { enabled: true },
  advanced: { database: { generateId: () => crypto.randomUUID() } },
});
const store = config.objectAdaptor;
const json = (v: unknown, status = 200) => Response.json(v, { status });
const sha = (b: Uint8Array) =>
  new Bun.CryptoHasher("sha256").update(b).digest("hex");
function detect(bytes: Uint8Array, filename: string, declared: string) {
  let detected = "";
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  )
    detected = "image/png";
  else if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255)
    detected = "image/jpeg";
  else if (new TextDecoder().decode(bytes.slice(0, 5)) === "%PDF-")
    detected = "application/pdf";
  else if (
    new TextDecoder().decode(bytes.slice(0, 4)) === "RIFF" &&
    new TextDecoder().decode(bytes.slice(8, 12)) === "WEBP"
  )
    detected = "image/webp";
  else {
    try {
      new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      if (!bytes.includes(0)) {
        detected = /\.md$/i.test(filename)
          ? "text/markdown"
          : /\.json$/i.test(filename)
            ? "application/json"
            : /\.(html?|svg)$/i.test(filename)
              ? "text/plain"
              : "text/plain";
      }
    } catch {}
  }
  const media = /^(audio|video)\/[a-z0-9.+-]+$/.test(declared) ? declared : "";
  return { detected, type: detected || media || "application/octet-stream" };
}
async function handle(req: Request): Promise<Response> {
  const url = new URL(req.url),
    p = url.pathname;
  if (p.startsWith("/api/auth/")) return auth.handler(req);
  if (!p.startsWith("/api/")) {
    const file = resolve("dist", "." + decodeURIComponent(p));
    if (file !== resolve("dist") && !file.startsWith(resolve("dist") + "/"))
      return new Response("Not found", { status: 404 });
    if ((await Bun.file(file).exists()) && p !== "/")
      return new Response(Bun.file(file));
    if (await Bun.file("dist/index.html").exists())
      return new Response(Bun.file("dist/index.html"));
    return new Response("Run bun run build or bunx vite --host 127.0.0.1", {
      status: 503,
    });
  }
  if (
    req.method !== "GET" &&
    req.headers.get("origin") &&
    ![config.appUrl, "http://localhost:5173"].includes(req.headers.get("origin")!)
  )
    throw new ApiError(403, "Origin が不正");
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) throw new ApiError(401, "ログインが必要");
  const uid = session.user.id;
  if (p === "/api/me") {
    ensureWorkspace(uid);
    return json({
      user: session.user,
      workspaces: db
        .select({ id: workspaces.id, name: workspaces.name })
        .from(workspaces)
        .innerJoin(memberships, eq(workspaces.id, memberships.workspaceId))
        .where(eq(memberships.userId, uid))
        .all(),
    });
  }
  if (p === "/api/workspaces" && req.method === "POST") {
    const b = await req.json();
    return json({
      id: ensureWorkspace(uid, String(b.name || "ワークスペース"), true),
    });
  }
  const m = /^\/api\/w\/([^/]+)(.*)$/.exec(p);
  if (!m) throw new ApiError(404, "見つかりません");
  const repo = authorized(m[1], uid),
    route = m[2];
  if (route === "/entities" && req.method === "GET")
    return json(repo.search(parseQuery(url.searchParams.get("q") || "")));
  if (route === "/entities" && req.method === "POST") {
    const b = await req.json();
    return json(repo.create(b.name, b.kind), 201);
  }
  if (route === "/wikidata" && req.method === "POST")
    return json(
      await importWikidata(repo, store, String((await req.json()).id)),
    );
  if (route === "/graph") return json(repo.graph());
  if (route === "/views" && req.method === "GET")
    return json(repo.records("view"));
  if (route === "/views" && req.method === "POST") {
    const b = await req.json();
    const v = {
      id: crypto.randomUUID(),
      name: String(b.name),
      query: parseQuery(String(b.query || "")),
      queryText: String(b.query || ""),
      display: b.display || "list",
      revision: 1,
    };
    repo.putRecord("view", v);
    return json(v);
  }
  if (route === "/history") return json(repo.history());
  if (route === "/import" && req.method === "POST")
    return json(await importArchive(repo, store, await req.json()));
  if (route === "/export") {
    const archive = {
      format: "prisx",
      version: 1,
      workspaceId: m[1],
      exportedAt: new Date().toISOString(),
      entities: repo.list(true),
      records: repo.records(),
      recordEnvelopes: db
        .select({
          id: records.id,
          type: records.type,
          entityId: records.entityId,
          revision: records.revision,
        })
        .from(records)
        .where(eq(records.workspaceId, m[1]))
        .all(),
      history: repo.history(),
      objects: {} as Record<string, string>,
    };
    for (const c of repo.records("content"))
      archive.objects[c.objectId] = Buffer.from(
        await store.get(c.objectId),
      ).toString("base64");
    return new Response(JSON.stringify(archive), {
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": 'attachment; filename="prisx-export.json"',
      },
    });
  }
  const em = /^\/entities\/([^/]+)(.*)$/.exec(route);
  if (em) {
    const entityId = em[1],
      tail = em[2],
      e = repo.entity(entityId);
    if (tail === "" && req.method === "GET")
      return json({
        entity: e,
        statements: repo.statements(entityId),
        derived: repo.records("derived", entityId)[0],
        content: e.currentContentRevisionId
          ? repo.record(e.currentContentRevisionId, "content")
          : null,
      });
    if (tail === "" && req.method === "PATCH")
      return json(repo.update(entityId, await req.json()));
    if (tail === "/schema" && req.method === "GET")
      return json(
        repo.records(e.kind, entityId)[0] || {
          enforcement: "none",
          revision: 0,
        },
      );
    if (tail === "/schema" && req.method === "PUT")
      return json(repo.saveDefinition(entityId, await req.json()));
    if (tail === "/statements/batch" && req.method === "PUT")
      return json(repo.saveStatementBatch(entityId, await req.json()));
    if (/^\/statements\/[^/]+$/.test(tail) && req.method === "DELETE") {
      const input = await req.json();
      return json(
        repo.deleteStatement(
          entityId,
          tail.split("/")[2],
          input.expectedRevision,
        ),
      );
    }
    if (tail === "/statements" && req.method === "POST")
      return json(repo.saveStatement(entityId, await req.json()));
    if (tail === "/history")
      return json(
        repo
          .history()
          .filter(
            (r) =>
              r.targetId === entityId || (r.data as any).subjectId === entityId,
          ),
      );
    if (tail === "/content" && req.method === "PUT") {
      const key = req.headers.get("idempotency-key");
      if (!key) throw new ApiError(422, "Idempotency-Key が必要");
      const duplicate = repo
        .records("upload", entityId)
        .find((u) => u.key === key);
      if (duplicate) return json(repo.record(duplicate.contentId, "content"));
      const max = Number(config.maxUploadBytes);
      if (Number(req.headers.get("content-length")) > max)
        throw new ApiError(413, "容量上限");
      const reader = req.body?.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      while (reader) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > max) {
          await reader.cancel();
          throw new ApiError(413, "容量上限");
        }
        chunks.push(value);
      }
      const bytes = new Uint8Array(size);
      let pos = 0;
      for (const c of chunks) {
        bytes.set(c, pos);
        pos += c.length;
      }
      const filename = decodeURIComponent(
        req.headers.get("x-filename") || e.name,
      );
      const declared =
        req.headers.get("content-type") || "application/octet-stream";
      const d = detect(bytes, filename, declared);
      const object = { id: crypto.randomUUID(), size, hash: sha(bytes), ...d };
      await store.put(object.id, bytes);
      const text =
        d.type.startsWith("text/") || d.type === "application/json"
          ? new TextDecoder().decode(bytes)
          : undefined;
      return json(
        repo.commitContent(
          entityId,
          {
            expectedRevision: Number(req.headers.get("x-expected-revision")),
            idempotencyKey: key,
            filename,
            contentType: declared,
          },
          object,
          text,
        ),
      );
    }
    if (tail === "/content" && req.method === "GET") {
      const revision =
        url.searchParams.get("revision") || e.currentContentRevisionId;
      if (!revision) throw new ApiError(404, "コンテンツなし");
      const c = repo.record(revision, "content");
      if (c.entityId !== entityId) throw new ApiError(403, "権限がありません");
      const bytes = await store.get(c.objectId);
      const safe =
        /^(text\/(plain|markdown)|application\/json|image\/(png|jpeg|webp|gif)|audio\/|video\/)/.test(
          c.effectiveContentType,
        );
      const headers: Record<string, string> = {
        "Content-Type": safe
          ? c.effectiveContentType
          : "application/octet-stream",
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-store",
        "Accept-Ranges": "bytes",
        "Content-Disposition": `${safe && !url.searchParams.has("download") ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(c.originalFilename)}`,
      };
      const range = req.headers.get("range");
      if (range) {
        const match = /^bytes=(\d*)-(\d*)$/.exec(range);
        if (!match || (!match[1] && !match[2]))
          return new Response(null, {
            status: 416,
            headers: { "Content-Range": `bytes */${bytes.length}` },
          });
        const start = match[1]
          ? Number(match[1])
          : Math.max(0, bytes.length - Number(match[2]));
        const end = match[1]
          ? match[2]
            ? Math.min(Number(match[2]), bytes.length - 1)
            : bytes.length - 1
          : bytes.length - 1;
        if (start > end || start >= bytes.length)
          return new Response(null, {
            status: 416,
            headers: { "Content-Range": `bytes */${bytes.length}` },
          });
        headers["Content-Range"] = `bytes ${start}-${end}/${bytes.length}`;
        return new Response(bytes.slice(start, end + 1), {
          status: 206,
          headers,
        });
      }
      return new Response(new Uint8Array(bytes), { headers });
    }
    if (tail === "/evidence" && req.method === "POST") {
      const b = await req.json(),
        s = repo.record(b.statementId, "statement");
      if (s.subjectId !== entityId) throw new ApiError(422, "対象が不一致");
      repo.expect(s.revision, b.expectedRevision);
      const source = repo.entity(b.sourceId);
      if (
        b.sourceContentRevisionId &&
        repo.record(b.sourceContentRevisionId, "content").entityId !== source.id
      )
        throw new ApiError(422, "資料版が不一致");
      if (!["supports", "opposes", "context"].includes(b.relation))
        throw new ApiError(422, "関係が不正");
      const evidence = {
        id: crypto.randomUUID(),
        targetStatementRevisionId: s.revisionId,
        fingerprint: s.fingerprint,
        reference: {
          id: crypto.randomUUID(),
          sourceId: source.id,
          sourceContentRevisionId: b.sourceContentRevisionId,
          locator: b.locator || {},
        },
        relation: b.relation,
        directness: b.directness || "unspecified",
        basis: b.basis || "document",
        explanation: b.explanation || "",
        createdBy: uid,
        createdAt: new Date().toISOString(),
      };
      repo.putRecord("evidence", evidence, entityId);
      repo.snapshot("evidence", evidence.id, evidence);
      return json(evidence);
    }
    if (tail === "/assessments" && req.method === "POST") {
      const b = await req.json(),
        s = repo.record(b.statementId, "statement");
      if (s.subjectId !== entityId) throw new ApiError(422, "対象が不一致");
      repo.expect(s.revision, b.expectedRevision);
      if (
        !["high", "medium", "low", "unrated"].includes(b.value) ||
        (b.value !== "unrated" && !b.rationale?.trim())
      )
        throw new ApiError(422, "評価の根拠が必要");
      const a = {
        id: crypto.randomUUID(),
        axis: "claim-confidence",
        schemeId: "core:confidence",
        schemeVersion: 1,
        targetId: s.id,
        targetRevisionId: s.revisionId,
        fingerprint: s.fingerprint,
        value: b.value,
        rationale: b.rationale || "",
        scope: b.scope || "",
        createdBy: uid,
        createdAt: new Date().toISOString(),
      };
      repo.putRecord("assessment", a, entityId);
      repo.snapshot("assessment", a.id, a);
      return json(a);
    }
  }
  throw new ApiError(404, "見つかりません");
}
const server = Bun.serve({
  port,
  hostname: config.host,
  maxRequestBodySize: 110 * 1024 * 1024,
  fetch: async (req) => {
    try {
      return await handle(req);
    } catch (e: any) {
      if (!(e instanceof ApiError)) console.error(e);
      return json(
        {
          error: e instanceof ApiError ? e.message : "サーバーエラー",
          detail: e.detail,
        },
        e.status || 500,
      );
    }
  },
});
console.log(`Prisx http://${server.hostname}:${server.port}`);
