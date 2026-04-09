import { describe, it, expect } from "vitest";
import { moderateMessage } from "../moderator";

describe("moderateMessage (mock mode, no ANTHROPIC_API_KEY)", () => {
  const baseArgs = {
    recentMainMessages: [] as Array<{ sender: string; content: string }>,
    establishedFacts: [] as string[],
    rubricId: "default_v1",
  };

  describe("approval", () => {
    it("approves a normal message", async () => {
      const result = await moderateMessage({
        ...baseArgs,
        draft: "I think we should discuss this calmly.",
      });
      expect(result.verdict).toBe("approve");
      expect(result.violated_rules).toEqual([]);
    });

    it("approves a short, clean message", async () => {
      const result = await moderateMessage({
        ...baseArgs,
        draft: "OK",
      });
      expect(result.verdict).toBe("approve");
    });

    it("approves a message at exactly 500 chars", async () => {
      const result = await moderateMessage({
        ...baseArgs,
        draft: "x".repeat(500),
      });
      expect(result.verdict).toBe("approve");
    });
  });

  describe("rejection", () => {
    it('rejects a message containing "bad"', async () => {
      const result = await moderateMessage({
        ...baseArgs,
        draft: "This is a bad argument.",
      });
      expect(result.verdict).toBe("revise");
      expect(result.violated_rules).toContain("inflammatory_language");
      expect(result.explanation).toBeTruthy();
      expect(result.suggested_revision).toBeDefined();
    });

    it('rejects a message containing "reject"', async () => {
      const result = await moderateMessage({
        ...baseArgs,
        draft: "I reject your premise entirely.",
      });
      expect(result.verdict).toBe("revise");
      expect(result.violated_rules).toContain("inflammatory_language");
    });

    it("rejects a message over 500 characters", async () => {
      const result = await moderateMessage({
        ...baseArgs,
        draft: "x".repeat(501),
      });
      expect(result.verdict).toBe("revise");
      expect(result.violated_rules).toContain("message_length");
    });

    it("rejects case-insensitively (BAD, Bad, bAd)", async () => {
      for (const word of ["BAD", "Bad", "bAd"]) {
        const result = await moderateMessage({
          ...baseArgs,
          draft: `This is ${word}.`,
        });
        expect(result.verdict).toBe("revise");
      }
    });

    it("provides a suggested revision that removes trigger words", async () => {
      const result = await moderateMessage({
        ...baseArgs,
        draft: "That's a bad take.",
      });
      expect(result.suggested_revision).not.toContain("bad");
      expect(result.suggested_revision).toContain("[constructive term]");
    });
  });

  describe("fact extraction", () => {
    it('extracts facts from "fact: X" messages', async () => {
      const result = await moderateMessage({
        ...baseArgs,
        draft: "fact: The earth orbits the sun",
      });
      expect(result.verdict).toBe("approve");
      expect(result.proposed_fact_updates).toEqual([
        "The earth orbits the sun",
      ]);
    });

    it("extracts facts case-insensitively", async () => {
      const result = await moderateMessage({
        ...baseArgs,
        draft: "FACT: Water is wet",
      });
      expect(result.verdict).toBe("approve");
      expect(result.proposed_fact_updates).toHaveLength(1);
      expect(result.proposed_fact_updates[0]).toBe("Water is wet");
    });

    it("returns empty facts for normal messages", async () => {
      const result = await moderateMessage({
        ...baseArgs,
        draft: "I agree with you.",
      });
      expect(result.proposed_fact_updates).toEqual([]);
    });
  });

  describe("with context", () => {
    it("works with recent messages in context", async () => {
      const result = await moderateMessage({
        ...baseArgs,
        draft: "I see your point.",
        recentMainMessages: [
          { sender: "B", content: "I think the deadline should be Friday." },
        ],
      });
      expect(result.verdict).toBe("approve");
    });

    it("works with established facts in context", async () => {
      const result = await moderateMessage({
        ...baseArgs,
        draft: "Given that, I agree.",
        establishedFacts: ["The project started on Monday."],
      });
      expect(result.verdict).toBe("approve");
    });

    it("works with side-chat history in context", async () => {
      const result = await moderateMessage({
        ...baseArgs,
        draft: "Let me rephrase: I disagree respectfully.",
        sideChatHistory: [
          {
            role: "ai" as const,
            content: "Your previous message was too aggressive.",
          },
        ],
      });
      expect(result.verdict).toBe("approve");
    });
  });
});
