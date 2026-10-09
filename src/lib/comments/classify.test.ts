import { describe, expect, it } from "vitest";
import { classifyComment } from "./classify";

describe("classifyComment", () => {
  it("triages inbox comments", () => {
    expect(classifyComment("Lampunya pakai baterai atau USB?")).toBe("question");
    expect(classifyComment("gimana cara rapihin kabelnya")).toBe("question");
    expect(classifyComment("Saran: next video coba toples amber")).toBe("feedback");
    expect(classifyComment("Keren banget hasilnya 😍")).toBe("positive");
    expect(classifyComment("Ini scam, pasti beli baru")).toBe("needs_review");
    expect(classifyComment("cek https://spam.example")).toBe("needs_review");
    expect(classifyComment("hmm")).toBe("other");
  });
});
