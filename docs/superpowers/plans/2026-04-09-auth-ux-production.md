# Auth, Core UX & Production Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add real authentication (Google OAuth + email/password), room management with invite links/codes, a dashboard, push notifications, mobile responsiveness, and RLS — replacing the current prototype query-param identity model.

**Architecture:** Supabase Auth via `@supabase/ssr` cookies, Next.js middleware for session refresh and route protection, RLS policies on all tables tied to `auth.uid()`. Push notifications via Web Push API + `web-push` npm package through the existing Serwist service worker.

**Tech Stack:** Supabase Auth, `@supabase/ssr`, `web-push`, Next.js 15 App Router, shadcn/ui, Serwist PWA

---

## Phase 1: Database & Auth Foundation

### Task 1: Database Migration — New Tables, Schema Changes, RLS

**Files:**
- Create: `supabase/migrations/0002_auth_and_rls.sql`

This is the largest single task but it's all SQL executed as one migration. It must run before any code changes.

- [ ] **Step 1: Write the migration file**

```sql
-- supabase/migrations/0002_auth_and_rls.sql
-- CommonGround: Auth, schema changes, and RLS policies

-- ============================================================
-- 1. New tables
-- ============================================================

create table profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  avatar_url   text,
  created_at   timestamptz not null default now()
);

create table push_subscriptions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references profiles(id) on delete cascade,
  endpoint   text not null,
  p256dh     text not null,
  auth       text not null,
  created_at timestamptz not null default now(),
  unique(user_id, endpoint)
);

-- ============================================================
-- 2. Auto-create profile on signup
-- ============================================================

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name, avatar_url)
  values (
    new.id,
    coalesce(
      new.raw_user_meta_data ->> 'full_name',
      new.raw_user_meta_data ->> 'display_name',
      split_part(new.email, '@', 1)
    ),
    new.raw_user_meta_data ->> 'avatar_url'
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================
-- 3. Drop existing data and recreate tables with proper types
--    (This is a breaking migration — existing data is wiped)
-- ============================================================

-- Drop dependent tables first (reverse order of FK deps)
drop table if exists moderation_decisions;
drop table if exists pending_drafts;
drop table if exists side_chat_messages;
drop table if exists established_facts;
drop table if exists main_messages;
drop table if exists rooms;

create table rooms (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  user_a_id     uuid not null references profiles(id),
  user_b_id     uuid references profiles(id),
  rubric_id     text not null default 'default_v1',
  status        text not null default 'active',
  invite_code   text not null,
  invite_token  uuid not null default gen_random_uuid()
);

create unique index idx_rooms_invite_code on rooms(invite_code);
create unique index idx_rooms_invite_token on rooms(invite_token);

create table main_messages (
  id              uuid primary key default gen_random_uuid(),
  room_id         uuid not null references rooms(id) on delete cascade,
  sender_id       uuid not null references profiles(id),
  content         text not null,
  revision_count  int not null default 0,
  created_at      timestamptz not null default now()
);

create index idx_main_messages_room on main_messages(room_id, created_at);

create table established_facts (
  id                        uuid primary key default gen_random_uuid(),
  room_id                   uuid not null references rooms(id) on delete cascade,
  content                   text not null,
  established_by_message_id uuid references main_messages(id),
  created_at                timestamptz not null default now()
);

create index idx_established_facts_room on established_facts(room_id, created_at);

create table side_chat_messages (
  id                uuid primary key default gen_random_uuid(),
  room_id           uuid not null references rooms(id) on delete cascade,
  user_id           uuid not null references profiles(id),
  role              text not null,
  content           text not null,
  draft_session_id  uuid not null,
  created_at        timestamptz not null default now()
);

create index idx_side_chat_room_user on side_chat_messages(room_id, user_id, draft_session_id, created_at);

create table pending_drafts (
  id               uuid primary key default gen_random_uuid(),
  room_id          uuid not null references rooms(id) on delete cascade,
  user_id          uuid not null references profiles(id),
  current_content  text not null,
  rejection_count  int not null default 0,
  draft_session_id uuid not null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique(room_id, user_id)
);

create table moderation_decisions (
  id            uuid primary key default gen_random_uuid(),
  room_id       uuid not null references rooms(id) on delete cascade,
  user_id       uuid not null references profiles(id),
  draft_content text not null,
  verdict       text not null,
  violated_rules jsonb,
  explanation   text,
  model         text not null,
  latency_ms    int,
  created_at    timestamptz not null default now()
);

create index idx_moderation_decisions_room on moderation_decisions(room_id, created_at);

-- Re-enable Realtime
alter publication supabase_realtime add table main_messages;
alter publication supabase_realtime add table established_facts;
alter publication supabase_realtime add table side_chat_messages;

-- ============================================================
-- 4. RLS policies
-- ============================================================

-- Helper: check if user is a participant of a room
create or replace function public.is_room_participant(p_room_id uuid, p_user_id uuid)
returns boolean
language sql
security definer
stable
as $$
  select exists(
    select 1 from public.rooms
    where id = p_room_id
    and (user_a_id = p_user_id or user_b_id = p_user_id)
  );
$$;

-- profiles
alter table profiles enable row level security;
create policy "Authenticated users can read any profile"
  on profiles for select to authenticated using (true);
create policy "Users can update own profile"
  on profiles for update to authenticated using ((select auth.uid()) = id);

-- rooms
alter table rooms enable row level security;
create policy "Participants can view their rooms"
  on rooms for select to authenticated
  using (user_a_id = (select auth.uid()) or user_b_id = (select auth.uid()));
create policy "Authenticated users can create rooms"
  on rooms for insert to authenticated
  with check (user_a_id = (select auth.uid()));
create policy "Participants can update rooms"
  on rooms for update to authenticated
  using (user_a_id = (select auth.uid()) or user_b_id = (select auth.uid()));
-- Allow reading rooms by invite_token for joining (before user_b is set)
create policy "Anyone can read rooms by invite token for joining"
  on rooms for select to authenticated
  using (user_b_id is null);

-- main_messages
alter table main_messages enable row level security;
create policy "Room participants can read messages"
  on main_messages for select to authenticated
  using (public.is_room_participant(room_id, (select auth.uid())));
create policy "Room participants can insert own messages"
  on main_messages for insert to authenticated
  with check (
    public.is_room_participant(room_id, (select auth.uid()))
    and sender_id = (select auth.uid())
  );

-- established_facts
alter table established_facts enable row level security;
create policy "Room participants can read facts"
  on established_facts for select to authenticated
  using (public.is_room_participant(room_id, (select auth.uid())));
create policy "Room participants can insert facts"
  on established_facts for insert to authenticated
  with check (public.is_room_participant(room_id, (select auth.uid())));

-- side_chat_messages
alter table side_chat_messages enable row level security;
create policy "Users can read own side chat"
  on side_chat_messages for select to authenticated
  using (user_id = (select auth.uid()));
create policy "Users can insert own side chat"
  on side_chat_messages for insert to authenticated
  with check (user_id = (select auth.uid()));

-- pending_drafts
alter table pending_drafts enable row level security;
create policy "Users can manage own drafts"
  on pending_drafts for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- moderation_decisions
alter table moderation_decisions enable row level security;
create policy "Users can read own moderation decisions"
  on moderation_decisions for select to authenticated
  using (user_id = (select auth.uid()));
create policy "Users can insert own moderation decisions"
  on moderation_decisions for insert to authenticated
  with check (user_id = (select auth.uid()));

-- push_subscriptions
alter table push_subscriptions enable row level security;
create policy "Users can manage own push subscriptions"
  on push_subscriptions for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
```

