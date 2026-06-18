import { describe, it, expect } from "vitest";
import { buildBriefingPrompt } from "./briefing-prompt";

describe("buildBriefingPrompt", () => {
  it("embeds the month and the serialized context", () => {
    const prompt = buildBriefingPrompt("MES: 2026-06\nPLANES:\n- RV Core", "2026-06");
    expect(prompt).toContain("2026-06");
    expect(prompt).toContain("RV Core");
  });

  it("asks for the agreed briefing sections and forbids inventing figures", () => {
    const prompt = buildBriefingPrompt("MES: 2026-06", "2026-06");
    expect(prompt.toLowerCase()).toContain("aportar");
    expect(prompt.toLowerCase()).toContain("señal");
    expect(prompt.toLowerCase()).toContain("desviac");
    expect(prompt.toLowerCase()).toContain("vigilar");
    expect(prompt.toLowerCase()).toContain("no inventes");
  });
});
