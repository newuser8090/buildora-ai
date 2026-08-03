// ---------------------------------------------------------------------------
// Gemini edit provider — unit tests (callGemini stubbed)
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  callGemini,
} from "../gemini-generation-provider";
import { geminiEditProvider } from "../gemini-edit-provider";
import type { EditProviderInput } from "@/features/ai-editing/types";

vi.mock("../gemini-generation-provider", () => ({
  callGemini: vi.fn(),
  sanitizePrompt: (p: string) => p,
}));

const callGeminiMock = vi.mocked(callGemini);

const INPUT: EditProviderInput = {
  prompt: "make it playful",
  target: {
    kind: "section",
    sectionId: "s-hero",
    type: "hero",
    props: {
      headline: "Old",
      primaryCta: { text: "Go", href: "#" },
    },
  },
};

beforeEach(() => {
  process.env.GEMINI_API_KEY = "test-key";
  callGeminiMock.mockReset();
});

afterEach(() => {
  delete process.env.GEMINI_API_KEY;
});

describe("geminiEditProvider", () => {
  it("returns normalized edits for a valid response", async () => {
    callGeminiMock.mockResolvedValue({
      edits: [{ type: "hero", props: { headline: "New AI headline" } }],
    });

    const result = await geminiEditProvider.editContent(INPUT);
    expect(result.source).toBe("gemini");
    expect(result.edits).toHaveLength(1);
    expect(result.edits[0].type).toBe("hero");
    expect(result.edits[0].props.headline).toBe("New AI headline");
  });

  it("falls back to the original content when the response is not a valid edit result", async () => {
    callGeminiMock.mockResolvedValue({ unexpected: true });

    const result = await geminiEditProvider.editContent(INPUT);
    expect(result.edits).toEqual([
      { type: "hero", props: { ...INPUT.target.props } },
    ]);
    expect(
      result.warnings.some((w) => w.includes("invalid")),
    ).toBe(true);
  });

  it("falls back to the original content when no edit matches the target type", async () => {
    callGeminiMock.mockResolvedValue({
      edits: [{ type: "footer", props: { text: "© new" } }],
    });

    const result = await geminiEditProvider.editContent(INPUT);
    expect(result.edits).toEqual([
      { type: "hero", props: { ...INPUT.target.props } },
    ]);
    expect(
      result.warnings.some((w) => w.includes("different section type")),
    ).toBe(true);
  });

  it("throws when no API key is configured", async () => {
    delete process.env.GEMINI_API_KEY;
    await expect(geminiEditProvider.editContent(INPUT)).rejects.toThrow(
      "GEMINI_API_KEY",
    );
  });

  it("throws on empty prompts", async () => {
    await expect(
      geminiEditProvider.editContent({ ...INPUT, prompt: "   " }),
    ).rejects.toThrow();
  });
});
