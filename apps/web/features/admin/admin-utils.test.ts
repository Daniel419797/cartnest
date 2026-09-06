import { describe, expect, it } from "vitest";
import { nairaToMinor, percentageToBps } from "./admin-utils";

describe("FP10 admin input conversions", () => {
  it("converts human percentages to integer basis points", () => {
    expect(percentageToBps("7.5")).toBe(750);
    expect(percentageToBps("10.25")).toBe(1025);
    expect(percentageToBps("100")).toBe(10000);
  });

  it("rejects percentages above 100 or with excessive precision", () => {
    expect(percentageToBps("100.01")).toBeUndefined();
    expect(percentageToBps("7.555")).toBeUndefined();
    expect(percentageToBps("-1")).toBeUndefined();
  });

  it("converts Naira decimal input to integer kobo", () => {
    expect(nairaToMinor("500")).toBe("50000");
    expect(nairaToMinor("1,250.75")).toBe("125075");
    expect(nairaToMinor("0.50")).toBe("50");
  });

  it("rejects invalid Naira input instead of rounding floats", () => {
    expect(nairaToMinor("20.999")).toBeUndefined();
    expect(nairaToMinor("-10")).toBeUndefined();
    expect(nairaToMinor("NGN 20")).toBeUndefined();
  });
});
