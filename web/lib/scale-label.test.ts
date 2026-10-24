import { describe, expect, it } from "vitest";
import { scaleLabel } from "./api";

describe("price scale labels", () => {
  it("keeps prices in full below a hundred million", () => {
    expect(scaleLabel(81_234.5, 2)).toBe("81234.50");
    expect(scaleLabel(0.00001234, 8)).toBe("0.00001234");
    expect(scaleLabel(99_999_999, 0)).toBe("99999999");
  });
  it("shortens market caps and totals as TradingView does", () => {
    expect(scaleLabel(21_045_566_911.94, 2)).toBe("21.046B");
    expect(scaleLabel(3_250_000_000_000, 2)).toBe("3.250T");
    expect(scaleLabel(150_000_000, 2)).toBe("150.000M");
    expect(scaleLabel(-2_500_000_000, 2)).toBe("-2.500B");
  });
});
