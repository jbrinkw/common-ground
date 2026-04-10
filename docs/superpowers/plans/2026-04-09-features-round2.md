# Features Round 2: Topics, Unread, Archiving, Onboarding, Typing, Summary, Rubric Modes

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add room topics, unread indicators, room archiving, first-time onboarding, typing indicators, on-demand conversation summaries, and negotiable moderation modes.

**Architecture:** New columns on `rooms` table (topic, rubric negotiation), new `room_visits` table for unread tracking, Supabase Realtime Presence for typing indicators, Claude API call for on-demand summaries. Rubric mode changes require both participants to agree via a proposal/accept flow.

**Tech Stack:** Supabase PostgreSQL + Realtime Presence, Anthropic SDK, Next.js 15 App Router, shadcn/ui

---

## Phase 1: Room Topics

### Task 1: Database — Add topic column to rooms

**Files:**
- Create: `supabase/migrations/0003_room_topics.sql`

- [ ] **Step 1: Write migration**

```sql
-- supabase/migrations/0003_room_topics.sql
alter table rooms add column topic text;
```

- [ ] **Step 2: Apply locally**

Run: `supabase db reset`

- [ ] **Step 3: Apply to production**

Use Supabase MCP `apply_migration` with project_id `qbhedsutcfshiajpnjnx`, name `room_topics`, query `alter table rooms add column topic text;`

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0003_room_topics.sql
git commit -m "feat: add topic column to rooms table"
```

---

### Task 2: Update types and createRoom action

**Files:**
- Modify: `lib/types.ts`
- Modify: `app/room/[roomId]/actions.ts`

- [ ] **Step 1: Add topic to Room type**

In `lib/types.ts`, add `topic: string | null;` to the `Room` type after the `invite_token` field:

```typescript
export type Room = {
  id: string;
  created_at: string;
  user_a_id: string;
  user_b_id: string | null;
  rubric_id: string;
  status: "active" | "paused" | "closed";
  invite_code: string;
  invite_token: string;
  topic: string | null;
};
```

- [ ] **Step 2: Update createRoom to accept topic**

In `app/room/[roomId]/actions.ts`, change `createRoom`:

```typescript
export async function createRoom(topic?: string): Promise<
  { roomId: string; inviteCode: string; inviteToken: string } | { error: string }
