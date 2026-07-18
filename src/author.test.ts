import { describe, expect, it } from "vitest";
import { formatAuthorMeta, normalizeAuthorProfile, normalizeWordmark } from "./author";
import type { AuthorProfile } from "./domain";

const fallback: AuthorProfile = {
  name: "折页实验室",
  date: "2026年7月16日",
  column: "AI 小白教程",
  wordmark: "折",
};

describe("author profile customization", () => {
  it("migrates the previous combined meta and initials fields", () => {
    expect(normalizeAuthorProfile({
      name: "新的作者",
      meta: "2026年7月18日  ·  AI 实验",
      initials: "新",
    }, fallback)).toEqual({
      name: "新的作者",
      date: "2026年7月18日",
      column: "AI 实验",
      wordmark: "新",
      avatarDataUrl: undefined,
    });
  });

  it("keeps custom fields independent and accepts only raster data URLs", () => {
    const profile = normalizeAuthorProfile({
      name: "作者",
      date: "今天",
      column: "实测栏目",
      wordmark: "AI Lab",
      avatarDataUrl: "data:image/svg+xml;base64,PHN2Zz4=",
    }, fallback);
    expect(profile.wordmark).toBe("AI");
    expect(profile.avatarDataUrl).toBeUndefined();
    expect(formatAuthorMeta(profile)).toBe("今天 · 实测栏目");
  });

  it("supports a blank date or column without leaving a separator", () => {
    expect(formatAuthorMeta({ ...fallback, date: "" })).toBe("AI 小白教程");
    expect(formatAuthorMeta({ ...fallback, column: "" })).toBe("2026年7月16日");
    expect(normalizeWordmark("🧠AI")).toBe("🧠A");
  });
});
