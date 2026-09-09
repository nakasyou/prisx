import { test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
let proc: ReturnType<typeof Bun.spawn>,
  dir: string,
  cookie = "",
  workspace = "",
  entity = "",
  property = "",
  tag = "",
  statement: any;
const base = "http://localhost:3191";
async function configPath(dir: string, port: number, url: string) {
  const adapter = join(import.meta.dir, "..", "server", "adapters.ts");
  const file = join(dir, "prisx.config.ts");
  await writeFile(
    file,
    `import { defineConfig, sqlite, file } from ${JSON.stringify(adapter)};
export default defineConfig({
  host: "127.0.0.1",
  port: ${port},
  appUrl: ${JSON.stringify(url)},
  relationalAdaptor: sqlite({ path: ${JSON.stringify(join(dir, "prisx.sqlite"))} }),
  objectAdaptor: file({ dir: ${JSON.stringify(join(dir, "objects"))} }),
});`,
  );
  return file;
}
async function call(
  path: string,
  method = "GET",
  body?: any,
  extra: Record<string, string> = {},
) {
  return fetch(base + path, {
    method,
    headers: {
      Cookie: cookie,
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...extra,
    },
    body:
      body === undefined
        ? undefined
        : typeof body === "string"
          ? body
          : JSON.stringify(body),
  });
}
const route = (s: string) => `/api/w/${workspace}${s}`;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "prisx-api-"));
  const cfg = await configPath(dir, 3191, base);
  proc = Bun.spawn(["bun", "server/index.ts"], {
    cwd: join(import.meta.dir, ".."),
    env: { ...process.env, PRISX_CONFIG: cfg },
    stdout: "ignore",
    stderr: "pipe",
  });
  for (let i = 0; i < 100; i++) {
    try {
      await fetch(base);
      break;
    } catch {
      await Bun.sleep(50);
    }
  }
  const auth = await call("/api/auth/sign-up/email", "POST", {
    name: "Test",
    email: "test@example.com",
    password: "TestPassword123!",
  });
  expect(auth.status).toBe(200);
  cookie = auth.headers
    .getSetCookie()
    .map((s) => s.split(";")[0])
    .join("; ");
  const me = await (await call("/api/me")).json();
  workspace = me.workspaces[0].id;
}, 15000);
afterAll(async () => {
  proc.kill();
  await proc.exited;
  await rm(dir, { recursive: true, force: true });
});
test("認証と個人ワークスペース", async () => {
  expect((await fetch(base + route("/entities"))).status).toBe(401);
  const all = await (await call(route("/entities"))).json();
  expect(all.some((e: any) => e.name === "core:tag")).toBe(true);
  property = all.find((e: any) => e.name === "core:relatedTo").id;
  tag = all.find((e: any) => e.name === "core:tag").id;
});
test("Markdown 保存と派生タグが同時に確定する", async () => {
  entity = (
    await (
      await call(route("/entities"), "POST", { name: "テスト", kind: "item" })
    ).json()
  ).id;
  const r = await call(
    route(`/entities/${entity}/content`),
    "PUT",
    "# テスト\n#研究\n`#除外`",
    {
      "Content-Type": "text/markdown",
      "X-Filename": "test.md",
      "X-Expected-Revision": "0",
      "Idempotency-Key": "upload-1",
    },
  );
  expect(r.status).toBe(200);
  const d = await (await call(route(`/entities/${entity}`))).json();
  expect(d.content.revision).toBe(1);
  expect(d.derived.tags.map((t: any) => t.label)).toEqual(["研究"]);
});
test("二重 finalize は同じ版、古い書き込みは 409", async () => {
  const headers = {
    "Content-Type": "text/markdown",
    "X-Filename": "test.md",
    "X-Expected-Revision": "0",
    "Idempotency-Key": "upload-1",
  };
  expect(
    (
      await (
        await call(
          route(`/entities/${entity}/content`),
          "PUT",
          "different",
          headers,
        )
      ).json()
    ).revision,
  ).toBe(1);
  expect(
    (
      await call(route(`/entities/${entity}/content`), "PUT", "#改変", {
        ...headers,
        "Idempotency-Key": "upload-2",
      })
    ).status,
  ).toBe(409);
  const d = await (await call(route(`/entities/${entity}`))).json();
  expect(d.derived.tags[0].label).toBe("研究");
});
test("同じキー・同じ値を独立した主張として保存する", async () => {
  const input = {
    propertyId: property,
    value: { kind: "entity-ref", entityId: entity },
    qualifiers: [],
    validTime: { kind: "unspecified" },
    rank: "normal",
  };
  const a = await (
    await call(route(`/entities/${entity}/statements`), "POST", input)
  ).json();
  const b = await (
    await call(route(`/entities/${entity}/statements`), "POST", input)
  ).json();
  expect(a.id).not.toBe(b.id);
  statement = a;
});
test("参照を別ワークスペースへ越境させない", async () => {
  const w = await (
    await call("/api/workspaces", "POST", { name: "Other" })
  ).json();
  expect((await call(`/api/w/${w.id}/entities/${entity}`)).status).toBe(404);
  const input = {
    propertyId: property,
    value: { kind: "entity-ref", entityId: "not-found" },
    qualifiers: [],
    validTime: { kind: "unspecified" },
    rank: "normal",
  };
  expect(
    (await call(route(`/entities/${entity}/statements`), "POST", input)).status,
  ).toBe(404);
});
test("評価は値を変更した主張へ流用されない", async () => {
  expect(
    (
      await call(route(`/entities/${entity}/assessments`), "POST", {
        statementId: statement.id,
        expectedRevision: 1,
        value: "high",
        rationale: "",
      })
    ).status,
  ).toBe(422);
  expect(
    (
      await call(route(`/entities/${entity}/assessments`), "POST", {
        statementId: statement.id,
        expectedRevision: 1,
        value: "high",
        rationale: "検証済み",
      })
    ).status,
  ).toBe(200);
  let d = await (await call(route(`/entities/${entity}`))).json();
  expect(
    d.statements.find((s: any) => s.id === statement.id).assessments,
  ).toHaveLength(1);
  expect(
    (
      await call(route(`/entities/${entity}/statements`), "POST", {
        ...statement,
        value: { kind: "scalar", value: "new" },
        expectedRevision: 1,
      })
    ).status,
  ).toBe(200);
  d = await (await call(route(`/entities/${entity}`))).json();
  expect(
    d.statements.find((s: any) => s.id === statement.id).assessments,
  ).toHaveLength(0);
});
test("短い日本語検索と Range", async () => {
  expect(
    (await (await call(route("/entities?q=研究"))).json()).some(
      (e: any) => e.id === entity,
    ),
  ).toBe(true);
  const r = await call(route(`/entities/${entity}/content`), "GET", undefined, {
    Range: "bytes=0-3",
  });
  expect(r.status).toBe(206);
  expect((await r.arrayBuffer()).byteLength).toBe(4);
});
test("完全エクスポートに元ファイルと履歴が含まれる", async () => {
  const a = await (await call(route("/export"))).json();
  expect(a.format).toBe("prisx");
  expect(a.recordEnvelopes.length).toBe(a.records.length);
  expect(a.history.length).toBeGreaterThan(0);
  expect(Object.keys(a.objects)).toHaveLength(1);
  expect((await call(route("/import"), "POST", a)).status).toBe(409);
});