> {
  try {
    const { supabase, user } = await getAuthUser();
    const inviteCode = generateInviteCode();

    const { data, error } = await supabase
      .from("rooms")
      .insert({
        user_a_id: user.id,
        invite_code: inviteCode,
        ...(topic ? { topic } : {}),
      })
      .select("id, invite_code, invite_token")
      .single();

    if (error) throw error;
    return {
      roomId: data.id,
      inviteCode: data.invite_code,
      inviteToken: data.invite_token,
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to create room";
    return { error: message };
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add lib/types.ts app/room/[roomId]/actions.ts
git commit -m "feat: add topic to Room type and createRoom action"
```

---

### Task 3: Topic input in CreateRoomDialog

**Files:**
- Modify: `components/CreateRoomDialog.tsx`

- [ ] **Step 1: Add topic input**

Add a text input before the Create Room button. Update `handleCreate` to pass topic to `createRoom(topic || undefined)`. Add state: `const [topic, setTopic] = useState("");`

```typescript
// In the return block, replace the Button-only return with:
return (
  <div className="flex flex-col gap-2">
    <Input
      value={topic}
      onChange={(e) => setTopic(e.target.value)}
      placeholder="What's this about? (optional)"
      className="min-h-[44px]"
    />
    <Button onClick={handleCreate} disabled={isCreating} className="w-full">
      {isCreating ? "Creating..." : "Create Room"}
    </Button>
    {error && <p className="text-sm text-destructive">{error}</p>}
  </div>
);
```

Update `handleCreate` line: `const res = await createRoom(topic || undefined);`

- [ ] **Step 2: Commit**

```bash
git add components/CreateRoomDialog.tsx
git commit -m "feat: add topic input to create room dialog"
```

---

### Task 4: Show topic in room header and dashboard cards

**Files:**
- Modify: `app/room/[roomId]/page.tsx`
- Modify: `components/RoomCard.tsx`

- [ ] **Step 1: Show topic in room header**

In `app/room/[roomId]/page.tsx`, add a `roomTopic` state. Set it from the room query: `setRoomTopic(room.topic ?? null)`. Display it in the header below "Talking with":

```typescript
<p className="text-xs text-muted-foreground truncate max-w-[200px] sm:max-w-none">
  Talking with {otherUserName}
  {roomTopic && <span className="ml-1">— {roomTopic}</span>}
</p>
```

- [ ] **Step 2: Show topic in RoomCard**

In `components/RoomCard.tsx`, display the topic below the other user's name if it exists:

```typescript
<CardTitle className="text-base">
  {room.other_user_display_name ?? "Waiting for someone to join..."}
</CardTitle>
{room.topic && (
  <p className="text-xs text-muted-foreground mt-0.5">{room.topic}</p>
)}
```

- [ ] **Step 3: Pass topic to moderator context**

In `app/room/[roomId]/actions.ts`, in `submitDraft`, fetch room topic from the participant check query (change `select("id")` to `select("id, topic")`). Pass it to `moderateMessage` by adding it to the rubric context. In `lib/moderator.ts`, add a topic context block:

```typescript
if (args.topic) {
  contextParts.push(`## Room topic\n${args.topic}`);
}
```

Add `topic?: string` to the moderateMessage args interface.

- [ ] **Step 4: Commit**

```bash
git add app/room/[roomId]/page.tsx components/RoomCard.tsx app/room/[roomId]/actions.ts lib/moderator.ts
git commit -m "feat: show room topic in header, cards, and pass to moderator"
```

---

## Phase 2: Unread Indicators

### Task 5: Database — room_visits table

**Files:**
- Create: `supabase/migrations/0004_room_visits.sql`

- [ ] **Step 1: Write migration**

```sql
-- supabase/migrations/0004_room_visits.sql
create table room_visits (
  user_id    uuid not null references profiles(id) on delete cascade,
  room_id    uuid not null references rooms(id) on delete cascade,
  last_seen  timestamptz not null default now(),
  primary key (user_id, room_id)
);

alter table room_visits enable row level security;
create policy "Users can manage own visits"
  on room_visits for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
```

- [ ] **Step 2: Apply locally and to production**

Run: `supabase db reset`

Use Supabase MCP for production.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0004_room_visits.sql
git commit -m "feat: add room_visits table for unread tracking"
```

---

### Task 6: Track visits and show unread badges

**Files:**
- Modify: `app/room/[roomId]/page.tsx`
- Modify: `app/room/[roomId]/actions.ts`
- Modify: `components/RoomCard.tsx`
- Modify: `lib/types.ts`

- [ ] **Step 1: Add markRoomVisited server action**

In `app/room/[roomId]/actions.ts`, add:

```typescript
export async function markRoomVisited(roomId: string) {
  const { supabase, user } = await getAuthUser();
  await supabase.from("room_visits").upsert(
    { user_id: user.id, room_id: roomId, last_seen: new Date().toISOString() },
    { onConflict: "user_id,room_id" }
  );
}
```

- [ ] **Step 2: Call markRoomVisited from room page**

In `app/room/[roomId]/page.tsx`, after successfully loading data, call the action:

```typescript
import { markRoomVisited } from "./actions";

// Inside loadData, after setMessages:
markRoomVisited(roomId).catch(() => {});
```

- [ ] **Step 3: Add has_unread to RoomWithDetails**

In `lib/types.ts`, add to `RoomWithDetails`:

```typescript
export type RoomWithDetails = Room & {
  other_user_display_name: string | null;
  last_message_content: string | null;
  last_message_at: string | null;
  has_unread: boolean;
};
```

- [ ] **Step 4: Update getDashboardRooms to check unread**

In `app/room/[roomId]/actions.ts`, in `getDashboardRooms`, also fetch room_visits for the current user:

```typescript
// After fetching latestMessages, fetch visits
const { data: visits } = await supabase
  .from("room_visits")
  .select("room_id, last_seen")
  .eq("user_id", user.id)
  .in("room_id", roomIds);

const visitByRoom = new Map<string, string>();
for (const v of visits ?? []) {
  visitByRoom.set(v.room_id, v.last_seen);
}

// In the return map, add:
return (rooms ?? []).map((room) => {
  // ...existing code...
  const lastVisit = visitByRoom.get(room.id);
  const hasUnread = latest?.created_at
    ? !lastVisit || new Date(latest.created_at) > new Date(lastVisit)
    : false;

  return {
    ...room,
    other_user_display_name: otherProfile?.display_name ?? null,
    last_message_content: latest?.content ?? null,
    last_message_at: latest?.created_at ?? null,
    has_unread: hasUnread,
  };
});
```

- [ ] **Step 5: Show unread dot on RoomCard**

In `components/RoomCard.tsx`, add an unread indicator:

```typescript
{room.has_unread && (
  <div className="w-2.5 h-2.5 rounded-full bg-[#2d8282] flex-shrink-0" />
)}
```

Add it next to the CardTitle, inside the flex container.

- [ ] **Step 6: Commit**

```bash
git add lib/types.ts app/room/[roomId]/actions.ts app/room/[roomId]/page.tsx components/RoomCard.tsx
git commit -m "feat: add unread indicators on dashboard room cards"
```

---

## Phase 3: Room Archiving

### Task 7: Archive/delete room actions and UI

**Files:**
- Modify: `app/room/[roomId]/actions.ts`
- Modify: `components/RoomCard.tsx`
- Modify: `app/room/[roomId]/page.tsx`

- [ ] **Step 1: Add archiveRoom and deleteRoom actions**

In `app/room/[roomId]/actions.ts`:

```typescript
export async function archiveRoom(roomId: string): Promise<{ success: boolean }> {
  try {
    const { supabase, user } = await getAuthUser();
    const { error } = await supabase
      .from("rooms")
      .update({ status: "closed" })
      .eq("id", roomId)
      .or(`user_a_id.eq.${user.id},user_b_id.eq.${user.id}`);
    if (error) throw error;
    return { success: true };
  } catch {
    return { success: false };
  }
}

export async function deleteRoom(roomId: string): Promise<{ success: boolean }> {
  try {
    const { supabase, user } = await getAuthUser();
    // Only room creator can delete
    const { error } = await supabase
      .from("rooms")
      .delete()
      .eq("id", roomId)
      .eq("user_a_id", user.id);
    if (error) throw error;
    return { success: true };
  } catch {
    return { success: false };
  }
}
```

- [ ] **Step 2: Add archive button to room header**

In `app/room/[roomId]/page.tsx`, add an "Archive" button in the header (next to the Facts toggle). When clicked, call `archiveRoom(roomId)` and redirect to dashboard.

```typescript
import { archiveRoom } from "./actions";

// In header, add:
<button
  className="text-xs text-muted-foreground hover:text-foreground min-h-[44px] px-2"
  onClick={async () => {
    if (confirm("Archive this conversation?")) {
      await archiveRoom(roomId);
      window.location.href = "/";
    }
  }}
>
  Archive
</button>
```

- [ ] **Step 3: Add delete button to RoomCard for empty/waiting rooms**

In `components/RoomCard.tsx`, add a small delete button (X) for rooms where `user_b_id` is null (waiting rooms only). Use `deleteRoom` action with confirmation.

```typescript
import { deleteRoom } from "@/app/room/[roomId]/actions";

// In the card, add a delete button for waiting rooms:
{!room.user_b_id && (
  <button
    className="text-xs text-muted-foreground hover:text-destructive"
    onClick={async (e) => {
      e.stopPropagation();
      if (confirm("Delete this room?")) {
        await deleteRoom(room.id);
        router.refresh();
      }
    }}
  >
    Delete
  </button>
)}
```

- [ ] **Step 4: Commit**

```bash
git add app/room/[roomId]/actions.ts app/room/[roomId]/page.tsx components/RoomCard.tsx
git commit -m "feat: add room archiving and deletion"
```

---

## Phase 4: Better Onboarding

### Task 8: Empty state with guided first-room flow

**Files:**
- Modify: `app/page.tsx`
- Modify: `components/CreateRoomDialog.tsx`

- [ ] **Step 1: Improve empty state on dashboard**

Replace the empty state in `app/page.tsx` with a more helpful guided flow:

```typescript
{rooms.length === 0 ? (
  <div className="max-w-md mx-auto text-center py-16">
    <div className="w-16 h-16 rounded-full bg-[#2d8282]/10 flex items-center justify-center mx-auto mb-6">
      <svg className="w-8 h-8 text-[#2d8282]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
      </svg>
    </div>
    <h2 className="font-[var(--font-display)] text-2xl mb-2">Start a conversation</h2>
    <p className="text-muted-foreground mb-6">
      Create a room and invite someone to discuss a topic. Every message
      is moderated by AI to keep things productive.
    </p>
    <div className="flex flex-col gap-3 items-center">
      <CreateRoomDialog />
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <span>or</span>
        <JoinRoomForm />
      </div>
    </div>
  </div>
) : (
  // ...existing grid
)}
```

- [ ] **Step 2: Commit**

```bash
git add app/page.tsx
git commit -m "feat: improve empty state with guided onboarding"
```

---

## Phase 5: Typing Indicators

### Task 9: Typing indicators via Supabase Realtime Presence

**Files:**
- Create: `components/TypingIndicator.tsx`
- Modify: `app/room/[roomId]/page.tsx`
- Modify: `components/Composer.tsx`

- [ ] **Step 1: Create TypingIndicator component**

```typescript
// components/TypingIndicator.tsx
"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export function TypingIndicator({
  roomId,
  currentUserId,
  otherUserName,
}: {
  roomId: string;
  currentUserId: string;
  otherUserName: string;
}) {
  const [isTyping, setIsTyping] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase.channel(`typing:${roomId}`, {
      config: { presence: { key: currentUserId } },
    });

    channel
      .on("presence", { event: "sync" }, () => {
        const state = channel.presenceState();
        const otherTyping = Object.entries(state).some(
          ([key, values]) =>
            key !== currentUserId &&
            (values as Array<{ typing?: boolean }>).some((v) => v.typing)
        );
        setIsTyping(otherTyping);
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [roomId, currentUserId]);

  if (!isTyping) return null;

  return (
    <div className="px-4 py-1">
      <p className="text-xs text-muted-foreground animate-pulse">
        {otherUserName} is typing...
      </p>
    </div>
  );
}

// Export a hook for the Composer to broadcast typing state
export function useTypingBroadcast(roomId: string, userId: string) {
  const [channel, setChannel] = useState<ReturnType<ReturnType<typeof createClient>["channel"]> | null>(null);

  useEffect(() => {
    const supabase = createClient();
    const ch = supabase.channel(`typing:${roomId}`, {
      config: { presence: { key: userId } },
    });
    ch.subscribe(async (status) => {
      if (status === "SUBSCRIBED") {
        await ch.track({ typing: false });
      }
    });
    setChannel(ch);
    return () => {
      supabase.removeChannel(ch);
    };
  }, [roomId, userId]);

  const setTyping = (typing: boolean) => {
    channel?.track({ typing });
  };

  return { setTyping };
}
```

- [ ] **Step 2: Add TypingIndicator to room page**

In `app/room/[roomId]/page.tsx`, add between MainThread and Composer:

```typescript
import { TypingIndicator } from "@/components/TypingIndicator";

// Between MainThread and Composer:
<TypingIndicator roomId={roomId} currentUserId={userId} otherUserName={otherUserName} />
```

- [ ] **Step 3: Broadcast typing state from Composer**

In `components/Composer.tsx`, use the `useTypingBroadcast` hook. When user types in the input, call `setTyping(true)`. Debounce to `setTyping(false)` after 2 seconds of inactivity. Stop typing on submit.

Add props `roomId` is already there. Add `userId` prop back to Composer (just for typing — it doesn't go to server actions). Or better: have the room page pass a `onTypingChange` callback.

Actually simplest: add `userId` as an optional prop to Composer just for typing presence:

```typescript
export function Composer({ roomId, userId }: { roomId: string; userId?: string }) {
```

Inside the component:

```typescript
import { useTypingBroadcast } from "@/components/TypingIndicator";

// Inside component body:
const { setTyping } = useTypingBroadcast(roomId, userId ?? "");
const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);

const handleInputChange = (value: string) => {
  setInput(value);
  if (userId) {
    setTyping(true);
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => setTyping(false), 2000);
  }
};
```

Update the Input onChange to use `handleInputChange`. On submit, call `setTyping(false)`.

Pass `userId` from room page: `<Composer roomId={roomId} userId={userId} />`

- [ ] **Step 4: Commit**

```bash
git add components/TypingIndicator.tsx components/Composer.tsx app/room/[roomId]/page.tsx
git commit -m "feat: add typing indicators via Supabase Realtime Presence"
```

---

## Phase 6: Conversation Summary

### Task 10: On-demand conversation summary

**Files:**
- Create: `app/room/[roomId]/summary-action.ts`
- Create: `components/ConversationSummary.tsx`
- Modify: `app/room/[roomId]/page.tsx`

- [ ] **Step 1: Create summary server action**

```typescript
// app/room/[roomId]/summary-action.ts
"use server";

import Anthropic from "@anthropic-ai/sdk";

async function getSupabase() {
  const { createClient } = await import("@/lib/supabase/server");
  return createClient();
}

export async function generateSummary(roomId: string): Promise<{ summary: string } | { error: string }> {
  try {
    const { createClient } = await import("@/lib/supabase/server");
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("Unauthorized");

    // Fetch room with profiles
    const { data: room } = await supabase
      .from("rooms")
      .select(`
        topic,
        user_a_profile:profiles!rooms_user_a_id_fkey(display_name),
        user_b_profile:profiles!rooms_user_b_id_fkey(display_name)
      `)
      .eq("id", roomId)
      .single();

    // Fetch all messages
    const { data: messages } = await supabase
      .from("main_messages")
      .select("sender_id, content, created_at")
      .eq("room_id", roomId)
      .order("created_at", { ascending: true });

    // Fetch established facts
    const { data: facts } = await supabase
      .from("established_facts")
      .select("content")
      .eq("room_id", roomId);

    if (!messages || messages.length === 0) {
      return { error: "No messages to summarize" };
    }

    const userAName = room?.user_a_profile?.display_name ?? "User A";
    const userBName = room?.user_b_profile?.display_name ?? "User B";

    const transcript = messages.map((m) => {
      const name = m.sender_id === room?.user_a_id ? userAName : userBName;
      return `${name}: ${m.content}`;
    }).join("\n");

    const factsText = (facts ?? []).map((f) => f.content).join("\n");

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return { error: "API key not configured" };

    const client = new Anthropic({ apiKey });
    const response = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1024,
      messages: [{
        role: "user",
        content: `Summarize this conversation between ${userAName} and ${userBName}${room?.topic ? ` about "${room.topic}"` : ""}.

## Conversation
${transcript}

${factsText ? `## Established Facts\n${factsText}` : ""}

Write a concise summary covering:
1. What was discussed
2. Key points each person made
3. What they agreed on (if anything)
4. What remains unresolved

Keep it to 3-5 short paragraphs. Be neutral — don't take sides.`,
      }],
    });

    const textBlock = response.content.find((b) => b.type === "text");
    const summary = textBlock && "text" in textBlock ? textBlock.text : "Could not generate summary";

    return { summary };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to generate summary";
    return { error: message };
  }
}
```

- [ ] **Step 2: Create ConversationSummary component**

```typescript
// components/ConversationSummary.tsx
"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { generateSummary } from "@/app/room/[roomId]/summary-action";

