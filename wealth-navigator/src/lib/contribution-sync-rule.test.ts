import { describe, it, expect } from "vitest";
import { feedsPortfolio } from "./contribution-sync-rule";

const now = new Date("2026-06-19T00:00:00Z");

describe("feedsPortfolio", () => {
  it("is true for the current month", () => {
    expect(feedsPortfolio("2026-06", now)).toBe(true);
  });
  it("is false for a past month", () => {
    expect(feedsPortfolio("2026-03", now)).toBe(false);
  });
  it("is false for a future month", () => {
    expect(feedsPortfolio("2026-07", now)).toBe(false);
  });
});