- [ ] **Step 2: Apply migration to local Supabase**

Run: `supabase db reset`
Expected: All tables recreated with new schema, RLS enabled, trigger installed.

- [ ] **Step 3: Apply migration to production Supabase**

Use the Supabase MCP `apply_migration` tool with project_id `qbhedsutcfshiajpnjnx`, name `auth_and_rls`, and the full SQL from step 1.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0002_auth_and_rls.sql
git commit -m "feat: add profiles, push_subscriptions, RLS policies, uuid user IDs"
```

---

### Task 2: Update Types

**Files:**
- Modify: `lib/types.ts`

- [ ] **Step 1: Update type definitions**

Replace the entire contents of `lib/types.ts`:

```typescript
export type Profile = {
  id: string;
  display_name: string;
  avatar_url: string | null;
  created_at: string;
};

export type Room = {
  id: string;
  created_at: string;
  user_a_id: string;
  user_b_id: string | null;
  rubric_id: string;
  status: "active" | "paused" | "closed";
  invite_code: string;
  invite_token: string;
};

export type MainMessage = {
  id: string;
  room_id: string;
  sender_id: string;
  content: string;
  revision_count: number;
  created_at: string;
};

export type EstablishedFact = {
  id: string;
  room_id: string;
  content: string;
  established_by_message_id: string | null;
  created_at: string;
};

export type SideChatMessage = {
  id: string;
  room_id: string;
  user_id: string;
  role: "user" | "ai";
  content: string;
  draft_session_id: string;
  created_at: string;
};

export type PendingDraft = {
  id: string;
  room_id: string;
  user_id: string;
  current_content: string;
  rejection_count: number;
  draft_session_id: string;
  created_at: string;
  updated_at: string;
};

export type ModerationDecision = {
  id: string;
  room_id: string;
  user_id: string;
  draft_content: string;
  verdict: "approve" | "revise";
  violated_rules: string[] | null;
  explanation: string | null;
  model: string;
  latency_ms: number | null;
  created_at: string;
};

export type ModeratorVerdict = {
  verdict: "approve" | "revise";
  violated_rules: string[];
  explanation: string;
  suggested_revision?: string;
  proposed_fact_updates: string[];
};

export type PushSubscription = {
  id: string;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  created_at: string;
};

// Room with joined profile data for dashboard display
export type RoomWithDetails = Room & {
  other_user_display_name: string | null;
  last_message_content: string | null;
  last_message_at: string | null;
};
```

- [ ] **Step 2: Commit**

```bash
git add lib/types.ts
git commit -m "feat: update types for auth (Profile, PushSubscription, nullable user_b_id)"
```

---

### Task 3: Auth Middleware

**Files:**
- Create: `middleware.ts`

- [ ] **Step 1: Create the middleware**

```typescript
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // IMPORTANT: Do not add code between createServerClient and auth.getUser()
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

  // Public routes that don't require auth
  const isPublicRoute =
    pathname.startsWith("/login") ||
    pathname.startsWith("/signup") ||
    pathname.startsWith("/auth/") ||
    pathname.startsWith("/api/health");

  if (!user && !isPublicRoute) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    // Preserve the intended destination for post-login redirect
    if (pathname !== "/") {
      url.searchParams.set("next", pathname);
    }
    return NextResponse.redirect(url);
  }

  // Redirect authenticated users away from login/signup
  if (user && (pathname === "/login" || pathname === "/signup")) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$|sw\\.js|manifest\\.json).*)",
  ],
};
```

- [ ] **Step 2: Verify build compiles**

Run: `npx next build 2>&1 | head -20`
Expected: Compiles without errors.

- [ ] **Step 3: Commit**

```bash
git add middleware.ts
git commit -m "feat: add auth middleware for session refresh and route protection"
```

---

### Task 4: Auth Callback & Confirm Routes

**Files:**
- Create: `app/auth/callback/route.ts`
- Create: `app/auth/confirm/route.ts`

- [ ] **Step 1: Create OAuth callback route**

```typescript
// app/auth/callback/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth_failed`);
}
```

- [ ] **Step 2: Create email confirm route**

```typescript
// app/auth/confirm/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as "email" | "recovery" | null;

  if (tokenHash && type) {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
    if (!error) {
      return NextResponse.redirect(`${origin}/`);
    }
  }

  return NextResponse.redirect(`${origin}/login?error=confirmation_failed`);
}
```

- [ ] **Step 3: Commit**

```bash
git add app/auth/callback/route.ts app/auth/confirm/route.ts
git commit -m "feat: add OAuth callback and email confirm route handlers"
```

---

### Task 5: Login & Signup Pages

**Files:**
- Create: `components/LoginForm.tsx`
- Create: `components/SignupForm.tsx`
- Create: `app/login/page.tsx`
- Create: `app/signup/page.tsx`

- [ ] **Step 1: Create LoginForm component**

```typescript
// components/LoginForm.tsx
"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get("next") ?? "/";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleEmailLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }

    router.push(next);
    router.refresh();
  };

  const handleGoogleLogin = async () => {
    const supabase = createClient();
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
      },
    });
  };

  return (
    <Card className="w-full max-w-md">
      <CardHeader className="text-center">
        <CardTitle className="text-2xl">Welcome back</CardTitle>
        <CardDescription>Sign in to CommonGround</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <Button variant="outline" onClick={handleGoogleLogin} className="w-full">
          Continue with Google
        </Button>

        <div className="flex items-center gap-2">
          <Separator className="flex-1" />
          <span className="text-xs text-muted-foreground">or</span>
          <Separator className="flex-1" />
        </div>

        <form onSubmit={handleEmailLogin} className="flex flex-col gap-3">
          <Input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <Input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          {error && (
            <p className="text-sm text-destructive text-center">{error}</p>
          )}
          <Button type="submit" disabled={loading} className="w-full">
            {loading ? "Signing in..." : "Sign in"}
          </Button>
        </form>

        <p className="text-center text-sm text-muted-foreground">
          Don&apos;t have an account?{" "}
          <a href="/signup" className="text-primary underline">
            Sign up
          </a>
        </p>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: Create SignupForm component**

```typescript
// components/SignupForm.tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

export function SignupForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  const handleEmailSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const supabase = createClient();
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { display_name: displayName },
        emailRedirectTo: `${window.location.origin}/auth/confirm`,
      },
    });

    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }

    setSuccess(true);
    setLoading(false);
  };

  const handleGoogleSignup = async () => {
    const supabase = createClient();
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    });
  };

  if (success) {
    return (
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle>Check your email</CardTitle>
          <CardDescription>
            We sent a confirmation link to {email}. Click it to activate your account.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card className="w-full max-w-md">
      <CardHeader className="text-center">
        <CardTitle className="text-2xl">Create an account</CardTitle>
        <CardDescription>Join CommonGround</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <Button variant="outline" onClick={handleGoogleSignup} className="w-full">
          Continue with Google
        </Button>

        <div className="flex items-center gap-2">
          <Separator className="flex-1" />
          <span className="text-xs text-muted-foreground">or</span>
          <Separator className="flex-1" />
        </div>

        <form onSubmit={handleEmailSignup} className="flex flex-col gap-3">
          <Input
            type="text"
            placeholder="Display name"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            required
          />
          <Input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <Input
            type="password"
            placeholder="Password (min 6 characters)"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            minLength={6}
            required
          />
          {error && (
            <p className="text-sm text-destructive text-center">{error}</p>
          )}
          <Button type="submit" disabled={loading} className="w-full">
            {loading ? "Creating account..." : "Sign up"}
          </Button>
        </form>

        <p className="text-center text-sm text-muted-foreground">
          Already have an account?{" "}
          <a href="/login" className="text-primary underline">
            Sign in
          </a>
        </p>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 3: Create login page**

```typescript
// app/login/page.tsx
import { LoginForm } from "@/components/LoginForm";

export default function LoginPage() {
  return (
    <div className="min-h-screen flex items-center justify-center p-8">
      <LoginForm />
    </div>
  );
}
```

- [ ] **Step 4: Create signup page**

```typescript
// app/signup/page.tsx
import { SignupForm } from "@/components/SignupForm";

export default function SignupPage() {
  return (
    <div className="min-h-screen flex items-center justify-center p-8">
      <SignupForm />
    </div>
  );
}
```

- [ ] **Step 5: Commit**

```bash
git add components/LoginForm.tsx components/SignupForm.tsx app/login/page.tsx app/signup/page.tsx
git commit -m "feat: add login and signup pages with email/password and Google OAuth"
```

---

## Phase 2: Room Management & Dashboard

### Task 6: Server Actions — Auth-Aware Rewrite

**Files:**
- Modify: `app/room/[roomId]/actions.ts`
- Delete: `lib/mock-store.ts`

- [ ] **Step 1: Delete mock store**

```bash
rm lib/mock-store.ts
```

- [ ] **Step 2: Rewrite actions.ts**

Replace the entire contents of `app/room/[roomId]/actions.ts`:

```typescript
"use server";

import { moderateMessage } from "@/lib/moderator";
import { v4 as uuidv4 } from "uuid";
import type { ModeratorVerdict } from "@/lib/types";

async function getSupabase() {
  const { createClient } = await import("@/lib/supabase/server");
  return createClient();
}

async function getAuthUser() {
  const supabase = await getSupabase();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) throw new Error("Unauthorized");
  return { supabase, user };
}

function generateInviteCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 8; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

export type SubmitDraftResult =
  | { status: "approved"; messageId: string }
  | {
      status: "revise";
      explanation: string;
      suggestedRevision?: string;
      rejectionCount: number;
      draftSessionId: string;
    }
  | { status: "error"; message: string };

export async function submitDraft(
  roomId: string,
  content: string,
  existingDraftSessionId?: string
): Promise<SubmitDraftResult> {
  try {
    const { supabase, user } = await getAuthUser();
    const userId = user.id;

    // Verify user is a participant
    const { data: room } = await supabase
      .from("rooms")
      .select("id")
      .eq("id", roomId)
      .or(`user_a_id.eq.${userId},user_b_id.eq.${userId}`)
      .single();

    if (!room) throw new Error("Not a participant of this room");

    // Load context
    const { data: recentMessages } = await supabase
      .from("main_messages")
      .select("sender_id, content")
      .eq("room_id", roomId)
      .order("created_at", { ascending: false })
      .limit(20);

    const mainMessages = (recentMessages ?? [])
      .reverse()
      .map((m) => ({ sender: m.sender_id, content: m.content }));

    const { data: facts } = await supabase
      .from("established_facts")
      .select("content")
      .eq("room_id", roomId)
      .order("created_at", { ascending: true });

    const establishedFacts = (facts ?? []).map((f) => f.content);

    let sideChatHistory: Array<{ role: "user" | "ai"; content: string }> = [];
    const draftSessionId = existingDraftSessionId ?? uuidv4();

    if (existingDraftSessionId) {
      const { data: sideChat } = await supabase
        .from("side_chat_messages")
        .select("role, content")
        .eq("room_id", roomId)
        .eq("user_id", userId)
        .eq("draft_session_id", existingDraftSessionId)
        .order("created_at", { ascending: true });

      sideChatHistory = (sideChat ?? []).map((m) => ({
        role: m.role as "user" | "ai",
        content: m.content,
      }));
    }

    // Moderate
    const startTime = Date.now();
    const verdict: ModeratorVerdict = await moderateMessage({
      draft: content,
      recentMainMessages: mainMessages,
      establishedFacts,
      sideChatHistory: sideChatHistory.length > 0 ? sideChatHistory : undefined,
      rubricId: "default_v1",
    });
    const latencyMs = Date.now() - startTime;

    // Get current rejection count
    const { data: existingDraft } = await supabase
      .from("pending_drafts")
      .select("rejection_count")
      .eq("room_id", roomId)
      .eq("user_id", userId)
      .single();

    const currentRejectionCount = existingDraft?.rejection_count ?? 0;

    // Log moderation decision
    await supabase.from("moderation_decisions").insert({
      room_id: roomId,
      user_id: userId,
      draft_content: content,
      verdict: verdict.verdict,
      violated_rules: verdict.violated_rules,
      explanation: verdict.explanation,
      model: "claude-haiku-4-5-20251001",
      latency_ms: latencyMs,
    });

    if (verdict.verdict === "approve") {
      const { data: newMessage, error: insertError } = await supabase
        .from("main_messages")
        .insert({
          room_id: roomId,
          sender_id: userId,
          content,
          revision_count: currentRejectionCount,
        })
        .select("id")
        .single();

      if (insertError || !newMessage) {
        throw insertError ?? new Error("Failed to insert message");
      }

      if (verdict.proposed_fact_updates.length > 0) {
        const factInserts = verdict.proposed_fact_updates.map((fact) => ({
          room_id: roomId,
          content: fact,
          established_by_message_id: newMessage.id,
        }));
        await supabase.from("established_facts").insert(factInserts);
      }

      await supabase
        .from("pending_drafts")
        .delete()
        .eq("room_id", roomId)
        .eq("user_id", userId);

      return { status: "approved", messageId: newMessage.id };
    } else {
      const newRejectionCount = currentRejectionCount + 1;

      await supabase.from("pending_drafts").upsert(
        {
          room_id: roomId,
          user_id: userId,
          current_content: content,
          rejection_count: newRejectionCount,
          draft_session_id: draftSessionId,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "room_id,user_id" }
      );

      await supabase.from("side_chat_messages").insert({
        room_id: roomId,
        user_id: userId,
        role: "user",
        content,
        draft_session_id: draftSessionId,
      });

      await supabase.from("side_chat_messages").insert({
        room_id: roomId,
        user_id: userId,
        role: "ai",
        content: verdict.explanation,
        draft_session_id: draftSessionId,
      });

      return {
        status: "revise",
        explanation: verdict.explanation,
        suggestedRevision: verdict.suggested_revision,
        rejectionCount: newRejectionCount,
        draftSessionId,
      };
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "An unknown error occurred";
    return { status: "error", message };
  }
}

export async function abandonDraft(roomId: string): Promise<{ success: boolean }> {
  try {
    const { supabase, user } = await getAuthUser();
    await supabase
      .from("pending_drafts")
      .delete()
      .eq("room_id", roomId)
      .eq("user_id", user.id);
    return { success: true };
  } catch {
    return { success: false };
  }
}

export async function createRoom(): Promise<
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

export async function joinRoomByCode(
  code: string
): Promise<{ roomId: string } | { error: string }> {
  try {
    const { supabase, user } = await getAuthUser();

    const { data: room, error: findError } = await supabase
      .from("rooms")
      .select("id, user_a_id, user_b_id")
      .eq("invite_code", code.toUpperCase())
      .single();

    if (findError || !room) return { error: "Room not found" };
    if (room.user_a_id === user.id) return { error: "You created this room" };
    if (room.user_b_id !== null) return { error: "Room is already full" };

    const { error: updateError } = await supabase
      .from("rooms")
      .update({ user_b_id: user.id })
      .eq("id", room.id);

    if (updateError) throw updateError;
    return { roomId: room.id };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to join room";
    return { error: message };
  }
}

export async function joinRoomByToken(
  token: string
): Promise<{ roomId: string } | { error: string }> {
  try {
    const { supabase, user } = await getAuthUser();

    const { data: room, error: findError } = await supabase
      .from("rooms")
      .select("id, user_a_id, user_b_id")
      .eq("invite_token", token)
      .single();

    if (findError || !room) return { error: "Invalid invite link" };
    if (room.user_a_id === user.id) return { error: "You created this room" };
    if (room.user_b_id !== null) return { error: "Room is already full" };

    const { error: updateError } = await supabase
      .from("rooms")
      .update({ user_b_id: user.id })
      .eq("id", room.id);

    if (updateError) throw updateError;
    return { roomId: room.id };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to join room";
    return { error: message };
  }
}

export async function getDashboardRooms() {
  const { supabase, user } = await getAuthUser();

  const { data: rooms, error } = await supabase
    .from("rooms")
    .select(`
      *,
      user_a_profile:profiles!rooms_user_a_id_fkey(display_name),
      user_b_profile:profiles!rooms_user_b_id_fkey(display_name)
    `)
    .or(`user_a_id.eq.${user.id},user_b_id.eq.${user.id}`)
    .order("created_at", { ascending: false });

  if (error) throw error;

  // Get latest message for each room
  const roomIds = (rooms ?? []).map((r) => r.id);
  const { data: latestMessages } = await supabase
    .from("main_messages")
    .select("room_id, content, created_at")
    .in("room_id", roomIds)
    .order("created_at", { ascending: false });

  const latestByRoom = new Map<string, { content: string; created_at: string }>();
  for (const msg of latestMessages ?? []) {
    if (!latestByRoom.has(msg.room_id)) {
      latestByRoom.set(msg.room_id, { content: msg.content, created_at: msg.created_at });
    }
  }

  return (rooms ?? []).map((room) => {
    const isUserA = room.user_a_id === user.id;
    const otherProfile = isUserA ? room.user_b_profile : room.user_a_profile;
    const latest = latestByRoom.get(room.id);

    return {
      ...room,
      other_user_display_name: otherProfile?.display_name ?? null,
      last_message_content: latest?.content ?? null,
      last_message_at: latest?.created_at ?? null,
    };
  });
}
```

- [ ] **Step 3: Verify build compiles**

Run: `npx next build 2>&1 | tail -5`
Expected: Build will fail because components still pass `userId` — that's expected. We fix components in Task 8.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: rewrite server actions with auth, add room join/create, remove mock store"
```

---

### Task 7: Dashboard & Room Components

**Files:**
- Create: `components/RoomCard.tsx`
- Create: `components/CreateRoomDialog.tsx`
- Create: `components/JoinRoomForm.tsx`
- Modify: `app/page.tsx`

- [ ] **Step 1: Create RoomCard component**

```typescript
// components/RoomCard.tsx
"use client";

import { useRouter } from "next/navigation";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { RoomWithDetails } from "@/lib/types";

export function RoomCard({ room }: { room: RoomWithDetails }) {
  const router = useRouter();

  const timeAgo = room.last_message_at
    ? getTimeAgo(new Date(room.last_message_at))
    : getTimeAgo(new Date(room.created_at));

  return (
    <Card
      className="cursor-pointer hover:bg-accent/50 transition-colors"
      onClick={() => router.push(`/room/${room.id}`)}
    >
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">
            {room.other_user_display_name ?? "Waiting for someone to join..."}
          </CardTitle>
          <Badge variant={room.status === "active" ? "default" : "secondary"}>
            {room.status}
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        {room.last_message_content ? (
          <p className="text-sm text-muted-foreground truncate">
            {room.last_message_content}
          </p>
        ) : (
          <p className="text-sm text-muted-foreground italic">No messages yet</p>
        )}
        <p className="text-xs text-muted-foreground mt-2">{timeAgo}</p>
      </CardContent>
    </Card>
  );
}

function getTimeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
```

- [ ] **Step 2: Create CreateRoomDialog component**

```typescript
// components/CreateRoomDialog.tsx
"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { createRoom } from "@/app/room/[roomId]/actions";

export function CreateRoomDialog({ onCreated }: { onCreated: () => void }) {
  const [isCreating, setIsCreating] = useState(false);
  const [result, setResult] = useState<{
    inviteCode: string;
    inviteLink: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleCreate = async () => {
    setIsCreating(true);
    setError(null);

    const res = await createRoom();
    if ("error" in res) {
      setError(res.error);
      setIsCreating(false);
      return;
    }

    setResult({
      inviteCode: res.inviteCode,
      inviteLink: `${window.location.origin}/join/${res.inviteToken}`,
    });
    setIsCreating(false);
    onCreated();
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  if (result) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Room Created</CardTitle>
          <CardDescription>
            Share the invite link or code with the other person.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div>
            <p className="text-xs text-muted-foreground mb-1">Invite Link</p>
            <div className="flex gap-2">
              <Input value={result.inviteLink} readOnly className="text-xs" />
              <Button
                variant="outline"
                size="sm"
                onClick={() => copyToClipboard(result.inviteLink)}
              >
                Copy
              </Button>
            </div>
          </div>
          <div>
            <p className="text-xs text-muted-foreground mb-1">Invite Code</p>
            <div className="flex gap-2">
              <Input value={result.inviteCode} readOnly className="font-mono text-lg tracking-wider" />
              <Button
                variant="outline"
                size="sm"
                onClick={() => copyToClipboard(result.inviteCode)}
              >
                Copy
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Button onClick={handleCreate} disabled={isCreating}>
      {isCreating ? "Creating..." : "Create Room"}
    </Button>
  );
}
```

- [ ] **Step 3: Create JoinRoomForm component**

```typescript
// components/JoinRoomForm.tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { joinRoomByCode } from "@/app/room/[roomId]/actions";

export function JoinRoomForm() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleJoin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!code.trim()) return;
    setLoading(true);
    setError(null);

    const result = await joinRoomByCode(code.trim());
    if ("error" in result) {
      setError(result.error);
      setLoading(false);
      return;
    }

    router.push(`/room/${result.roomId}`);
  };

  return (
    <form onSubmit={handleJoin} className="flex gap-2">
      <Input
        value={code}
        onChange={(e) => setCode(e.target.value.toUpperCase())}
        placeholder="Enter invite code"
        className="font-mono tracking-wider"
        maxLength={8}
      />
      <Button type="submit" variant="outline" disabled={loading || !code.trim()}>
        {loading ? "Joining..." : "Join"}
      </Button>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </form>
  );
}
```

- [ ] **Step 4: Replace app/page.tsx with dashboard**

```typescript
// app/page.tsx
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { getDashboardRooms } from "@/app/room/[roomId]/actions";
import { RoomCard } from "@/components/RoomCard";
import { CreateRoomDialog } from "@/components/CreateRoomDialog";
import { JoinRoomForm } from "@/components/JoinRoomForm";
import type { RoomWithDetails } from "@/lib/types";

export default async function DashboardPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  let rooms: RoomWithDetails[] = [];
  try {
    rooms = await getDashboardRooms();
  } catch {
    // Will show empty state
  }

  return (
    <div className="min-h-screen p-4 md:p-8 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold">CommonGround</h1>
          <p className="text-sm text-muted-foreground">Your conversations</p>
        </div>
        <div className="flex items-center gap-3">
          <JoinRoomForm />
          <CreateRoomDialog onCreated={() => {}} />
        </div>
      </div>

      {rooms.length === 0 ? (
        <div className="text-center py-16">
          <p className="text-muted-foreground mb-2">No rooms yet.</p>
          <p className="text-sm text-muted-foreground">
            Create a room or join one with an invite code.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {rooms.map((room) => (
            <RoomCard key={room.id} room={room} />
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Commit**

```bash
git add components/RoomCard.tsx components/CreateRoomDialog.tsx components/JoinRoomForm.tsx app/page.tsx
git commit -m "feat: add dashboard with room cards, create room dialog, join room form"
```

---

### Task 8: Join Page

**Files:**
- Create: `app/join/[inviteToken]/page.tsx`

- [ ] **Step 1: Create join page**

```typescript
// app/join/[inviteToken]/page.tsx
import { redirect } from "next/navigation";
import { joinRoomByToken } from "@/app/room/[roomId]/actions";

export default async function JoinPage({
  params,
}: {
  params: Promise<{ inviteToken: string }>;
}) {
  const { inviteToken } = await params;

  const result = await joinRoomByToken(inviteToken);

  if ("error" in result) {
    redirect(`/?joinError=${encodeURIComponent(result.error)}`);
  }

  redirect(`/room/${result.roomId}`);
}
```

- [ ] **Step 2: Commit**

```bash
git add app/join/[inviteToken]/page.tsx
git commit -m "feat: add invite link join page"
```

---

## Phase 3: Component Refactor

### Task 9: Update Room Page & Components for Auth

**Files:**
- Modify: `app/room/[roomId]/page.tsx`
- Modify: `components/Composer.tsx`
- Modify: `components/MainThread.tsx`
- Modify: `components/SideChatPanel.tsx`
- Modify: `components/FactsSidebar.tsx`

- [ ] **Step 1: Rewrite room page**

```typescript
// app/room/[roomId]/page.tsx
"use client";

import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { MainMessage, EstablishedFact } from "@/lib/types";
import { MainThread } from "@/components/MainThread";
import { FactsSidebar } from "@/components/FactsSidebar";
import { Composer } from "@/components/Composer";

export default function RoomPage() {
  const params = useParams();
  const roomId = params.roomId as string;

  const [userId, setUserId] = useState<string | null>(null);
  const [otherUserName, setOtherUserName] = useState<string>("...");
  const [messages, setMessages] = useState<MainMessage[]>([]);
  const [facts, setFacts] = useState<EstablishedFact[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showFacts, setShowFacts] = useState(false);

  const loadData = useCallback(async () => {
    try {
      const supabase = createClient();

      // Get current user
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setError("Not authenticated");
        return;
      }
      setUserId(user.id);

      // Get room details with profiles
      const { data: room } = await supabase
        .from("rooms")
        .select(`
          *,
          user_a_profile:profiles!rooms_user_a_id_fkey(display_name),
          user_b_profile:profiles!rooms_user_b_id_fkey(display_name)
        `)
        .eq("id", roomId)
        .single();

      if (!room) {
        setError("Room not found or access denied");
        return;
      }

      const isUserA = room.user_a_id === user.id;
      const otherProfile = isUserA ? room.user_b_profile : room.user_a_profile;
      setOtherUserName(otherProfile?.display_name ?? "Waiting for partner...");

      // Load messages and facts
      const [messagesResult, factsResult] = await Promise.all([
        supabase
          .from("main_messages")
          .select("*")
          .eq("room_id", roomId)
          .order("created_at", { ascending: true }),
        supabase
          .from("established_facts")
          .select("*")
          .eq("room_id", roomId)
          .order("created_at", { ascending: true }),
      ]);

      if (messagesResult.error) throw messagesResult.error;
      if (factsResult.error) throw factsResult.error;

      setMessages(messagesResult.data ?? []);
      setFacts(factsResult.data ?? []);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to load room data";
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [roomId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-muted-foreground">Loading room...</p>
      </div>
    );
  }

  if (error || !userId) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <p className="text-destructive mb-2">Error</p>
          <p className="text-sm text-muted-foreground">{error ?? "Not authenticated"}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex">
      {/* Main chat area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <div className="border-b p-4 flex items-center justify-between">
          <div>
            <h1 className="font-semibold">CommonGround</h1>
            <p className="text-xs text-muted-foreground">
              Talking with {otherUserName}
            </p>
          </div>
          <button
            className="md:hidden text-sm text-muted-foreground"
            onClick={() => setShowFacts(!showFacts)}
          >
            Facts ({facts.length})
          </button>
        </div>

        {/* Messages */}
        <MainThread
          roomId={roomId}
          currentUserId={userId}
          initialMessages={messages}
        />

        {/* Composer */}
        <Composer roomId={roomId} />
      </div>

      {/* Facts sidebar — desktop always, mobile toggle */}
      <div className={`w-72 flex-col ${showFacts ? "flex" : "hidden md:flex"}`}>
        <FactsSidebar roomId={roomId} initialFacts={facts} />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Update Composer — remove userId prop**

```typescript
// components/Composer.tsx
"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SideChatPanel } from "@/components/SideChatPanel";
import {
  submitDraft,
  abandonDraft,
  type SubmitDraftResult,
} from "@/app/room/[roomId]/actions";
import type { SideChatMessage } from "@/lib/types";

type ComposerMode =
  | { type: "normal" }
  | {
      type: "side-chat";
      draftSessionId: string;
      rejectionCount: number;
      suggestedRevision?: string;
      messages: SideChatMessage[];
    };

export function Composer({ roomId }: { roomId: string }) {
  const [input, setInput] = useState("");
  const [mode, setMode] = useState<ComposerMode>({ type: "normal" });
  const [isModerating, setIsModerating] = useState(false);

  const handleSubmit = async (content: string, existingSessionId?: string) => {
    if (!content.trim()) return;

    setIsModerating(true);

    const result: SubmitDraftResult = await submitDraft(
      roomId,
      content.trim(),
      existingSessionId
    );

    setIsModerating(false);

    if (result.status === "approved") {
      setMode({ type: "normal" });
      setInput("");
    } else if (result.status === "revise") {
      setMode({
        type: "side-chat",
        draftSessionId: result.draftSessionId,
        rejectionCount: result.rejectionCount,
        suggestedRevision: result.suggestedRevision,
        messages: [],
      });
    } else {
      console.error("Submit draft error:", result.message);
      setMode({ type: "normal" });
    }
  };

  const handleAbandon = async () => {
    await abandonDraft(roomId);
    setMode({ type: "normal" });
    setInput("");
  };

  const handleNormalSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    handleSubmit(input);
  };

  if (mode.type === "side-chat") {
    return (
      <SideChatPanel
        roomId={roomId}
        draftSessionId={mode.draftSessionId}
        rejectionCount={mode.rejectionCount}
        suggestedRevision={mode.suggestedRevision}
        initialMessages={mode.messages}
        onSubmitRevision={(content) =>
          handleSubmit(content, mode.draftSessionId)
        }
        onAbandon={handleAbandon}
      />
    );
  }

  return (
    <form onSubmit={handleNormalSubmit} className="p-4 border-t flex gap-2">
      <Input
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder="Type your message..."
        disabled={isModerating}
        className="flex-1"
      />
      <Button type="submit" disabled={isModerating || !input.trim()}>
        {isModerating ? "Moderating..." : "Send"}
      </Button>
    </form>
  );
}
```

- [ ] **Step 3: Update MainThread — display names instead of "User A/B"**

Replace the sender display in `components/MainThread.tsx`. Change lines 79-81 from:

```typescript
              <span className="text-xs text-muted-foreground mb-1">
                User {msg.sender_id}
              </span>
```

to:

```typescript
              <span className="text-xs text-muted-foreground mb-1">
                {msg.sender_id === currentUserId ? "You" : "Them"}
              </span>
```

Also remove the mock mode check (lines 27-34 that check for env vars). Remove the `useEffect` that syncs `initialMessages` from parent (lines 22-24). The component should look like:

```typescript
// components/MainThread.tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { MainMessage } from "@/lib/types";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";

export function MainThread({
  roomId,
  currentUserId,
  initialMessages,
}: {
  roomId: string;
  currentUserId: string;
  initialMessages: MainMessage[];
}) {
  const [messages, setMessages] = useState<MainMessage[]>(initialMessages);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const supabase = createClient();

    const channel = supabase
      .channel(`main_messages:${roomId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "main_messages",
          filter: `room_id=eq.${roomId}`,
        },
        (payload) => {
          const newMessage = payload.new as MainMessage;
          setMessages((prev) => [...prev, newMessage]);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [roomId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  return (
    <ScrollArea className="flex-1 p-4">
      <div className="space-y-4">
        {messages.length === 0 && (
          <p className="text-center text-muted-foreground py-8">
            No messages yet. Start the conversation.
          </p>
        )}
        {messages.map((msg) => {
          const isOwnMessage = msg.sender_id === currentUserId;
          return (
            <div
              key={msg.id}
              className={`flex flex-col ${isOwnMessage ? "items-end" : "items-start"}`}
            >
              <span className="text-xs text-muted-foreground mb-1">
                {isOwnMessage ? "You" : "Them"}
              </span>
              <div
                className={`rounded-lg px-4 py-2 max-w-[80%] ${
                  isOwnMessage
                    ? "bg-primary text-primary-foreground"
                    : "bg-secondary text-secondary-foreground"
                }`}
              >
                <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
              </div>
              <div className="flex items-center gap-2 mt-1">
                {msg.revision_count > 0 && (
                  <Badge variant="outline" className="text-xs">
                    revised via moderator
                  </Badge>
                )}
                <span className="text-xs text-muted-foreground">
                  {new Date(msg.created_at).toLocaleTimeString()}
                </span>
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>
    </ScrollArea>
  );
}
```

- [ ] **Step 4: Update SideChatPanel — remove userId prop**

In `components/SideChatPanel.tsx`, remove `userId` from props. The Realtime filter still works because RLS now enforces that only the user's own side-chat messages are returned. Change the component signature and Realtime subscription:

```typescript
// components/SideChatPanel.tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { SideChatMessage } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";

const MAX_REJECTIONS = 5;

export function SideChatPanel({
  roomId,
  draftSessionId,
  rejectionCount,
  suggestedRevision,
  initialMessages,
  onSubmitRevision,
  onAbandon,
}: {
  roomId: string;
  draftSessionId: string;
  rejectionCount: number;
  suggestedRevision?: string;
  initialMessages: SideChatMessage[];
  onSubmitRevision: (content: string) => Promise<void>;
  onAbandon: () => void;
}) {
  const [messages, setMessages] = useState<SideChatMessage[]>(initialMessages);
  const [input, setInput] = useState(suggestedRevision ?? "");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const supabase = createClient();

    const channel = supabase
      .channel(`side_chat:${roomId}:${draftSessionId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "side_chat_messages",
          filter: `room_id=eq.${roomId}`,
        },
        (payload) => {
          const msg = payload.new as SideChatMessage;
          if (msg.draft_session_id === draftSessionId) {
            setMessages((prev) => {
              if (prev.some((m) => m.id === msg.id)) return prev;
              return [...prev, msg];
            });
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [roomId, draftSessionId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isSubmitting) return;
    setIsSubmitting(true);
    const submittedContent = input.trim();
    setInput("");
    try {
      await onSubmitRevision(submittedContent);
    } finally {
      setIsSubmitting(false);
    }
  };

  const atMaxRejections = rejectionCount >= MAX_REJECTIONS;

  return (
    <div className="border-t bg-card flex flex-col">
      <div className="p-3 border-b flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-sm">Revise Your Message</span>
          <Badge variant="outline" className="text-xs">
            Attempt {rejectionCount}/{MAX_REJECTIONS}
          </Badge>
        </div>
        <Button variant="ghost" size="sm" onClick={onAbandon}>
          Abandon
        </Button>
      </div>

      <ScrollArea className="flex-1 max-h-60 p-4">
        <div className="space-y-3">
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex flex-col ${msg.role === "user" ? "items-end" : "items-start"}`}
            >
              <span className="text-xs text-muted-foreground mb-1">
                {msg.role === "ai" ? "Moderator" : "You"}
              </span>
              <div
                className={`rounded-lg px-3 py-2 max-w-[85%] text-sm ${
                  msg.role === "ai"
                    ? "bg-muted text-muted-foreground"
                    : "bg-primary text-primary-foreground"
                }`}
              >
                <p className="whitespace-pre-wrap">{msg.content}</p>
              </div>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>
      </ScrollArea>

      {atMaxRejections ? (
        <div className="p-4 text-center">
          <p className="text-sm text-muted-foreground mb-2">
            You have reached the maximum number of revision attempts. Consider
            taking a break and approaching this point differently.
          </p>
          <Button variant="outline" onClick={onAbandon}>
            Close
          </Button>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="p-3 border-t flex gap-2">
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Type your revised message..."
            disabled={isSubmitting}
            className="flex-1"
          />
          <Button type="submit" disabled={isSubmitting || !input.trim()}>
            Submit Revision
          </Button>
        </form>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Update FactsSidebar — remove mock mode checks**

In `components/FactsSidebar.tsx`, remove the mock mode env var check (lines 24-28) and the `useEffect` that syncs from parent (lines 19-22). The Realtime subscription is the only data source now. The component is otherwise unchanged.

- [ ] **Step 6: Verify build compiles**

Run: `npx next build 2>&1 | tail -10`
Expected: Build succeeds.

- [ ] **Step 7: Commit**

```bash
git add app/room/[roomId]/page.tsx components/Composer.tsx components/MainThread.tsx components/SideChatPanel.tsx components/FactsSidebar.tsx
git commit -m "feat: refactor all components to use auth instead of userId props"
```

---

## Phase 4: Push Notifications

### Task 10: Push Notification Infrastructure

**Files:**
- Create: `lib/push.ts`
- Modify: `app/sw.ts`
- Create: `app/room/[roomId]/push-actions.ts`

- [ ] **Step 1: Install web-push**

```bash
npm install web-push
npm install -D @types/web-push
```

- [ ] **Step 2: Generate VAPID keys**

```bash
npx web-push generate-vapid-keys
```

Save the output. Add to `.env.local`:
```
NEXT_PUBLIC_VAPID_PUBLIC_KEY=<public key>
VAPID_PRIVATE_KEY=<private key>
```

Add to Vercel env vars as well.

- [ ] **Step 3: Create push utility**

```typescript
// lib/push.ts
import webpush from "web-push";

webpush.setVapidDetails(
  "mailto:noreply@commonground.app",
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!,
  process.env.VAPID_PRIVATE_KEY!
);

export async function sendPushNotification(
  subscription: { endpoint: string; p256dh: string; auth: string },
  payload: { title: string; body: string; url: string }
) {
  try {
    await webpush.sendNotification(
      {
        endpoint: subscription.endpoint,
        keys: {
          p256dh: subscription.p256dh,
          auth: subscription.auth,
        },
      },
      JSON.stringify(payload)
    );
  } catch (error: unknown) {
    // If subscription is expired/invalid, it will throw a 410 Gone
    const statusCode = (error as { statusCode?: number })?.statusCode;
    if (statusCode === 410 || statusCode === 404) {
      // Subscription is no longer valid — caller should clean up
      return { expired: true };
    }
    throw error;
  }
  return { expired: false };
}
```

- [ ] **Step 4: Create push server actions**

```typescript
// app/room/[roomId]/push-actions.ts
"use server";

import { sendPushNotification } from "@/lib/push";

async function getSupabase() {
  const { createClient } = await import("@/lib/supabase/server");
  return createClient();
}

export async function savePushSubscription(subscription: {
  endpoint: string;
  p256dh: string;
  auth: string;
}) {
  const supabase = await getSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");

  await supabase.from("push_subscriptions").upsert(
    {
      user_id: user.id,
      endpoint: subscription.endpoint,
      p256dh: subscription.p256dh,
      auth: subscription.auth,
    },
    { onConflict: "user_id,endpoint" }
  );
}

export async function notifyRoomParticipant(
  roomId: string,
  senderUserId: string,
  messagePreview: string
) {
  const supabase = await getSupabase();

  // Find the other participant
  const { data: room } = await supabase
    .from("rooms")
    .select("user_a_id, user_b_id")
    .eq("id", roomId)
    .single();

  if (!room) return;

  const recipientId =
    room.user_a_id === senderUserId ? room.user_b_id : room.user_a_id;
  if (!recipientId) return;

  // Get sender's display name
  const { data: senderProfile } = await supabase
    .from("profiles")
    .select("display_name")
    .eq("id", senderUserId)
    .single();

  const senderName = senderProfile?.display_name ?? "Someone";

  // Get recipient's push subscriptions
  const { data: subscriptions } = await supabase
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .eq("user_id", recipientId);

  if (!subscriptions || subscriptions.length === 0) return;

  const preview =
    messagePreview.length > 100
      ? messagePreview.slice(0, 97) + "..."
      : messagePreview;

  for (const sub of subscriptions) {
    const result = await sendPushNotification(
      { endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth },
      {
        title: "CommonGround",
        body: `${senderName}: ${preview}`,
        url: `/room/${roomId}`,
      }
    );

    if (result.expired) {
      await supabase.from("push_subscriptions").delete().eq("id", sub.id);
    }
  }
}
```

- [ ] **Step 5: Update service worker with push handlers**

```typescript
// app/sw.ts
import { defaultCache } from "@serwist/next/worker";
import type { PrecacheEntry, SerwistGlobalConfig } from "serwist";
import { Serwist } from "serwist";

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: defaultCache,
});

serwist.addEventListeners();

// Push notification handler
self.addEventListener("push", (event) => {
  if (!event.data) return;

  const data = event.data.json();
  event.waitUntil(
    self.registration.showNotification(data.title ?? "CommonGround", {
      body: data.body,
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      data: { url: data.url },
    })
  );
});

// Click notification to open room
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url ?? "/";

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clients) => {
        for (const client of clients) {
          if (client.url.includes(url) && "focus" in client) {
            return client.focus();
          }
        }
        return self.clients.openWindow(url);
      })
  );
});
```

- [ ] **Step 6: Wire push notification into submitDraft**

In `app/room/[roomId]/actions.ts`, add this import at the top:

```typescript
import { notifyRoomParticipant } from "./push-actions";
```

Then after the line `return { status: "approved", messageId: newMessage.id };` (inside the `verdict.verdict === "approve"` block), add the notification call just before the return:

```typescript
      // Send push notification to the other participant (fire and forget)
      notifyRoomParticipant(roomId, userId, content).catch(() => {});

      return { status: "approved", messageId: newMessage.id };
```

- [ ] **Step 7: Commit**

```bash
git add lib/push.ts app/room/[roomId]/push-actions.ts app/sw.ts app/room/[roomId]/actions.ts package.json package-lock.json
git commit -m "feat: add push notifications via Web Push API"
```

---

### Task 11: Push Subscription Client-Side

**Files:**
- Create: `lib/push-client.ts`
- Modify: `app/room/[roomId]/page.tsx`

- [ ] **Step 1: Create push client utility**

```typescript
// lib/push-client.ts
import { savePushSubscription } from "@/app/room/[roomId]/push-actions";

export async function registerPushSubscription() {
  if (!("Notification" in window) || !("serviceWorker" in navigator)) return;

  const permission = await Notification.requestPermission();
  if (permission !== "granted") return;

  const registration = await navigator.serviceWorker.ready;
  const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  if (!vapidKey) return;

  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidKey),
    });
  }

  const json = subscription.toJSON();
  if (json.endpoint && json.keys?.p256dh && json.keys?.auth) {
    await savePushSubscription({
      endpoint: json.endpoint,
      p256dh: json.keys.p256dh,
      auth: json.keys.auth,
    });
  }
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}
```

- [ ] **Step 2: Register push in room page**

Add this `useEffect` to `app/room/[roomId]/page.tsx`, after the existing `loadData` useEffect:

```typescript
  // Register push notifications on first visit
  useEffect(() => {
    import("@/lib/push-client").then(({ registerPushSubscription }) => {
      registerPushSubscription().catch(console.error);
    });
  }, []);
```

- [ ] **Step 3: Commit**

```bash
git add lib/push-client.ts app/room/[roomId]/page.tsx
git commit -m "feat: register push subscription on room visit"
```

---

## Phase 5: Cleanup & Final Build

### Task 12: Update CLAUDE.md, .gitignore, Tests

**Files:**
- Modify: `CLAUDE.md`
- Modify: `.gitignore`
- Delete: `lib/__tests__/mock-store.test.ts`
- Modify: `lib/__tests__/moderator.test.ts`
- Modify: `app/room/[roomId]/__tests__/actions.test.ts`

- [ ] **Step 1: Delete mock store test**

```bash
rm lib/__tests__/mock-store.test.ts
```

- [ ] **Step 2: Update moderator tests — use UUIDs**

In `lib/__tests__/moderator.test.ts`, replace any hardcoded `"A"` or `"B"` user IDs with UUIDs. The moderator tests mostly don't reference user IDs directly (they test the moderation logic), so this should be minimal.

- [ ] **Step 3: Remove or rewrite actions tests**

The actions tests in `app/room/[roomId]/__tests__/actions.test.ts` depend heavily on the mock store. Since mock mode is removed, these tests need to be rewritten as integration tests against a real Supabase instance, or removed and replaced later. For now, remove the file:

```bash
rm app/room/[roomId]/__tests__/actions.test.ts
```

- [ ] **Step 4: Update CLAUDE.md**

Update the Quick Start section to remove mock mode references and add auth setup instructions. Update the Key Files table to remove `mock-store.ts` and add new files (`middleware.ts`, auth routes, push utilities). Update environment variables section to include VAPID keys.

- [ ] **Step 5: Run tests**

Run: `npx vitest run 2>&1`
Expected: Moderator tests pass. Mock store and actions tests are removed.

- [ ] **Step 6: Run build**

Run: `npx next build 2>&1 | tail -15`
Expected: Build succeeds.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "chore: remove mock mode, update docs and tests"
```

---

### Task 13: Configure Google OAuth in Supabase

This is a manual/MCP task, not code.

- [ ] **Step 1: Enable Google provider in Supabase dashboard**

Go to Supabase Dashboard > Authentication > Providers > Google. Enable it. You'll need:
- A Google Cloud Console project
- OAuth 2.0 credentials (Client ID + Client Secret)
- Authorized redirect URI: `https://qbhedsutcfshiajpnjnx.supabase.co/auth/v1/callback`

Or use the Supabase MCP to configure this if the tool supports it.

- [ ] **Step 2: Set redirect URLs in Supabase Auth settings**

In Supabase Dashboard > Authentication > URL Configuration:
- Site URL: `https://common-ground-lemon.vercel.app`
- Redirect URLs: add `https://common-ground-lemon.vercel.app/auth/callback`
- For local dev, also add: `http://localhost:3000/auth/callback`

---

### Task 14: Deploy

- [ ] **Step 1: Add VAPID env vars to Vercel**

Use the Vercel API or CLI to add `NEXT_PUBLIC_VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY` to all environments.

- [ ] **Step 2: Deploy**

```bash
vercel deploy --scope jbrinkws-projects --yes
```

- [ ] **Step 3: Verify**

Visit the deployed URL. Confirm:
- Redirected to `/login` when not authenticated
- Can sign up with email/password
- Can create a room and get invite link/code
- Can join room from another account
- Messages are moderated by Claude
- Push notifications work
