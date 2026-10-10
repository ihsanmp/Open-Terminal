import { describe, expect, it } from "vitest";
import { addDays, dayIn, inPeriod, midnight, monthWeeks, periodLabel, rangeOf, step, weekStart } from "./econ-range";

describe("economic calendar period", () => {
  it("counts days across months and years, and finds the week's Monday", () => {
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
    expect(weekStart("2026-10-10")).toBe("2026-10-05"); // a Saturday
    expect(weekStart("2026-10-11")).toBe("2026-10-05"); // a Sunday stays in its week
    expect(weekStart("2026-10-05")).toBe("2026-10-05");
  });

  it("starts days at midnight in the chosen zone, daylight saving included", () => {
    expect(midnight("2026-10-10", "UTC")).toBe(Date.UTC(2026, 9, 10));
    expect(midnight("2026-10-10", "Asia/Tokyo")).toBe(Date.UTC(2026, 9, 9, 15));
    expect(midnight("2026-07-01", "America/New_York")).toBe(Date.UTC(2026, 6, 1, 4)); // EDT
    expect(midnight("2026-12-01", "America/New_York")).toBe(Date.UTC(2026, 11, 1, 5)); // EST
    expect(midnight("2026-10-10")).toBe(new Date(2026, 9, 10).getTime());
    expect(dayIn(Date.UTC(2026, 9, 9, 16), "Asia/Tokyo")).toBe("2026-10-10");
    expect(dayIn(Date.UTC(2026, 9, 9, 16), "UTC")).toBe("2026-10-09");
  });

  it("covers a day, or Monday to Sunday, and steps by its own length", () => {
    expect(rangeOf({ kind: "day", day: "2026-10-10" }, "UTC")).toEqual({ from: Date.UTC(2026, 9, 10), to: Date.UTC(2026, 9, 11) });
    expect(rangeOf({ kind: "week", day: "2026-10-08" }, "UTC")).toEqual({ from: Date.UTC(2026, 9, 5), to: Date.UTC(2026, 9, 12) });
    expect(step({ kind: "week", day: "2026-10-08" }, 1)).toEqual({ kind: "week", day: "2026-10-12" });
    expect(step({ kind: "day", day: "2026-10-01" }, -1)).toEqual({ kind: "day", day: "2026-09-30" });
    expect(inPeriod("2026-10-11", { kind: "week", day: "2026-10-05" })).toBe(true);
    expect(inPeriod("2026-10-12", { kind: "week", day: "2026-10-05" })).toBe(false);
  });

  it("lays a month out in Monday-first weeks", () => {
    const oct = monthWeeks(2026, 9);
    expect(oct).toHaveLength(5);
    expect(oct[0][0]).toBe("2026-09-28");
    expect(oct.at(-1)!.at(-1)).toBe("2026-11-01");
    expect(monthWeeks(2026, 11).at(-1)!.includes("2026-12-31")).toBe(true);
  });

  it("names the period", () => {
    expect(periodLabel({ kind: "day", day: "2026-10-10" })).toBe("Sat, Oct 10, 2026");
    expect(periodLabel({ kind: "week", day: "2026-10-10" })).toBe("Oct 5 – Oct 11, 2026");
  });
});
