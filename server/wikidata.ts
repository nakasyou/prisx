import type { Repository } from "./repository";
import { ApiError } from "./repository";
import type { ObjectStore } from "./storage";
import { sqlite } from "./db";
export async function importWikidata(
  repo: Repository,
  store: ObjectStore,
  qid: string,
) {
  if (!/^Q[1-9]\d*$/.test(qid)) throw new ApiError(422, "Q ID が不正");
  const url = `https://www.wikidata.org/wiki/Special:EntityData/${qid}.json`;
  const response = await fetch(url, {
    signal: AbortSignal.timeout(15000),
    headers: { "User-Agent": "Prisx/0.1 (manual entity import)" },
    redirect: "error",
  });
  if (!response.ok) throw new ApiError(502, "Wikidata の取得に失敗");
  const reader = response.body!.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 10 * 1024 * 1024) {
      await reader.cancel();
      throw new ApiError(413, "Wikidata 容量上限");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    bytes.set(c, at);
    at += c.length;
  }
  const raw = JSON.parse(new TextDecoder().decode(bytes)),
    data = raw.entities?.[qid];
  if (!data) throw new ApiError(502, "Wikidata データが不正");
  const objectId = crypto.randomUUID();
  await store.put(objectId, bytes);
  return sqlite.transaction(() => {
    const e = repo.create(
      data.labels?.ja?.value || data.labels?.en?.value || qid,
    );
    const content = repo.commitContent(
      e.id,
      {
        expectedRevision: 0,
        idempotencyKey: crypto.randomUUID(),
        filename: qid + ".json",
        contentType: "application/json",
      },
      {
        id: objectId,
        size,
        hash: new Bun.CryptoHasher("sha256").update(bytes).digest("hex"),
        type: "application/json",
        detected: "application/json",
      },
      new TextDecoder().decode(bytes),
    );
    const external = repo.list().find((p) => p.name === "core:externalId")!;
    repo.saveStatement(e.id, {
      propertyId: external.id,
      value: {
        kind: "object",
        fields: {
          provider: { kind: "scalar", value: "wikidata" },
          id: { kind: "scalar", value: qid },
          revision: { kind: "scalar", value: String(data.lastrevid) },
          url: { kind: "scalar", value: url },
        },
      },
      qualifiers: [],
      validTime: { kind: "unspecified" },
      rank: "normal",
    });
    for (const [pid, claims] of Object.entries(data.claims || {})) {
      const property = repo.create("wikidata:" + pid, "property");
      for (const claim of claims as any[]) {
        const s = repo.saveStatement(e.id, {
          propertyId: property.id,
          value: { kind: "opaque", format: "wikidata-statement", raw: claim },
          qualifiers: [],
          validTime: { kind: "unspecified" },
          rank: ["preferred", "normal", "deprecated"].includes(claim.rank)
            ? claim.rank
            : "normal",
          rankReason: claim.rank === "normal" ? "" : "Wikidata から取り込み",
        });
        s.origin = "import";
        repo.putRecord("statement", s, e.id);
      }
    }
    return { entity: repo.entity(e.id), content };
  })();
}
