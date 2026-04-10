# CommonGround

AI-moderated disagreement platform where two users discuss a topic with every message reviewed by Claude before delivery.

## Quick Start

```bash
npm install
npm run dev          # Starts Next.js with Turbopack on localhost:3000
npm run test         # Vitest single run
npm run test:watch   # Vitest watch mode
npm run build        # Production build (Turbopack)
npm run lint         # ESLint
```

### Setup

1. `supabase start` -- starts local Supabase (gives you URL + keys)
2. Copy `.env.local.example` to `.env.local` and fill in values
3. Run migration: `supabase db reset` or apply migrations in `supabase/migrations/`
4. Generate VAPID keys: `npx web-push generate-vapid-keys` and add to `.env.local`

### Authentication

The app uses Supabase Auth (email/password + Google OAuth). On first visit, unauthenticated users are redirected to `/login` by Next.js middleware. After signup, a `profiles` row is auto-created via a database trigger.

## Tech Stack

- **Next.js 15** App Router, React 19, TypeScript, Turbopack
- **Tailwind CSS v4** with CSS custom properties (HSL), PostCSS plugin
- **shadcn/ui** (New York style, neutral base) -- components in `components/ui/`
- **Supabase** PostgreSQL + Realtime subscriptions + Auth via `@supabase/ssr`
- **Anthropic SDK** (`@anthropic-ai/sdk`) -- Claude claude-sonnet-4-6-20250514 for moderation
- **Serwist** PWA service worker with push notification support
- **web-push** for server-side Web Push API notifications
- **Vitest 4** for unit tests

## Architecture

### Routes

- `/login` -- Login / signup page (email + Google OAuth)
- `/dashboard` -- Room list, create room, join by code
- `/room/[roomId]` -- Discussion room (client component, auth required)
- `/join/[token]` -- Invite link handler (redirects to room after joining)
- `/auth/callback` -- Supabase OAuth callback
- `/auth/confirm` -- Email confirmation handler
- `/api/health` -- Health check (`{ status: "ok", timestamp }`)

### Core Flow

1. User signs up/logs in via Supabase Auth
2. User creates a room from dashboard, gets invite link/code
3. Other user joins via invite link or code
4. User submits draft via `Composer` -> `submitDraft()` server action
5. `moderateMessage()` calls Claude with rubric, recent messages, and established facts
6. Approved -> message inserted into `main_messages`, push notification sent to other user
7. Rejected -> side-chat opens with AI explanation, user revises (max 5 attempts)
8. Facts extracted from approved messages appear in `FactsSidebar`

### Key Files

| Path | Purpose |
|------|---------|
| `middleware.ts` | Session refresh + route protection |
| `app/room/[roomId]/actions.ts` | Server actions: createRoom, submitDraft, abandonDraft, etc. |
| `app/room/[roomId]/push-actions.ts` | Push notification server actions |
| `lib/moderator.ts` | AI moderation (Claude API) |
| `lib/push.ts` | Web Push API server utility |
| `lib/push-client.ts` | Client-side push subscription registration |
| `lib/types.ts` | TypeScript types: Room, MainMessage, EstablishedFact, etc. |
| `lib/rubrics/default_v1.ts` | Moderation system prompt (5 revision rules) |
| `lib/supabase/client.ts` | Browser Supabase client |
| `lib/supabase/server.ts` | Server Supabase client with cookie management |
| `app/sw.ts` | Serwist service worker with push handlers |

### Database Tables (Supabase)

`rooms`, `main_messages`, `established_facts`, `side_chat_messages`, `pending_drafts`, `moderation_decisions`, `profiles`, `push_subscriptions`

Realtime enabled on: `main_messages`, `established_facts`, `side_chat_messages`

Schema in `supabase/migrations/`.

### Components

- `Composer` -- Message input, switches between normal and side-chat (revision) mode
- `MainThread` -- Approved messages with Realtime subscription, auto-scroll
- `FactsSidebar` -- Established facts panel with Realtime subscription
- `SideChatPanel` -- AI feedback during draft revision (max 5 attempts)

## Environment Variables

```
NEXT_PUBLIC_SUPABASE_URL        # Supabase project URL
NEXT_PUBLIC_SUPABASE_ANON_KEY   # Supabase anon key
SUPABASE_SERVICE_ROLE_KEY       # Supabase service role key (server only)
ANTHROPIC_API_KEY               # Claude API key for moderation
NEXT_PUBLIC_VAPID_PUBLIC_KEY    # VAPID public key for push notifications
VAPID_PRIVATE_KEY               # VAPID private key for push notifications (server only)
```

## Conventions

- Path alias: `@/*` maps to project root
- Server actions use `"use server"` directive
- Client components use `"use client"` directive
- shadcn/ui config in `components.json` (New York style, RSC enabled)
- CSS variables defined in `app/globals.css` (light + dark mode)
- Tests live next to source in `__tests__/` directories
