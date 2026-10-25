import { describe, expect, it } from "vitest";
import { splitTone, systemPrompt } from "./prompt.js";

describe("the answer's tone", () => {
  it("takes the tone mark off the answer's first line", () => {
    expect(splitTone("⟦nada:menenangkan⟧\nIya, ngerti kok. Rugi segitu wajar bikin kepikiran.")).toEqual({
      text: "Iya, ngerti kok. Rugi segitu wajar bikin kepikiran.",
      tone: "menenangkan",
    });
    expect(splitTone("  ⟦ nada : Antusias ⟧ Wah, mantap!").tone).toBe("antusias");
  });

  it("reads an unknown or missing mark as the everyday tone, and drops a stray one", () => {
    expect(splitTone("⟦nada:sedih⟧\nHalo")).toEqual({ text: "Halo", tone: "santai" });
    expect(splitTone("Tanpa penanda.")).toEqual({ text: "Tanpa penanda.", tone: "santai" });
    expect(splitTone("Halo ⟦nada:tegas⟧ dunia").text).toBe("Halo dunia");
  });

  it("asks Claude for the mark and for rapport talk", () => {
    const s = systemPrompt();
    expect(s).toContain("⟦nada:santai⟧");
    expect(s).toContain("validasi → alasan berdasarkan data → alternatif");
  });
});