export function ConversationSummary({ roomId }: { roomId: string }) {
  const [open, setOpen] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleOpen = async () => {
    setOpen(true);
    setLoading(true);
    setError(null);

    const result = await generateSummary(roomId);
    if ("error" in result) {
      setError(result.error);
    } else {
      setSummary(result.summary);
    }
    setLoading(false);
  };

  return (
    <>
      <button
        className="text-xs text-muted-foreground hover:text-foreground min-h-[44px] px-2"
        onClick={handleOpen}
      >
        Summary
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => setOpen(false)}>
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
          <div
            className="relative bg-background rounded-xl border shadow-2xl max-w-lg w-full max-h-[80vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-6 border-b flex items-center justify-between shrink-0">
              <h2 className="font-[var(--font-display)] text-xl">Conversation Summary</h2>
              <button onClick={() => setOpen(false)} className="text-muted-foreground hover:text-foreground">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <ScrollArea className="flex-1 p-6">
              {loading && <p className="text-muted-foreground animate-pulse">Generating summary...</p>}
              {error && <p className="text-destructive">{error}</p>}
              {summary && (
                <div className="prose prose-sm dark:prose-invert max-w-none whitespace-pre-wrap">
                  {summary}
                </div>
              )}
            </ScrollArea>
            <div className="p-4 border-t shrink-0">
              <Button onClick={() => setOpen(false)} className="w-full">Close</Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
```

- [ ] **Step 3: Add Summary button to room header**

In `app/room/[roomId]/page.tsx`, import and add next to the Archive button:

```typescript
import { ConversationSummary } from "@/components/ConversationSummary";

// In header, add:
<ConversationSummary roomId={roomId} />
```

- [ ] **Step 4: Commit**

```bash
git add app/room/[roomId]/summary-action.ts components/ConversationSummary.tsx app/room/[roomId]/page.tsx
git commit -m "feat: add on-demand conversation summary via Claude"
```

---

## Phase 7: Negotiable Moderation Modes

### Task 11: Database — rubric modes and proposals

**Files:**
- Create: `supabase/migrations/0005_rubric_modes.sql`
- Create: `lib/rubrics/gentle_v1.ts`
- Create: `lib/rubrics/strict_v1.ts`
- Create: `lib/rubrics/minimal_v1.ts`

- [ ] **Step 1: Write migration**

```sql
-- supabase/migrations/0005_rubric_modes.sql
create table rubric_proposals (
  id            uuid primary key default gen_random_uuid(),
  room_id       uuid not null references rooms(id) on delete cascade,
  proposed_by   uuid not null references profiles(id),
  rubric_id     text not null,
  status        text not null default 'pending', -- pending | accepted | rejected
  created_at    timestamptz not null default now(),
  resolved_at   timestamptz
);

alter table rubric_proposals enable row level security;
create policy "Room participants can manage rubric proposals"
  on rubric_proposals for all to authenticated
  using (
    exists(
      select 1 from rooms
      where rooms.id = rubric_proposals.room_id
      and (rooms.user_a_id = (select auth.uid()) or rooms.user_b_id = (select auth.uid()))
    )
  )
  with check (
    exists(
      select 1 from rooms
      where rooms.id = rubric_proposals.room_id
      and (rooms.user_a_id = (select auth.uid()) or rooms.user_b_id = (select auth.uid()))
    )
  );

alter publication supabase_realtime add table rubric_proposals;
```

- [ ] **Step 2: Create rubric variants**

Create `lib/rubrics/gentle_v1.ts` — the current default (bouncer mode, 3 rules). Copy from `default_v1.ts` and rename the export to `GENTLE_RUBRIC_SYSTEM_PROMPT`.

Create `lib/rubrics/strict_v1.ts`:

```typescript
export const STRICT_RUBRIC_SYSTEM_PROMPT = `You are a conversation moderator for CommonGround. This room uses STRICT moderation — both participants agreed to higher standards.

## What to BLOCK

1. Direct insults or name-calling
2. Slurs, threats, or harassment
3. Blatantly lying about what the other person said
4. Profanity of any kind
5. Off-topic tangents (stay on the room topic)
6. Sarcasm or passive-aggressive tone
7. Dismissing the other person's feelings or perspective

## What to APPROVE

- On-topic, respectful messages
- Strong disagreement expressed constructively
- Emotional honesty without aggression
- Requests to change topic (must be acknowledged by both)

When in doubt, ask for revision. This mode prioritizes constructive dialogue over free expression.

## Response format
{
  "verdict": "approve" | "revise",
  "violated_rules": string[],
  "explanation": string,
  "suggested_revision": string,
  "proposed_fact_updates": string[]
}

Explanations: 1-2 sentences max. Suggested revisions should sound natural.`;
```

Create `lib/rubrics/minimal_v1.ts`:

```typescript
export const MINIMAL_RUBRIC_SYSTEM_PROMPT = `You are a conversation moderator for CommonGround. This room uses MINIMAL moderation — both participants agreed to very light oversight.

## What to BLOCK

1. Direct threats of violence or harm
2. Slurs

That's it. Everything else is approved.

## Response format
{
  "verdict": "approve" | "revise",
  "violated_rules": string[],
  "explanation": string,
  "suggested_revision": string,
  "proposed_fact_updates": string[]
}

Explanations: 1 sentence max.`;
```

- [ ] **Step 3: Apply migration locally and to production**

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0005_rubric_modes.sql lib/rubrics/gentle_v1.ts lib/rubrics/strict_v1.ts lib/rubrics/minimal_v1.ts
git commit -m "feat: add rubric variants (gentle, strict, minimal) and proposals table"
```

---

### Task 12: Rubric selection in moderator and proposal UI

**Files:**
- Modify: `lib/moderator.ts`
- Modify: `app/room/[roomId]/actions.ts`
- Create: `components/RubricSelector.tsx`
- Modify: `app/room/[roomId]/page.tsx`

- [ ] **Step 1: Update moderator to load rubric by ID**

In `lib/moderator.ts`, create a rubric lookup:

```typescript
import { DEFAULT_RUBRIC_SYSTEM_PROMPT } from "./rubrics/default_v1";
import { STRICT_RUBRIC_SYSTEM_PROMPT } from "./rubrics/strict_v1";
import { MINIMAL_RUBRIC_SYSTEM_PROMPT } from "./rubrics/minimal_v1";

function getRubricPrompt(rubricId: string): string {
  switch (rubricId) {
    case "strict_v1": return STRICT_RUBRIC_SYSTEM_PROMPT;
    case "minimal_v1": return MINIMAL_RUBRIC_SYSTEM_PROMPT;
    default: return DEFAULT_RUBRIC_SYSTEM_PROMPT;
  }
}
```

Use `getRubricPrompt(args.rubricId)` instead of always using `DEFAULT_RUBRIC_SYSTEM_PROMPT` in the API call.

- [ ] **Step 2: Add proposal actions**

In `app/room/[roomId]/actions.ts`:

```typescript
export async function proposeRubricChange(
  roomId: string,
  rubricId: string
): Promise<{ success: boolean } | { error: string }> {
  try {
    const { supabase, user } = await getAuthUser();
    await supabase.from("rubric_proposals").insert({
      room_id: roomId,
      proposed_by: user.id,
      rubric_id: rubricId,
    });
    return { success: true };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Failed to propose" };
  }
}

export async function respondToRubricProposal(
  proposalId: string,
  accept: boolean
): Promise<{ success: boolean } | { error: string }> {
  try {
    const { supabase, user } = await getAuthUser();

    if (accept) {
      // Get the proposal
      const { data: proposal } = await supabase
        .from("rubric_proposals")
        .select("room_id, rubric_id")
        .eq("id", proposalId)
        .eq("status", "pending")
        .single();

      if (!proposal) return { error: "Proposal not found" };

      // Update room rubric and mark proposal accepted
      await supabase
        .from("rooms")
        .update({ rubric_id: proposal.rubric_id })
        .eq("id", proposal.room_id);

      await supabase
        .from("rubric_proposals")
        .update({ status: "accepted", resolved_at: new Date().toISOString() })
        .eq("id", proposalId);
    } else {
      await supabase
        .from("rubric_proposals")
        .update({ status: "rejected", resolved_at: new Date().toISOString() })
        .eq("id", proposalId);
    }

    return { success: true };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Failed to respond" };
  }
}
```

- [ ] **Step 3: Create RubricSelector component**

```typescript
// components/RubricSelector.tsx
"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  proposeRubricChange,
  respondToRubricProposal,
} from "@/app/room/[roomId]/actions";

const RUBRIC_OPTIONS = [
  { id: "default_v1", label: "Standard", description: "Blocks insults, slurs, and misquoting" },
  { id: "strict_v1", label: "Strict", description: "Also blocks profanity, sarcasm, off-topic" },
  { id: "minimal_v1", label: "Minimal", description: "Only blocks threats and slurs" },
];

export function RubricSelector({
  roomId,
  currentRubricId,
  currentUserId,
}: {
  roomId: string;
  currentRubricId: string;
  currentUserId: string;
}) {
  const [open, setOpen] = useState(false);
  const [pendingProposal, setPendingProposal] = useState<{
    id: string;
    rubric_id: string;
    proposed_by: string;
  } | null>(null);

  // Listen for proposals via Realtime
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`rubric_proposals:${roomId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "rubric_proposals",
          filter: `room_id=eq.${roomId}`,
        },
        (payload) => {
          const proposal = payload.new as { id: string; rubric_id: string; proposed_by: string; status: string };
          if (proposal.status === "pending" && proposal.proposed_by !== currentUserId) {
            setPendingProposal(proposal);
          }
        }
      )
      .subscribe();

    // Also check for existing pending proposals
    supabase
      .from("rubric_proposals")
      .select("id, rubric_id, proposed_by")
      .eq("room_id", roomId)
      .eq("status", "pending")
      .order("created_at", { ascending: false })
      .limit(1)
      .then(({ data }) => {
        if (data?.[0] && data[0].proposed_by !== currentUserId) {
          setPendingProposal(data[0]);
        }
      });

    return () => { supabase.removeChannel(channel); };
  }, [roomId, currentUserId]);

  const currentLabel = RUBRIC_OPTIONS.find((r) => r.id === currentRubricId)?.label ?? "Standard";

  return (
    <>
      {/* Current mode badge + change button */}
      <button
        className="text-xs text-muted-foreground hover:text-foreground min-h-[44px] px-2 flex items-center gap-1"
        onClick={() => setOpen(!open)}
      >
        <Badge variant="outline" className="text-xs">{currentLabel}</Badge>
      </button>

      {/* Incoming proposal notification */}
      {pendingProposal && (
        <div className="absolute top-full right-0 mt-1 p-3 bg-background border rounded-lg shadow-lg z-50 w-64">
          <p className="text-sm mb-2">
            Partner wants to switch to{" "}
            <strong>{RUBRIC_OPTIONS.find((r) => r.id === pendingProposal.rubric_id)?.label}</strong> mode
          </p>
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={async () => {
                await respondToRubricProposal(pendingProposal.id, true);
                setPendingProposal(null);
                window.location.reload();
              }}
            >
              Accept
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={async () => {
                await respondToRubricProposal(pendingProposal.id, false);
                setPendingProposal(null);
              }}
            >
              Decline
            </Button>
          </div>
        </div>
      )}

      {/* Mode selector dropdown */}
      {open && (
        <div className="absolute top-full right-0 mt-1 p-2 bg-background border rounded-lg shadow-lg z-50 w-64">
          <p className="text-xs text-muted-foreground mb-2 px-2">Both people must agree to change mode</p>
          {RUBRIC_OPTIONS.map((opt) => (
            <button
              key={opt.id}
              className={`w-full text-left px-3 py-2 rounded text-sm hover:bg-accent ${
                opt.id === currentRubricId ? "bg-accent" : ""
              }`}
              disabled={opt.id === currentRubricId}
              onClick={async () => {
                await proposeRubricChange(roomId, opt.id);
                setOpen(false);
              }}
            >
              <p className="font-medium">{opt.label}</p>
              <p className="text-xs text-muted-foreground">{opt.description}</p>
            </button>
          ))}
        </div>
      )}
    </>
  );
}
```

- [ ] **Step 4: Add RubricSelector to room header**

In `app/room/[roomId]/page.tsx`, add a `rubricId` state, set from room query. Add `<RubricSelector>` in the header next to archive/summary buttons. Wrap the header buttons area in `relative` for the dropdown positioning.

- [ ] **Step 5: Pass rubricId through submitDraft**

In `submitDraft`, change the room query from `select("id")` to `select("id, topic, rubric_id")`. Pass `room.rubric_id` to `moderateMessage` as `rubricId`.

- [ ] **Step 6: Commit**

```bash
git add lib/moderator.ts lib/rubrics/ app/room/[roomId]/actions.ts components/RubricSelector.tsx app/room/[roomId]/page.tsx
git commit -m "feat: add negotiable moderation modes (standard, strict, minimal)"
```

---

## Phase 8: Final Build & Deploy

### Task 13: Build, test, deploy

- [ ] **Step 1: Run tests**

```bash
npx vitest run
```

- [ ] **Step 2: Build**

```bash
npx next build
```

- [ ] **Step 3: Deploy**

```bash
vercel deploy --prod --scope jbrinkws-projects --yes
```

- [ ] **Step 4: Update CLAUDE.md**

Add new features to the routes, key files, and architecture sections.