test("主張 JSON の一括適用は途中で失敗しても全体をロールバックする", async () => {
  const before = await (await call(route(`/entities/${entity}`))).json();
  const next = before.statements.map((s: any) => ({
    ...s,
    value: { kind: "scalar", value: "batch-change" },
  }));
  next.push({ ...next[0], id: undefined, propertyId: "invalid" });
  const r = await call(route(`/entities/${entity}/statements/batch`), "PUT", {
    expected: before.statements,
    statements: next,
  });
  expect(r.status).toBe(404);
  const after = await (await call(route(`/entities/${entity}`))).json();
  expect(after.statements.map((s: any) => s.revision)).toEqual(
    before.statements.map((s: any) => s.revision),
  );
});
test("strict スキーマの影響検証とサーバー検証", async () => {
  const p = await (
    await call(route("/entities"), "POST", {
      name: "制約テスト",
      kind: "property",
    })
  ).json();
  const s = await (
    await call(route(`/entities/${entity}/statements`), "POST", {
      propertyId: p.id,
      value: { kind: "scalar", value: "text" },
      qualifiers: [],
      validTime: { kind: "unspecified" },
      rank: "normal",
    })
  ).json();
  let r = await call(route(`/entities/${p.id}/schema`), "PUT", {
    expectedRevision: 0,
    definition: { enforcement: "strict", valueKind: ["entity-ref"] },
  });
  expect(r.status).toBe(422);
  r = await call(route(`/entities/${p.id}/schema`), "PUT", {
    expectedRevision: 0,
    definition: {
      enforcement: "strict",
      valueKind: ["scalar"],
      valueSchema: {
        type: "object",
        properties: { kind: { const: "scalar" }, value: { type: "string" } },
        required: ["kind", "value"],
      },
    },
  });
  expect(r.status).toBe(200);
  expect(
    (
      await call(route(`/entities/${entity}/statements`), "POST", {
        ...s,
        expectedRevision: s.revision,
        value: { kind: "scalar", value: 12 },
      })
    ).status,
  ).toBe(422);
});
test("アーカイブを別の空 DB に ID とバイト列を保って再インポートする", async () => {
  const archive = await (await call(route("/export"))).json();
  const destDir = await mkdtemp(join(tmpdir(), "prisx-import-"));
  const destBase = "http://localhost:3192";
  const destCfg = await configPath(destDir, 3192, destBase);
  const dest = Bun.spawn(["bun", "server/index.ts"], {
    cwd: join(import.meta.dir, ".."),
    env: { ...process.env, PRISX_CONFIG: destCfg },
    stdout: "ignore",
    stderr: "pipe",
  });
  try {
    for (let i = 0; i < 100; i++) {
      try {
        await fetch(destBase);
        break;
      } catch {
        await Bun.sleep(50);
      }
    }
    const r = await fetch(destBase + "/api/auth/sign-up/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Restore",
        email: "restore@example.com",
        password: "RestorePassword123!",
      }),
    });
    const headers = {
      "Content-Type": "application/json",
      Cookie: r.headers
        .getSetCookie()
        .map((s) => s.split(";")[0])
        .join("; "),
    };
    const me = await (await fetch(destBase + "/api/me", { headers })).json();
    const target = destBase + "/api/w/" + me.workspaces[0].id;
    const imported = await fetch(target + "/import", {
      method: "POST",
      headers,
      body: JSON.stringify(archive),
    });
    expect(imported.status).toBe(200);
    const entityData = await (
      await fetch(target + "/entities/" + entity, { headers })
    ).json();
    expect(entityData.entity.id).toBe(entity);
    const roundtrip = await (
      await fetch(target + "/export", { headers })
    ).json();
    expect(roundtrip.objects).toEqual(archive.objects);
    expect(roundtrip.records).toEqual(archive.records);
    expect(roundtrip.history.map((h: any) => h.id).sort()).toEqual(
      archive.history.map((h: any) => h.id).sort(),
    );
  } finally {
    dest.kill();
    await dest.exited;
    await rm(destDir, { recursive: true, force: true });
  }
}, 15000);

