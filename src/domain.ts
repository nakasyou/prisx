import { matchTime as timeMatch, pointWindow } from "./time";
export type Value =
  | { kind: "scalar"; value: string | number | boolean | null }
  | { kind: "object"; fields: Record<string, Value> }
  | { kind: "array"; items: Value[] }
  | { kind: "entity-ref"; entityId: string }
  | { kind: "statement-ref"; statementId: string }
  | {
      kind: "time";
      value: string;
      precision: "year" | "month" | "day" | "second";
      timezone?: string;
    }
  | { kind: "quantity"; amount: string; unitId?: string }
  | { kind: "unknown" }
  | { kind: "no-value" }
  | { kind: "opaque"; format: string; raw: unknown };
export type TimePoint = {
  value: string;
  precision: "year" | "month" | "day" | "second";
};
export type Boundary = TimePoint | { kind: "unknown" | "unbounded" };
export type ValidTime =
  | { kind: "unspecified" | "timeless" }
  | { kind: "point"; point: TimePoint; timezone?: string }
  | { kind: "interval"; start: Boundary; end: Boundary; timezone: string };
export type Entity = {
  id: string;
  workspaceId: string;
  name: string;
  aliases: string[];
  kind: "item" | "tag" | "property" | "class";
  revision: number;
  createdAt: string;
  createdBy: string;
  deleted: boolean;
  currentContentRevisionId?: string;
  contentType?: string;
  tags?: string[];
};
export type Statement = {
  id: string;
  subjectId: string;
  propertyId: string;
  value: Value;
  qualifiers: { propertyId: string; value: Value }[];
  validTime: ValidTime;
  rank: "preferred" | "normal" | "deprecated";
  rankReason?: string;
  revision: number;
  revisionId: string;
  fingerprint: string;
  origin: "manual" | "import";
  createdBy: string;
  createdAt: string;
  evidence?: Evidence[];
  assessments?: Assessment[];
};
export type Reference = {
  id: string;
  sourceId: string;
  sourceContentRevisionId?: string;
  locator: Record<string, unknown>;
};
export type Evidence = {
  id: string;
  targetStatementRevisionId: string;
  fingerprint: string;
  reference: Reference;
  relation: "supports" | "opposes" | "context";
  directness: "direct" | "indirect" | "unspecified";
  basis:
    | "observation"
    | "measurement"
    | "document"
    | "testimony"
    | "inference"
    | "other";
  explanation: string;
  createdBy: string;
  createdAt: string;
};
export type Assessment = {
  id: string;
  axis: "source-reliability" | "claim-confidence" | "evidence-strength";
  schemeId: string;
  schemeVersion: number;
  targetId: string;
  targetRevisionId: string;
  fingerprint: string;
  value: "high" | "medium" | "low" | "unrated";
  rationale: string;
  scope: string;
  createdBy: string;
  createdAt: string;
};
export type PropertyDefinition = {
  valueKind?: Value["kind"][];
  valueSchema?: Record<string, unknown>;
  referenceRequired?: boolean;
  enforcement: "none" | "warn" | "strict";
};
export type Query =
  | { kind: "and" | "or"; conditions: Query[] }
  | { kind: "not"; condition: Query }
  | { kind: "text" | "tag" | "type" | "class" | "has"; value: string }
  | {
      kind: "statement";
      propertyId?: string;
      rank?: Statement["rank"];
      value?: Value;
    };
