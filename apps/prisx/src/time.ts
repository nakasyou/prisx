import { Temporal } from "@js-temporal/polyfill";
import type { TimePoint, ValidTime, Boundary } from "./domain";
type Window = { lo: bigint; hi: bigint };
export function pointWindow(p: TimePoint, timezone = "UTC"): Window {
  if (p.precision === "second") {
    const instant = /[zZ]$|[+-]\d\d:\d\d$/.test(p.value)
      ? Temporal.Instant.from(p.value)
      : Temporal.PlainDateTime.from(p.value)
          .toZonedDateTime(timezone)
          .toInstant();
    return {
      lo: instant.epochNanoseconds,
      hi: instant.add({ seconds: 1 }).epochNanoseconds,
    };
  }
  const date = Temporal.PlainDate.from(
    p.value +
      (p.precision === "year"
        ? "-01-01"
        : p.precision === "month"
          ? "-01"
          : ""),
  );
  const next = date.add(
    p.precision === "year"
      ? { years: 1 }
      : p.precision === "month"
        ? { months: 1 }
        : { days: 1 },
  );
  return {
    lo: date.toZonedDateTime(timezone).epochNanoseconds,
    hi: next.toZonedDateTime(timezone).epochNanoseconds,
  };
}
export function checkTime(t: any): string[] {
  try {
    if (
      !t ||
      !["unspecified", "timeless", "point", "interval"].includes(t.kind)
    )
      return ["validTime: 種別が不正"];
    if (t.kind === "point") pointWindow(t.point, t.timezone);
    if (t.kind === "interval") {
      if (typeof t.timezone !== "string") throw Error();
      for (const b of [t.start, t.end]) {
        if (!b) throw Error();
        if ("kind" in b) {
          if (!["unknown", "unbounded"].includes(b.kind)) throw Error();
        } else pointWindow(b, t.timezone);
      }
      if (
        !("kind" in t.start) &&
        !("kind" in t.end) &&
        pointWindow(t.start, t.timezone).lo >= pointWindow(t.end, t.timezone).hi
      )
        throw Error();
    }
    return [];
  } catch {
    return ["validTime: 日時・期間・タイムゾーンが不正"];
  }
}
export function matchTime(
  t: ValidTime,
  at: string,
): "match" | "no-match" | "indeterminate" {
  if (t.kind === "unspecified") return "indeterminate";
  if (t.kind === "timeless") return "match";
  try {
    const precision =
      at.length === 4
        ? "year"
        : at.length === 7
          ? "month"
          : at.length === 10
            ? "day"
            : "second";
    const q = pointWindow(
      { value: at, precision },
      "timezone" in t ? t.timezone : "UTC",
    );
    if (t.kind === "point") {
      const p = pointWindow(t.point, t.timezone);
      if (q.hi <= p.lo || q.lo >= p.hi) return "no-match";
      return p.lo === q.lo && p.hi === q.hi ? "match" : "indeterminate";
    }
    if (t.kind !== "interval") return "indeterminate";
    const boundary = (b: Boundary, side: "start" | "end") => {
      if ("kind" in b)
        return b.kind === "unbounded" ? "match" : "indeterminate";
      const p = pointWindow(b, t.timezone);
      const exact = b.precision === "day" || b.precision === "second";
      if (side === "start") {
        if (q.hi <= p.lo) return "no-match";
        if (q.lo >= (exact ? p.lo : p.hi)) return "match";
        return "indeterminate";
      }
      if (q.lo >= (exact ? p.lo : p.hi)) return "no-match";
      if (q.hi <= p.lo) return "match";
      return "indeterminate";
    };
    const a = boundary(t.start, "start"),
      b = boundary(t.end, "end");
    return a === "no-match" || b === "no-match"
      ? "no-match"
      : a === "indeterminate" || b === "indeterminate"
        ? "indeterminate"
        : "match";
  } catch {
    return "indeterminate";
  }
}
