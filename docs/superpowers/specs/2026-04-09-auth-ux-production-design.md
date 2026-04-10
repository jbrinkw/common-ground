# CommonGround: Auth, Core UX & Production Readiness

**Date:** 2026-04-09
**Status:** Approved
**Scope:** Authentication (Google OAuth + email/password), room management, dashboard, push notifications, mobile responsiveness, RLS, removal of mock mode.

---

## 1. Authentication

### Provider
Supabase Auth (native). No extra auth libraries.

### Methods
- **Google OAuth** via `supabase.auth.signInWithOAuth({ provider: 'google' })`
- **Email/password** via `supabase.auth.signUp()` / `supabase.auth.signInWithPassword()`

### Session Management
- `@supabase/ssr` handles cookies (already installed)
- Next.js middleware (`middleware.ts`) refreshes sessions on every request by calling `supabase.auth.getUser()`
- Middleware redirects unauthenticated users to `/login` (except public routes: `/login`, `/signup`, `/auth/*`)
- Middleware redirects authenticated users away from `/login`/`/signup` to `/`

### New Routes

| Route | Type | Purpose |
|-------|------|---------|
| `/login` | Page | Email/password form + Google OAuth button |
| `/signup` | Page | Email, password, display name + Google OAuth button |
| `/auth/callback` | Route handler | Exchanges OAuth code for session |
| `/auth/confirm` | Route handler | Handles email confirmation links |

### Login/Signup UI
Built with existing shadcn/ui components (Card, Input, Button). No third-party auth UI libraries.

---

## 2. Database Changes

### New Table: `profiles`

```sql
create table profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  avatar_url   text,
  created_at   timestamptz not null default now()
);
```

Auto-populated via a trigger on `auth.users` insert:
- Google OAuth: pulls `full_name` and `avatar_url` from user metadata
- Email/password: uses email prefix as initial display name

### New Table: `push_subscriptions`

```sql
create table push_subscriptions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references profiles(id) on delete cascade,
  endpoint   text not null,
  p256dh     text not null,
  auth       text not null,
  created_at timestamptz not null default now(),
  unique(user_id, endpoint)
);
```

### Schema Migration: Existing Tables

**`rooms`:**
- `user_a_id`: `text` -> `uuid references profiles(id)`
- `user_b_id`: `text` -> `uuid references profiles(id)`, **nullable** (null until someone joins)
- Add `invite_code text not null` (8-char alphanumeric, e.g. `ABCD1234`)
- Add `invite_token uuid not null default gen_random_uuid()` (for link-based invites)

**`main_messages`:**
- `sender_id`: `text` -> `uuid references profiles(id)`

**`side_chat_messages`:**
- `user_id`: `text` -> `uuid references profiles(id)`

**`pending_drafts`:**
- `user_id`: `text` -> `uuid references profiles(id)`

**`moderation_decisions`:**
- `user_id`: `text` -> `uuid references profiles(id)`

### RLS Policies

Enable RLS on all tables. Policies:

**`profiles`:**
- SELECT: anyone authenticated can read any profile (needed for display names)
- UPDATE: users can update their own profile only

**`rooms`:**
- SELECT: user is `user_a_id` or `user_b_id`
- INSERT: any authenticated user (creates as `user_a_id`)
- UPDATE: participants only (for joining as `user_b_id`)

**`main_messages`:**
- SELECT: user is a participant of the room
- INSERT: user is a participant of the room and `sender_id = auth.uid()`

**`established_facts`:**
- SELECT: user is a participant of the room

**`side_chat_messages`:**
- SELECT: `user_id = auth.uid()` (only see your own side-chat)
- INSERT: `user_id = auth.uid()`

**`pending_drafts`:**
- SELECT/INSERT/UPDATE/DELETE: `user_id = auth.uid()`

**`moderation_decisions`:**
- SELECT: `user_id = auth.uid()`

**`push_subscriptions`:**
- SELECT/INSERT/DELETE: `user_id = auth.uid()`

---

## 3. Room Creation & Joining

### Creating a Room
1. Authenticated user clicks "Create Room" on dashboard
2. Server action creates room: `user_a_id = auth.uid()`, `user_b_id = null`
3. Generates `invite_code` (8-char alphanumeric) and `invite_token` (UUID)
4. Returns both; UI shows a modal with copyable invite link and code

### Joining via Link
1. Creator shares URL: `/join/[inviteToken]`
2. Recipient clicks link; middleware redirects to `/login?next=/join/[token]` if not authenticated
3. After login, server action looks up room by `invite_token`, sets `user_b_id = auth.uid()`
4. Redirects to `/room/[roomId]`

### Joining via Code
1. Dashboard has "Join Room" input
2. User enters code, server action looks up room by `invite_code`
3. Validates: `user_b_id` is null, joiner is not `user_a_id`
4. Sets `user_b_id = auth.uid()`, redirects to `/room/[roomId]`

### Validation Rules
- Cannot join your own room
- Cannot join a room that already has two users
- Room page returns 403 if `auth.uid()` is not `user_a_id` or `user_b_id`

### New Route

| Route | Type | Purpose |
|-------|------|---------|
| `/join/[inviteToken]` | Page | Link-based join handler |

---

## 4. Dashboard

### Route
`/` (replaces current home page)

### Layout
Card grid of the user's rooms. Responsive: 1 column mobile, 2 tablet, 3 desktop.

### Room Card Contents
- Other person's display name (or "Waiting for someone to join..." if `user_b_id` is null)
- Room status badge (active / closed)
- Last message preview (truncated)
- Time since last activity
- Unread indicator if messages exist since user's last visit