export function parseQuery(text: string): Query {
  return {
    kind: "and",
    conditions: (text.match(/(?:[^\s"]+|"[^"]*")+/g) || []).map((token) => {
      const m = /^(tag|type|class|has):(.+)$/.exec(token);
      return m
        ? { kind: m[1] as "tag", value: m[2].replaceAll('"', "") }
        : { kind: "text", value: token.replaceAll('"', "") };
    }),
  };
}
export function validateValue(v: unknown, path = "value", depth = 0): string[] {
  if (depth > 32) return [path + ": 深さの上限"];
  if (!v || typeof v !== "object") return [path + ": 型が必要"];
  const x = v as any;
  switch (x.kind) {
    case "scalar":
      return x.value === null ||
        typeof x.value === "string" ||
        typeof x.value === "boolean" ||
        (typeof x.value === "number" &&
          Number.isFinite(x.value) &&
          (!Number.isInteger(x.value) || Number.isSafeInteger(x.value)))
        ? []
        : [path + ": 有限・安全な値が必要"];
    case "object":
      return x.fields &&
        typeof x.fields === "object" &&
        !Array.isArray(x.fields)
        ? Object.entries(x.fields).flatMap(([k, v]) =>
            validateValue(v, `${path}.fields.${k}`, depth + 1),
          )
        : [path + ": 辞書が必要"];
    case "array":
      return Array.isArray(x.items)
        ? x.items.flatMap((v: unknown, i: number) =>
            validateValue(v, `${path}.items.${i}`, depth + 1),
          )
        : [path + ": 配列が必要"];
    case "entity-ref":
      return typeof x.entityId === "string" && x.entityId
        ? []
        : [path + ": 参照先が必要"];
    case "statement-ref":
      return typeof x.statementId === "string" && x.statementId
        ? []
        : [path + ": 主張 ID が必要"];
    case "quantity":
      return typeof x.amount === "string" &&
        /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(x.amount)
        ? []
        : [path + ": 十進文字列が必要"];
    case "time":
      try {
        if (!["year", "month", "day", "second"].includes(x.precision))
          throw Error();
        pointWindow(x, x.timezone);
        return [];
      } catch {
        return [path + ": 日時の精度が不正"];
      }
    case "unknown":
    case "no-value":
      return [];
    case "opaque":
      return typeof x.format === "string" && jsonCompatible(x.raw, depth + 1)
        ? []
        : [path + ": JSON が必要"];
    default:
      return [path + ": 未対応の型"];
  }
}
function jsonCompatible(v: unknown, d = 0): boolean {
  return (
    d < 33 &&
    (v === null ||
      typeof v === "string" ||
      typeof v === "boolean" ||
      (typeof v === "number" && Number.isFinite(v)) ||
      (Array.isArray(v) && v.every((x) => jsonCompatible(x, d + 1))) ||
      (!!v &&
        typeof v === "object" &&
        Object.values(v).every((x) => jsonCompatible(x, d + 1))))
  );
}
export function fromJSON(v: any): Value {
  return Array.isArray(v)
    ? { kind: "array", items: v.map(fromJSON) }
    : v !== null && typeof v === "object"
      ? {
          kind: "object",
          fields: Object.fromEntries(
            Object.entries(v).map(([k, v]) => [k, fromJSON(v)]),
          ),
        }
      : { kind: "scalar", value: v };
}
export function displayValue(
  v: Value,
  names: Record<string, string> = {},
): string {
  switch (v.kind) {
    case "scalar":
      return v.value === null ? "null" : String(v.value);
    case "entity-ref":
      return names[v.entityId] || v.entityId;
    case "statement-ref":
      return v.statementId;
    case "array":
      return "[" + v.items.map((x) => displayValue(x, names)).join(", ") + "]";
    case "object":
      return (
        "{ " +
        Object.entries(v.fields)
          .map(([k, x]) => k + ": " + displayValue(x, names))
          .join(", ") +
        " }"
      );
    case "time":
      return v.value;
    case "quantity":
      return v.amount + (v.unitId ? " " + (names[v.unitId] || v.unitId) : "");
    case "unknown":
      return "不明";
    case "no-value":
      return "値なし";
    case "opaque":
      return v.format;
  }
}
export function refs(v: Value, path = "value"): { id: string; path: string }[] {
  switch (v.kind) {
    case "entity-ref":
      return [{ id: v.entityId, path }];
    case "quantity":
      return v.unitId ? [{ id: v.unitId, path: path + ".unitId" }] : [];
    case "array":
      return v.items.flatMap((x, i) => refs(x, `${path}.items.${i}`));
    case "object":
      return Object.entries(v.fields).flatMap(([k, x]) =>
        refs(x, `${path}.fields.${k}`),
      );
    default:
      return [];
  }
}
export function normalizeTag(s: string) {
  return s.normalize("NFC").replace(/[A-Z]/g, (c) => c.toLowerCase());
}
export function validTag(s: string) {
  return (
    /^[\p{L}\p{M}\p{N}_-]+(?:\/[\p{L}\p{M}\p{N}_-]+)*$/u.test(s) &&
    /[\p{L}_-]/u.test(s)
  );
}
export function canonical(v: unknown): string {
  if (Array.isArray(v)) return "[" + v.map(canonical).join(",") + "]";
  if (v && typeof v === "object")
    return (
      "{" +
      Object.keys(v)
        .sort()
        .map((k) => JSON.stringify(k) + ":" + canonical((v as any)[k]))
        .join(",") +
      "}"
    );
  return JSON.stringify(v);
}
export function contentFingerprint(
  s: Pick<
    Statement,
    "subjectId" | "propertyId" | "value" | "qualifiers" | "validTime"
  >,
) {
  return canonical({
    subjectId: s.subjectId,
    propertyId: s.propertyId,
    value: s.value,
    qualifiers: [...s.qualifiers].sort((a, b) =>
      canonical(a).localeCompare(canonical(b)),
    ),
    validTime: s.validTime,
  });
}
export { matchTime as timeMatch } from "./time";
export function representatives(
  s: Statement[],
  at?: string,
  contextKeys: string[] = [],
) {
  const groups = new Map<string, Statement[]>();
  for (const x of s) {
    if (
      x.rank === "deprecated" ||
      (at && timeMatch(x.validTime, at) !== "match")
    )
      continue;
    const k = canonical(
      x.qualifiers
        .filter((q) => contextKeys.includes(q.propertyId))
        .sort((a, b) => canonical(a).localeCompare(canonical(b))),
    );
    groups.set(k, [...(groups.get(k) || []), x]);
  }
  return [...groups.values()].flatMap((g) =>
    g.some((x) => x.rank === "preferred")
      ? g.filter((x) => x.rank === "preferred")
      : g,
  );
}
