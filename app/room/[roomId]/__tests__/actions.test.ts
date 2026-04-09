import { describe, it, expect } from "vitest";
import { mockStore } from "@/lib/mock-store";

// Server actions can be imported directly in vitest —
// the "use server" directive is ignored outside Next.js runtime.
// Since NEXT_PUBLIC_SUPABASE_URL is not set, all actions use mock store.
import {
  submitDraft,
  abandonDraft,
  createRoom,
  getRoomData,
} from "../actions";

describe("server actions (mock mode)", () => {
  describe("createRoom", () => {
    it("creates a room and returns roomId", async () => {
      const result = await createRoom();
      expect("roomId" in result).toBe(true);
      if ("roomId" in result) {
        expect(result.roomId).toBeTruthy();
        expect(typeof result.roomId).toBe("string");
        // Room should exist in mock store
        const room = mockStore.getRoom(result.roomId);
        expect(room).toBeDefined();
        expect(room!.user_a_id).toBe("A");
        expect(room!.user_b_id).toBe("B");
      }
    });
  });

  describe("submitDraft — approval flow", () => {
    it("approves a normal message", async () => {
      const roomResult = await createRoom();
      if (!("roomId" in roomResult)) throw new Error("Failed to create room");
      const { roomId } = roomResult;

      const result = await submitDraft(roomId, "A", "I think we should talk.");
      expect(result.status).toBe("approved");
      if (result.status === "approved") {
        expect(result.messageId).toBeTruthy();
      }

      // Message should appear in mock store
      const messages = mockStore.getMainMessages(roomId);
      expect(messages).toHaveLength(1);
      expect(messages[0].content).toBe("I think we should talk.");
      expect(messages[0].sender_id).toBe("A");
    });

    it("extracts facts and stores them", async () => {
      const roomResult = await createRoom();
      if (!("roomId" in roomResult)) throw new Error("Failed to create room");
      const { roomId } = roomResult;

      await submitDraft(roomId, "A", "fact: The sky is blue");

      const facts = mockStore.getFacts(roomId);
      expect(facts).toHaveLength(1);
      expect(facts[0].content).toBe("The sky is blue");
    });
  });

  describe("submitDraft — rejection flow", () => {
    it("rejects a bad message and returns explanation", async () => {
      const roomResult = await createRoom();
      if (!("roomId" in roomResult)) throw new Error("Failed to create room");
      const { roomId } = roomResult;

      const result = await submitDraft(
        roomId,
        "A",
        "This is a bad argument."
      );
      expect(result.status).toBe("revise");
      if (result.status === "revise") {
        expect(result.explanation).toBeTruthy();
        expect(result.rejectionCount).toBe(1);
        expect(result.draftSessionId).toBeTruthy();
      }

      // Message should NOT be in main thread
      expect(mockStore.getMainMessages(roomId)).toHaveLength(0);

      // Pending draft should exist
      const draft = mockStore.getPendingDraft(roomId, "A");
      expect(draft).toBeDefined();
      expect(draft!.rejection_count).toBe(1);
    });

    it("records both user draft and AI explanation in side-chat", async () => {
      const roomResult = await createRoom();
      if (!("roomId" in roomResult)) throw new Error("Failed to create room");
      const { roomId } = roomResult;

      const result = await submitDraft(
        roomId,
        "A",
        "This is bad."
      );
      if (result.status !== "revise") throw new Error("Expected revise");

      // Side-chat should have user's draft + AI explanation
      const sideChat = mockStore.getSideChatMessages(
        roomId,
        "A",
        result.draftSessionId
      );
      expect(sideChat).toHaveLength(2);
      expect(sideChat[0].role).toBe("user");
      expect(sideChat[0].content).toBe("This is bad.");
      expect(sideChat[1].role).toBe("ai");
      expect(sideChat[1].content).toBeTruthy();
    });
  });

  describe("submitDraft — revision flow", () => {
    it("approves a revised message and tracks revision count", async () => {
      const roomResult = await createRoom();
      if (!("roomId" in roomResult)) throw new Error("Failed to create room");
      const { roomId } = roomResult;

      // First attempt — rejected
      const r1 = await submitDraft(roomId, "A", "This is bad.");
      expect(r1.status).toBe("revise");
      if (r1.status !== "revise") throw new Error("Expected revise");

      // Second attempt — revised, approved
      const r2 = await submitDraft(
        roomId,
        "A",
        "I respectfully disagree.",
        r1.draftSessionId
      );
      expect(r2.status).toBe("approved");

      // Message should show revision_count = 1
      const messages = mockStore.getMainMessages(roomId);
      expect(messages).toHaveLength(1);
      expect(messages[0].revision_count).toBe(1);

      // Pending draft should be cleaned up
      expect(mockStore.getPendingDraft(roomId, "A")).toBeUndefined();
    });

    it("increments rejection count on multiple rejections", async () => {
      const roomResult = await createRoom();
      if (!("roomId" in roomResult)) throw new Error("Failed to create room");
      const { roomId } = roomResult;

      const r1 = await submitDraft(roomId, "A", "bad message 1");
      expect(r1.status).toBe("revise");
      if (r1.status !== "revise") throw new Error("Expected revise");
      expect(r1.rejectionCount).toBe(1);

      const r2 = await submitDraft(
        roomId,
        "A",
        "still bad message",
        r1.draftSessionId
      );
      expect(r2.status).toBe("revise");
      if (r2.status !== "revise") throw new Error("Expected revise");
      expect(r2.rejectionCount).toBe(2);
    });
  });

  describe("abandonDraft", () => {
    it("removes the pending draft", async () => {
      const roomResult = await createRoom();
      if (!("roomId" in roomResult)) throw new Error("Failed to create room");
      const { roomId } = roomResult;

      // Create a rejected draft
      await submitDraft(roomId, "A", "This is bad.");
      expect(mockStore.getPendingDraft(roomId, "A")).toBeDefined();

      // Abandon
      const result = await abandonDraft(roomId, "A");
      expect(result.success).toBe(true);
      expect(mockStore.getPendingDraft(roomId, "A")).toBeUndefined();
    });

    it("succeeds even if no pending draft exists", async () => {
      const roomResult = await createRoom();
      if (!("roomId" in roomResult)) throw new Error("Failed to create room");
      const result = await abandonDraft(roomResult.roomId, "A");
      expect(result.success).toBe(true);
    });
  });

  describe("getRoomData", () => {
    it("returns messages and facts for a room", async () => {
      const roomResult = await createRoom();
      if (!("roomId" in roomResult)) throw new Error("Failed to create room");
      const { roomId } = roomResult;

      await submitDraft(roomId, "A", "Hello world");
      await submitDraft(roomId, "B", "fact: Gravity exists");

      const data = await getRoomData(roomId);
      expect(data).not.toBeNull();
      expect(data!.messages.length).toBeGreaterThanOrEqual(2);
      expect(data!.facts.length).toBeGreaterThanOrEqual(1);
    });

    it("returns empty data for new room", async () => {
      const roomResult = await createRoom();
      if (!("roomId" in roomResult)) throw new Error("Failed to create room");

      const data = await getRoomData(roomResult.roomId);
      expect(data).not.toBeNull();
      expect(data!.messages).toHaveLength(0);
      expect(data!.facts).toHaveLength(0);
    });
  });

  describe("edge cases", () => {
    it("handles empty string gracefully", async () => {
      const roomResult = await createRoom();
      if (!("roomId" in roomResult)) throw new Error("Failed to create room");

      // Empty string should still go through the moderator (approved since
      // it's short and has no trigger words)
      const result = await submitDraft(roomResult.roomId, "A", "");
      expect(result.status).toBe("approved");
    });

    it("handles special characters in messages", async () => {
      const roomResult = await createRoom();
      if (!("roomId" in roomResult)) throw new Error("Failed to create room");

      const special = '<script>alert("xss")</script> & "quotes" \'single\'';
      const result = await submitDraft(roomResult.roomId, "A", special);
      expect(result.status).toBe("approved");

      // Content should be stored as-is (escaping happens at render time)
      const messages = mockStore.getMainMessages(roomResult.roomId);
      const found = messages.find((m) => m.content === special);
      expect(found).toBeDefined();
    });

    it("handles very long message", async () => {
      const roomResult = await createRoom();
      if (!("roomId" in roomResult)) throw new Error("Failed to create room");

      const result = await submitDraft(
        roomResult.roomId,
        "A",
        "a".repeat(10000)
      );
      expect(result.status).toBe("revise");
    });
  });
});
