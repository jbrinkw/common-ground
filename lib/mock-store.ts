/**
 * In-memory data store for local development without Supabase.
 * Data persists only for the lifetime of the dev server process.
 */

import { v4 as uuidv4 } from "uuid";
import type {
  Room,
  MainMessage,
  EstablishedFact,
  SideChatMessage,
  PendingDraft,
} from "./types";

const rooms: Room[] = [];
const mainMessages: MainMessage[] = [];
const establishedFacts: EstablishedFact[] = [];
const sideChatMessages: SideChatMessage[] = [];
const pendingDrafts: PendingDraft[] = [];

export const mockStore = {
  // Rooms
  createRoom(userAId: string, userBId: string): Room {
    const room: Room = {
      id: uuidv4(),
      created_at: new Date().toISOString(),
      user_a_id: userAId,
      user_b_id: userBId,
      rubric_id: "default_v1",
      status: "active",
    };
    rooms.push(room);
    return room;
  },

  getRoom(id: string): Room | undefined {
    return rooms.find((r) => r.id === id);
  },

  // Main Messages
  insertMainMessage(
    roomId: string,
    senderId: string,
    content: string,
    revisionCount: number
  ): MainMessage {
    const msg: MainMessage = {
      id: uuidv4(),
      room_id: roomId,
      sender_id: senderId,
      content,
      revision_count: revisionCount,
      created_at: new Date().toISOString(),
    };
    mainMessages.push(msg);
    return msg;
  },

  getMainMessages(roomId: string): MainMessage[] {
    return mainMessages
      .filter((m) => m.room_id === roomId)
      .sort(
        (a, b) =>
          new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      );
  },

  getRecentMainMessages(
    roomId: string,
    limit: number
  ): Array<{ sender: string; content: string }> {
    const msgs = this.getMainMessages(roomId);
    return msgs.slice(-limit).map((m) => ({
      sender: m.sender_id,
      content: m.content,
    }));
  },

  // Established Facts
  insertFact(
    roomId: string,
    content: string,
    messageId: string
  ): EstablishedFact {
    const fact: EstablishedFact = {
      id: uuidv4(),
      room_id: roomId,
      content,
      established_by_message_id: messageId,
      created_at: new Date().toISOString(),
    };
    establishedFacts.push(fact);
    return fact;
  },

  getFacts(roomId: string): EstablishedFact[] {
    return establishedFacts
      .filter((f) => f.room_id === roomId)
      .sort(
        (a, b) =>
          new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      );
  },

  // Side Chat Messages
  insertSideChatMessage(
    roomId: string,
    userId: string,
    role: "user" | "ai",
    content: string,
    draftSessionId: string
  ): SideChatMessage {
    const msg: SideChatMessage = {
      id: uuidv4(),
      room_id: roomId,
      user_id: userId,
      role,
      content,
      draft_session_id: draftSessionId,
      created_at: new Date().toISOString(),
    };
    sideChatMessages.push(msg);
    return msg;
  },

  getSideChatMessages(
    roomId: string,
    userId: string,
    draftSessionId: string
  ): SideChatMessage[] {
    return sideChatMessages
      .filter(
        (m) =>
          m.room_id === roomId &&
          m.user_id === userId &&
          m.draft_session_id === draftSessionId
      )
      .sort(
        (a, b) =>
          new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      );
  },

  // Pending Drafts
  getPendingDraft(
    roomId: string,
    userId: string
  ): PendingDraft | undefined {
    return pendingDrafts.find(
      (d) => d.room_id === roomId && d.user_id === userId
    );
  },

  upsertPendingDraft(
    roomId: string,
    userId: string,
    content: string,
    rejectionCount: number,
    draftSessionId: string
  ): void {
    const idx = pendingDrafts.findIndex(
      (d) => d.room_id === roomId && d.user_id === userId
    );
    const draft: PendingDraft = {
      id: idx >= 0 ? pendingDrafts[idx].id : uuidv4(),
      room_id: roomId,
      user_id: userId,
      current_content: content,
      rejection_count: rejectionCount,
      draft_session_id: draftSessionId,
      created_at:
        idx >= 0 ? pendingDrafts[idx].created_at : new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    if (idx >= 0) {
      pendingDrafts[idx] = draft;
    } else {
      pendingDrafts.push(draft);
    }
  },

  deletePendingDraft(roomId: string, userId: string): void {
    const idx = pendingDrafts.findIndex(
      (d) => d.room_id === roomId && d.user_id === userId
    );
    if (idx >= 0) {
      pendingDrafts.splice(idx, 1);
    }
  },
};