test("クラス継承の循環と必須キー違反を拒否する", async () => {
  const all = await (await call(route("/entities"))).json();
  const sub = all.find((e: any) => e.name === "core:subclassOf").id,
    instance = all.find((e: any) => e.name === "core:instanceOf").id,
    required = all.find((e: any) => e.name === "制約テスト").id;
  const a = await (
      await call(route("/entities"), "POST", { name: "A", kind: "class" })
    ).json(),
    b = await (
      await call(route("/entities"), "POST", { name: "B", kind: "class" })
    ).json();
  const relation = (propertyId: string, target: string) => ({
    propertyId,
    value: { kind: "entity-ref", entityId: target },
    qualifiers: [],
    rank: "normal",
    validTime: { kind: "timeless" },
  });
  expect(
    (
      await call(
        route(`/entities/${a.id}/statements`),
        "POST",
        relation(sub, b.id),
      )
    ).status,
  ).toBe(200);
  expect(
    (
      await call(
        route(`/entities/${b.id}/statements`),
        "POST",
        relation(sub, a.id),
      )
    ).status,
  ).toBe(422);
  expect(
    (
      await call(route(`/entities/${b.id}/schema`), "PUT", {
        expectedRevision: 0,
        definition: {
          enforcement: "strict",
          enabled: true,
          requiredKeys: [required],
        },
      })
    ).status,
  ).toBe(200);
  const subject = await (
    await call(route("/entities"), "POST", { name: "分類対象", kind: "item" })
  ).json();
  expect(
    (
      await call(
        route(`/entities/${subject.id}/statements`),
        "POST",
        relation(instance, a.id),
      )
    ).status,
  ).toBe(422);
});
test("空の Markdown も正規コンテンツ版として保存できる", async () => {
  const e = await (
    await call(route("/entities"), "POST", { name: "空本文", kind: "item" })
  ).json();
  const r = await call(route(`/entities/${e.id}/content`), "PUT", "", {
    "Content-Type": "text/markdown",
    "X-Filename": "empty.md",
    "X-Expected-Revision": "0",
    "Idempotency-Key": "empty-upload",
  });
  expect(r.status).toBe(200);
  expect((await r.json()).size).toBe(0);
});
