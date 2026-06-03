# Clara Voice Agent — Quality Hardening Plan

> **For agentic workers:** Use superpowers:subagent-driven-development or executing-plans to implement task-by-task.

**Goal:** Fix the broken DB tracking, harden security/connection resilience, and add the missing test coverage so the beta is production-grade.

**Architecture:** Next.js 16 + LiveAvatar LITE + ElevenLabs plugin. Changes are incremental, each independently shippable to a feature branch → PR → develop.

**Tech Stack:** Next.js 16, React 19, NextAuth 5, Prisma 7, Vercel KV, bcryptjs.

---

## Priority 0 — CRITICAL (ship first)

### Task 1: Fix Prisma 7 schema (DB tracking is dead)

**Problem:** `prisma generate` fails on every build (`P1012`), so session tracking silently writes nothing.

**Files:**
- Modify: `apps/demo/prisma/schema.prisma`
- Create: `apps/demo/prisma.config.ts`

**Options (pick one in brainstorming):**
- A) Migrate `url` to `prisma.config.ts` + driver adapter (Prisma 7 way)
- B) Downgrade to `prisma@^6` + `@prisma/client@^6` (lowest risk, fastest)

- [ ] Decide A vs B
- [ ] Apply change
- [ ] Verify `pnpm --filter demo exec prisma generate` succeeds locally
- [ ] Verify build log no longer shows "Prisma generation skipped"
- [ ] Confirm a test session appears in DB after running

### Task 2: Verify beta gate end-to-end on develop

- [ ] After merge, open testers.betaskintech.com incognito → expect /access
- [ ] Wrong password 5x → expect 429 lockout
- [ ] Correct password → cookie set → /login → Clara
- [ ] Cookie persists 7 days (reopen tab, no re-prompt)

---

## Priority 1 — IMPORTANT

### Task 3: Pin bleeding-edge dependency versions

**Files:** `apps/demo/package.json`

- [ ] Pin `next`, `next-auth`, `@prisma/client`, `prisma` to exact versions (drop `^`)
- [ ] Document in CLAUDE.md why (avoid surprise breaking changes)
- [ ] `pnpm install` + build to confirm lockfile stable

### Task 4: Add test coverage for changed areas

**Files:**
- Create: `apps/demo/src/__tests__/lib/beta-access.test.ts`
- Create: `apps/demo/src/__tests__/utils/elevenlabs-commands.test.ts`

- [ ] beta-access: signBetaCookie → verifyBetaCookie roundtrip = true
- [ ] beta-access: tampered cookie = false
- [ ] beta-access: expired cookie = false
- [ ] beta-access: timing-safe compare doesn't throw on length mismatch
- [ ] elevenlabs-commands: sendCustomerContext skips when empty
- [ ] elevenlabs-commands: builds correct text with firstName + skinType

### Task 5: WebRTC reconnection + session.stopped handling

**Files:** `apps/demo/src/components/ClaraVoiceAgent.tsx`

- [ ] Listen for SESSION_STOPPED, branch UI by end_reason (NO_CREDITS, IDLE_TIMEOUT, MAX_DURATION_REACHED)
- [ ] On transient disconnect, attempt 1 reconnect before showing error
- [ ] Show user-friendly message per reason

### Task 6: Cleaner greeting trigger ([START] token)

**Files:** `apps/demo/src/components/ClaraVoiceAgent.tsx` + ElevenLabs dashboard

- [ ] Change trigger from "Hola" to "[START]"
- [ ] Update agent system prompt: treat [START] as session-start signal, greet by name
- [ ] Verify transcript no longer shows fake "Hola"

---

## Priority 2 — MINOR / polish

### Task 7: Gate debug instrumentation behind env flag

- [ ] Wrap `session.emit` monkeypatch + [EMIT]/[EVT] listeners in `NEXT_PUBLIC_VERCEL_ENV !== "production"`
- [ ] Filter out vad_score spam from logging

### Task 8: Harden .gitignore

- [ ] Anchor `build`, `dist`, `docs` patterns to avoid ignoring source dirs

### Task 9: iOS AudioContext pre-warm (greeting latency)

- [ ] Play 100ms silent buffer in the start-call user gesture
- [ ] Measure greeting start latency before/after on iOS Safari