### Actions
- "Create Room" button -> create room, show modal with invite link + code
- "Join Room" button -> text input for invite code
- Click room card -> navigate to `/room/[roomId]`

### Data Fetching
Server component queries rooms where `user_a_id = auth.uid() OR user_b_id = auth.uid()`, joined with `profiles` for display names, subquery for latest message timestamp. Sorted by most recent activity.

---

## 5. Push Notifications

### Flow
1. After login, client requests `Notification.requestPermission()`
2. If granted, subscribes via `pushManager.subscribe()` with VAPID public key
3. Subscription stored in `push_subscriptions` table
4. When a message passes moderation and is inserted into `main_messages`, server sends push to the other participant via `web-push` npm package
5. Service worker handles `push` event (shows notification) and `notificationclick` event (navigates to room)

### Notification Payload
```json
{
  "title": "CommonGround",
  "body": "Alice: I think we should consider...",
  "data": { "url": "/room/<roomId>" }
}
```

### New Environment Variables
- `NEXT_PUBLIC_VAPID_PUBLIC_KEY` — public key for push subscription
- `VAPID_PRIVATE_KEY` — private key for sending push (server only)

Generated once with `npx web-push generate-vapid-keys`.

### New Dependency
- `web-push` — server-side Web Push protocol implementation

---

## 6. Mobile Responsiveness

### Changes
- **FactsSidebar**: toggle button in room header on mobile (hidden by default), full sidebar on desktop
- **Composer**: fixed to bottom of viewport on mobile
- **MainThread**: fills height between header and composer
- **Dashboard**: card grid single-column on mobile, 2 on tablet, 3 on desktop
- **Login/Signup**: centered, width-constrained, works on all sizes

---

## 7. Component Changes

### Modified Components

| Component | Change |
|-----------|--------|
| `Composer` | Remove `userId` prop, get user from auth |
| `MainThread` | Display names from profiles instead of "User A/B", get `currentUserId` from auth |
| `SideChatPanel` | Remove `userId` prop, get from auth |
| `FactsSidebar` | Responsive layout (toggle on mobile) |
| `app/page.tsx` | Replace with dashboard |
| `app/room/[roomId]/page.tsx` | Remove `?user=` query param, determine role from auth |
| `app/room/[roomId]/actions.ts` | All actions call `auth.getUser()` instead of accepting `userId` param |

### New Components

| Component | Purpose |
|-----------|---------|
| `LoginForm` | Email/password inputs + Google OAuth button |
| `SignupForm` | Email, password, display name + Google OAuth button |
| `RoomCard` | Card for dashboard grid |
| `CreateRoomDialog` | Modal showing invite link + code after room creation |
| `JoinRoomForm` | Invite code text input |

---

## 8. Mock Mode Removal

Remove `lib/mock-store.ts` and all mock mode fallbacks throughout the codebase. The app requires Supabase and Anthropic API keys to run. Update CLAUDE.md quick start accordingly.

---

## 9. Server Action Changes

Every server action in `app/room/[roomId]/actions.ts` changes from accepting `userId` as a parameter to calling `supabase.auth.getUser()`:

```typescript
// Before
export async function submitDraft(roomId: string, userId: string, content: string) { ... }

// After
export async function submitDraft(roomId: string, content: string) {
  const supabase = await getSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");
  // use user.id instead of userId
}
```

This applies to: `submitDraft`, `abandonDraft`, `getRoomData`, `createRoom`.

---

## 10. Testing

- Update existing tests to use UUID user IDs instead of "A"/"B"
- Remove mock store tests
- New tests: auth flows (login, signup, session refresh)
- New tests: room joining (invite link, invite code, validation rules)
- New tests: push subscription CRUD
- New tests: RLS policies (user can only access their own data)

---

## 11. New Environment Variables Summary

| Variable | Scope | Purpose |
|----------|-------|---------|
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | Client + Server | Web Push subscription |
| `VAPID_PRIVATE_KEY` | Server only | Web Push sending |

Existing Supabase and Anthropic vars remain unchanged. Google OAuth is configured in Supabase dashboard (no app-level env var needed).

---

## 12. File Structure (New/Changed)

```
app/
  layout.tsx                    # (modified) auth-aware layout
  page.tsx                      # (replaced) dashboard with room grid
  login/page.tsx                # (new) login page
  signup/page.tsx               # (new) signup page
  auth/callback/route.ts        # (new) OAuth callback handler
  auth/confirm/route.ts         # (new) email confirmation handler
  join/[inviteToken]/page.tsx   # (new) invite link join handler
  room/[roomId]/
    page.tsx                    # (modified) auth-based user identity
    actions.ts                  # (modified) auth.getUser() in all actions
  sw.ts                         # (modified) push event handlers
middleware.ts                   # (new) auth session refresh + route protection
components/
  LoginForm.tsx                 # (new)
  SignupForm.tsx                # (new)
  RoomCard.tsx                  # (new)
  CreateRoomDialog.tsx          # (new)
  JoinRoomForm.tsx              # (new)
  Composer.tsx                  # (modified) remove userId prop
  MainThread.tsx                # (modified) display names, remove userId
  SideChatPanel.tsx             # (modified) remove userId prop
  FactsSidebar.tsx              # (modified) responsive toggle
lib/
  mock-store.ts                 # (deleted)
  types.ts                      # (modified) update user ID types to uuid
  supabase/server.ts            # (modified) auth-aware client
supabase/
  migrations/0002_auth.sql      # (new) profiles, push_subscriptions, RLS, schema changes
```
