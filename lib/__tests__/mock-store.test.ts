import { describe, it, expect } from "vitest";

// We need to reimport to get a fresh module for each test suite,
// but since mock-store uses module-level arrays, we need to be
// aware that state accumulates across tests in the same run.
// We'll work around this by using unique room IDs.

import { mockStore } from "../mock-store";

describe("mockStore", () => {
  describe("rooms", () => {
    it("creates a room with correct fields", () => {
      const room = mockStore.createRoom("A", "B");
      expect(room.id).toBeTruthy();
      expect(room.user_a_id).toBe("A");
      expect(room.user_b_id).toBe("B");
      expect(room.status).toBe("active");
      expect(room.rubric_id).toBe("default_v1");
      expect(room.created_at).toBeTruthy();
    });

    it("retrieves a room by ID", () => {
      const room = mockStore.createRoom("X", "Y");
      const found = mockStore.getRoom(room.id);
      expect(found).toEqual(room);
    });

    it("returns undefined for nonexistent room", () => {
      const found = mockStore.getRoom("nonexistent-id");
      expect(found).toBeUndefined();
    });

    it("generates unique IDs for each room", () => {
      const r1 = mockStore.createRoom("A", "B");
      const r2 = mockStore.createRoom("C", "D");
      expect(r1.id).not.toBe(r2.id);
    });
  });

  describe("main messages", () => {
    it("inserts and retrieves messages in order", () => {
      const room = mockStore.createRoom("A", "B");
      mockStore.insertMainMessage(room.id, "A", "First", 0);
      mockStore.insertMainMessage(room.id, "B", "Second", 0);

      const messages = mockStore.getMainMessages(room.id);
      expect(messages).toHaveLength(2);
      expect(messages[0].content).toBe("First");
      expect(messages[1].content).toBe("Second");
      expect(messages[0].sender_id).toBe("A");
      expect(messages[1].sender_id).toBe("B");
    });

    it("returns empty array for room with no messages", () => {
      const room = mockStore.createRoom("A", "B");
      expect(mockStore.getMainMessages(room.id)).toEqual([]);
    });

    it("tracks revision count", () => {
      const room = mockStore.createRoom("A", "B");
      const msg = mockStore.insertMainMessage(room.id, "A", "Revised", 3);
      expect(msg.revision_count).toBe(3);
    });

    it("getRecentMainMessages returns limited results", () => {
      const room = mockStore.createRoom("A", "B");
      for (let i = 0; i < 5; i++) {
        mockStore.insertMainMessage(room.id, "A", `Message ${i}`, 0);
      }
      const recent = mockStore.getRecentMainMessages(room.id, 3);
      expect(recent).toHaveLength(3);
      expect(recent[0].content).toBe("Message 2");
      expect(recent[2].content).toBe("Message 4");
    });

    it("isolates messages between rooms", () => {
      const r1 = mockStore.createRoom("A", "B");
      const r2 = mockStore.createRoom("C", "D");
      mockStore.insertMainMessage(r1.id, "A", "Room 1 msg", 0);
      mockStore.insertMainMessage(r2.id, "C", "Room 2 msg", 0);

      expect(mockStore.getMainMessages(r1.id)).toHaveLength(1);
      expect(mockStore.getMainMessages(r1.id)[0].content).toBe("Room 1 msg");
      expect(mockStore.getMainMessages(r2.id)).toHaveLength(1);
      expect(mockStore.getMainMessages(r2.id)[0].content).toBe("Room 2 msg");
    });
  });

  describe("established facts", () => {
    it("inserts and retrieves facts", () => {
      const room = mockStore.createRoom("A", "B");
      const msg = mockStore.insertMainMessage(room.id, "A", "test", 0);
      mockStore.insertFact(room.id, "Water is wet", msg.id);

      const facts = mockStore.getFacts(room.id);
      expect(facts).toHaveLength(1);
      expect(facts[0].content).toBe("Water is wet");
      expect(facts[0].established_by_message_id).toBe(msg.id);
    });

    it("returns empty for room with no facts", () => {
      const room = mockStore.createRoom("A", "B");
      expect(mockStore.getFacts(room.id)).toEqual([]);
    });
  });

  describe("pending drafts", () => {
    it("creates a pending draft", () => {
      const room = mockStore.createRoom("A", "B");
      mockStore.upsertPendingDraft(room.id, "A", "draft", 1, "session-1");

      const draft = mockStore.getPendingDraft(room.id, "A");
      expect(draft).toBeDefined();
      expect(draft!.current_content).toBe("draft");
      expect(draft!.rejection_count).toBe(1);
      expect(draft!.draft_session_id).toBe("session-1");
    });

    it("updates an existing pending draft (upsert)", () => {
      const room = mockStore.createRoom("A", "B");
      mockStore.upsertPendingDraft(room.id, "A", "v1", 1, "s1");
      mockStore.upsertPendingDraft(room.id, "A", "v2", 2, "s1");

      const draft = mockStore.getPendingDraft(room.id, "A");
      expect(draft!.current_content).toBe("v2");
      expect(draft!.rejection_count).toBe(2);
    });

    it("deletes a pending draft", () => {
      const room = mockStore.createRoom("A", "B");
      mockStore.upsertPendingDraft(room.id, "A", "draft", 1, "s1");
      mockStore.deletePendingDraft(room.id, "A");

      expect(mockStore.getPendingDraft(room.id, "A")).toBeUndefined();
    });

    it("delete is a no-op for nonexistent draft", () => {
      const room = mockStore.createRoom("A", "B");
      // Should not throw
      mockStore.deletePendingDraft(room.id, "A");
      expect(mockStore.getPendingDraft(room.id, "A")).toBeUndefined();
    });

    it("isolates drafts between users in same room", () => {
      const room = mockStore.createRoom("A", "B");
      mockStore.upsertPendingDraft(room.id, "A", "A's draft", 1, "s1");
      mockStore.upsertPendingDraft(room.id, "B", "B's draft", 1, "s2");

      expect(mockStore.getPendingDraft(room.id, "A")!.current_content).toBe(
        "A's draft"
      );
      expect(mockStore.getPendingDraft(room.id, "B")!.current_content).toBe(
        "B's draft"
      );
    });
  });

  describe("side chat messages", () => {
    it("inserts and retrieves by user + session", () => {
      const room = mockStore.createRoom("A", "B");
      mockStore.insertSideChatMessage(room.id, "A", "user", "My draft", "s1");
      mockStore.insertSideChatMessage(
        room.id,
        "A",
        "ai",
        "Please revise.",
        "s1"
      );

      const msgs = mockStore.getSideChatMessages(room.id, "A", "s1");
      expect(msgs).toHaveLength(2);
      expect(msgs[0].role).toBe("user");
      expect(msgs[1].role).toBe("ai");
    });

    it("filters by user — does not return other user's messages", () => {
      const room = mockStore.createRoom("A", "B");
      mockStore.insertSideChatMessage(room.id, "A", "user", "A's msg", "s1");
      mockStore.insertSideChatMessage(room.id, "B", "user", "B's msg", "s2");

      expect(mockStore.getSideChatMessages(room.id, "A", "s1")).toHaveLength(1);
      expect(mockStore.getSideChatMessages(room.id, "B", "s2")).toHaveLength(1);
      expect(mockStore.getSideChatMessages(room.id, "A", "s2")).toHaveLength(0);
    });

    it("filters by draft session", () => {
      const room = mockStore.createRoom("A", "B");
      mockStore.insertSideChatMessage(room.id, "A", "user", "Session 1", "s1");
      mockStore.insertSideChatMessage(room.id, "A", "user", "Session 2", "s2");

      expect(mockStore.getSideChatMessages(room.id, "A", "s1")).toHaveLength(1);
      expect(mockStore.getSideChatMessages(room.id, "A", "s2")).toHaveLength(1);
    });

    it("returns empty for no matching messages", () => {
      const room = mockStore.createRoom("A", "B");
      expect(
        mockStore.getSideChatMessages(room.id, "A", "nonexistent")
      ).toEqual([]);
    });
  });
});
