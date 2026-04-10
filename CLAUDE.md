# CommonGround

AI-moderated disagreement platform where two users discuss a topic with every message reviewed by Claude before delivery.

## Quick Start

```bash
npm install
npm run dev          # Starts Next.js with Turbopack on localhost:3000
npm run test         # Vitest single run (48 tests)
npm run test:watch   # Vitest watch mode
npm run build        # Production build (Turbopack)
npm run lint         # ESLint
```

### Local Dev (No API Keys)

The app works without Supabase or Anthropic keys using mock mode:
- In-memory store replaces Supabase (`lib/mock-store.ts`)
- Mock moderator replaces Claude (rejects "bad"/"reject" keywords and >500 chars; extracts facts from "fact: ..." prefix)

### Full Setup

1. `supabase start` — starts local Supabase (gives you URL + keys)
2. Copy `.env.local.example` to `.env.local` and fill in values
3. Run migration: `supabase db reset` or apply `supabase/migrations/0001_init.sql`

## Tech Stack

- **Next.js 15** App Router, React 19, TypeScript, Turbopack
- **Tailwind CSS v4** with CSS custom properties (HSL), PostCSS plugin
- **shadcn/ui** (New York style, neutral base) — components in `components/ui/`
- **Supabase** PostgreSQL + Realtime subscriptions via `@supabase/ssr`
- **Anthropic SDK** (`@anthropic-ai/sdk`) — Claude claude-sonnet-4-6-20250514 for moderation
- **Vitest 4** for unit tests

## Architecture

### Routes

- `/` — Home page, create a new room
- `/room/[roomId]?user=A|B` — Discussion room (client component)
- `/api/health` — Health check (`{ status: "ok", timestamp }`)

### Core Flow

1. User submits draft via `Composer` → `submitDraft()` server action
2. `moderateMessage()` calls Claude (or mock) with rubric, recent messages, and established facts
3. Approved → message inserted into `main_messages`, visible to both users via Realtime
4. Rejected → side-chat opens with AI explanation, user revises (max 5 attempts)
5. Facts extracted from approved messages appear in `FactsSidebar`

### Key Files

| Path | Purpose |
|------|---------|
| `app/room/[roomId]/actions.ts` | Server actions: createRoom, submitDraft, abandonDraft, getRoomData |
| `lib/moderator.ts` | AI moderation (Claude API or mock fallback) |
| `lib/mock-store.ts` | In-memory store for local dev without Supabase |
| `lib/types.ts` | TypeScript types: Room, MainMessage, EstablishedFact, etc. |
| `lib/rubrics/default_v1.ts` | Moderation system prompt (5 revision rules) |
| `lib/supabase/client.ts` | Browser Supabase client |
| `lib/supabase/server.ts` | Server Supabase client with cookie management |

### Database Tables (Supabase)

`rooms`, `main_messages`, `established_facts`, `side_chat_messages`, `pending_drafts`, `moderation_decisions`

Realtime enabled on: `main_messages`, `established_facts`, `side_chat_messages`

Schema in `supabase/migrations/0001_init.sql`.

### Components

- `Composer` — Message input, switches between normal and side-chat (revision) mode
- `MainThread` — Approved messages with Realtime subscription, auto-scroll
- `FactsSidebar` — Established facts panel with Realtime subscription
- `SideChatPanel` — AI feedback during draft revision (max 5 attempts)

## Environment Variables

```
NEXT_PUBLIC_SUPABASE_URL      # Supabase project URL
NEXT_PUBLIC_SUPABASE_ANON_KEY # Supabase anon key
SUPABASE_SERVICE_ROLE_KEY     # Supabase service role key (server only)
ANTHROPIC_API_KEY             # Claude API key for moderation
```

All optional for local dev (mock mode activates automatically).

## Conventions

- Path alias: `@/*` maps to project root
- Server actions use `"use server"` directive
- Client components use `"use client"` directive
- shadcn/ui config in `components.json` (New York style, RSC enabled)
- CSS variables defined in `app/globals.css` (light + dark mode)
- Tests live next to source in `__tests__/` directories
