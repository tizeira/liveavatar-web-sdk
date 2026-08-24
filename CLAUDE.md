# CLAUDE.md — Clara Voice Agent (liveavatar-web-sdk)

> Avatar de voz conversacional para BetaSkintech (skincare). Clara escucha al usuario,
> responde con un agente de ElevenLabs y mueve los labios en tiempo real con HeyGen LiveAvatar.

**Última actualización del contexto:** 2026-06-04 (post migración a plugin ElevenLabs + saludo Shopify).

---

## 1. Arquitectura actual (IMPORTANTE — ya NO es la vieja WebSocket)

Clara usa **HeyGen LiveAvatar en modo LITE + el plugin de ElevenLabs Agent**. NO armamos el
pipeline STT/TTS a mano: el plugin conecta el agente de ElevenLabs al avatar y nosotros
escuchamos eventos por el **data-channel de LiveKit** (el sistema de eventos de FULL Mode).

```
Usuario habla ──► mic del browser
      │
      ▼
ElevenLabs Agent (plugin)  ── STT + LLM + TTS, todo server-side del agente
      │  audio + eventos (LiveKit data-channel)
      ▼
HeyGen LiveAvatar (LITE)  ── lip-sync del audio del agente sobre el <video>
```

- **El audio del avatar** se reproduce en el `<video muted={false}>` de `ClaraVoiceAgent.tsx`.
- **No manejamos chunks de audio crudos** como antes; el plugin lo hace. Lo que tocamos es
  el _contexto_ del agente y el _trigger_ del saludo (ver §4).

### Eventos del SDK que usamos (`AgentEventsEnum`)

`AVATAR_SPEAK_STARTED` · `AVATAR_SPEAK_ENDED` · `AVATAR_TRANSCRIPTION(_CHUNK)` ·
`USER_SPEAK_STARTED` · `USER_SPEAK_ENDED` · `USER_TRANSCRIPTION(_CHUNK)` ·
`ELEVENLABS_AGENT_EVENT` · `SESSION_STOPPED`

### Métodos del plugin (`ElevenLabsAgentSession`)

- `sendContextualUpdate(text)` → inyecta contexto **silencioso** (NO dispara respuesta).
- `sendUserMessage(text)` → simula mensaje del usuario (SÍ dispara respuesta). Usado para el saludo.
- `voiceChat.mute()` / `voiceChat.unmute()` → control del mic.

---

## 2. Stack

| Capa               | Tecnología                                             |
| ------------------ | ------------------------------------------------------ |
| Framework          | Next.js **16** (App Router)                            |
| UI                 | React **19**, Tailwind, shadcn/ui                      |
| Auth               | NextAuth **5.0.0-beta** (Google OAuth + Credentials)   |
| Avatar SDK         | `@heygen/liveavatar-web-sdk` (monorepo, `workspace:*`) |
| Voz/LLM            | ElevenLabs Agent (plugin del SDK)                      |
| DB                 | Prisma **6** + PostgreSQL (`POSTGRES_PRISMA_URL`)      |
| Rate-limit / cache | Vercel KV                                              |
| Deploy             | Vercel                                                 |

**Requisitos:** Node ≥ 22 · pnpm 9.0.0 · Chrome/Firefox para testing (Safari iOS tiene fallback).

---

## 3. Deployments

| Branch    | Entorno         | URL                              |
| --------- | --------------- | -------------------------------- |
| `master`  | Producción      | https://clara.betaskintech.com   |
| `develop` | Preview/testers | https://testers.betaskintech.com |

> ⚠️ `develop` suele estar **muy por delante** de `master`. Promover a prod = PR `develop → master`
> tras QA en preview (ver `docs/QA_CHECKLIST.md`).

---

## 4. Mecanismos clave (cómo funcionan los fixes que logramos)

### Saludo personalizado (handshake de 2 pasos)

El "First message" del agente en ElevenLabs debe estar **VACÍO**. El saludo se dispara desde el cliente:

1. `sendContextualUpdate(<contexto del cliente>)` — silencioso (nombre, compra, etc.).
2. ~150 ms de delay → `sendUserMessage("[START]")` — dispara el saludo personalizado.
3. El system prompt del agente trata `[START]` como señal de inicio y saluda por nombre.

- Guardas: `hasSentContextRef` evita duplicar; ver `ClaraVoiceAgent.tsx` + `utils/heygen/elevenlabs-commands.ts`.

### Saludo Shopify (purchase-aware)

- El tema Liquid redirige a Clara con `customer_id` firmado por **HMAC** (evita el límite de plan Basic
  del Admin API). El contexto incluye `lastOrderProduct` / `lastOrderDate` → saludo tipo
  "Hola {nombre}, vi que compraste {producto}…".
- Archivos: `app/api/shopify-customer/route.ts`, `src/shopify/types.ts`, `shopify-templates/REDIRECT_MIGRATION.md`.

### Audio sin cortes (PR #14)

- ElevenLabs manda chunks irregulares. Fixes: no arrancar detección de gaps hasta 2s de audio;
  evitar doble envío tras flush por buffer-limit; buffers más grandes; padding de silencio solo en
  interrupciones reales. Resultado: ~2-3 blobs/respuesta con gaps de 50ms (inaudibles).

### Beta gate

- `/access` con password (bcrypt) → cookie firmada con **HMAC-SHA256 vía Web Crypto** (edge-safe),
  TTL 7 días, rate-limit en Vercel KV. `middleware.ts` deja `/access` + `/api/access` públicos.
- Fail-safe: si faltan las env vars del gate, se desactiva (no bloquea).

### Google bypass para testers

- En `SHOPIFY_PLAN_LIMITED` o sin órdenes, los testers autenticados con Google entran igual con su
  perfil `{firstName, lastName, email}` (`page.tsx` → `verifySessionEmail`).

### Barge-in (interrupción) — DECISIÓN DE DISEÑO

- **El usuario DEBE poder interrumpir a Clara por voz** (full-duplex). Esto es lo que la hace interactiva.
- ❌ **NO mutear el mic mientras Clara habla** (half-duplex) como comportamiento por defecto — mata el barge-in.
  Solo aceptable como toggle opcional "modo altavoz". El fix correcto del eco es **AEC del browser**, no mutear.

---

## 5. Archivos críticos

| Qué                    | Dónde                                                                               |
| ---------------------- | ----------------------------------------------------------------------------------- |
| Componente principal   | `apps/demo/src/components/ClaraVoiceAgent.tsx`                                      |
| Comandos del plugin EL | `apps/demo/src/utils/heygen/elevenlabs-commands.ts`                                 |
| Context HeyGen         | `apps/demo/src/liveavatar/LiveAvatarContext.tsx`                                    |
| Verificación / saludo  | `apps/demo/app/page.tsx`                                                            |
| Shopify API            | `apps/demo/app/api/shopify-customer/route.ts`                                       |
| Beta gate              | `apps/demo/src/lib/beta-access.ts`, `app/access/`, `app/api/access/verify/route.ts` |
| Auth                   | `apps/demo/auth.ts`, `middleware.ts`                                                |
| DB                     | `apps/demo/prisma/schema.prisma`, `src/lib/db/`                                     |
| Logger                 | `apps/demo/src/lib/logger/secure-logger.ts`, `app/api/client-log/route.ts`          |
| SDK público            | `packages/js-sdk/` (NO tocar sin plan aprobado)                                     |

---

## 6. Comandos

```bash
cd liveavatar-web-sdk
pnpm dev          # Monorepo (puerto 3001)
pnpm demo         # Solo demo app
pnpm build        # Build all — OBLIGATORIO antes de push
pnpm typecheck    # TypeScript
pnpm lint         # ESLint
pnpm test         # Vitest (con coverage)
```

---

## 7. 🚨 Protocolo de Pull Requests (CRÍTICO)

| ✅ Claude PUEDE                | ❌ Claude NO PUEDE                        |
| ------------------------------ | ----------------------------------------- |
| Crear branches                 | **Mergear PRs** (`gh pr merge` PROHIBIDO) |
| Commits                        | Push directo a `master`/`develop`         |
| Push de feature branches       | Aprobar PRs                               |
| **Crear** PRs (`gh pr create`) | Bypass de branch protection               |

> **El usuario** revisa, aprueba y **mergea** los PRs. Claude crea el PR, comparte el link y **PARA**.

### Git workflow

```bash
git checkout develop && git pull origin develop
git checkout -b feature/nombre
# ...trabajar (commits frecuentes)...
git push -u origin feature/nombre
gh pr create --base develop --head feature/nombre --title "..." --body "..."
# ⛔ STOP — esperar aprobación del usuario
```

---

## 8. Mejores prácticas que seguimos (workflow comprobado)

1. **Feature nueva → brainstorming → spec → plan → ejecución.** Usamos las skills de superpowers:
   `brainstorming` → `writing-plans` → `subagent-driven-development` (subagente fresco por tarea +
   review de spec y de calidad). Specs en `docs/superpowers/specs/`, planes en `docs/superpowers/plans/`.
2. **TDD donde aplica.** Tests en `apps/demo/src/__tests__/` (Vitest, alias `@/src`). 55 tests verdes hoy.
3. **Verificar antes de declarar hecho:** `pnpm typecheck && pnpm test && pnpm build` ANTES de push.
   Nunca marcar `passes: true` sin test en browser real.
4. **UNA feature por branch/PR.** PRs chicos y enfocados; cada uno debe poder mergearse solo.
5. **No tocar `packages/js-sdk/src/`** (SDK público) sin plan aprobado.
6. **Documentar workarounds** en `docs/TROUBLESHOOTING.md`.
7. **Mantener tracking files al día** (`.claude/tracking/*`, `.claude/sessions/claude-progress.txt`).
8. **Cambios sensibles** (audio, barge-in, saludo) → testear en preview antes de prod.

---

## 9. Uso de Skills (auto-invocar)

| Skill                                                                                                                                | Cuándo                                                                                                 |
| ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| **`clara-voice-agent`**                                                                                                              | Cualquier trabajo sobre el pipeline de voz/avatar de Clara.                                            |
| **`anthropic-skills:liveavatar`** / **`liveavatar-integrate`**                                                                       | Integrar/extender LiveAvatar; elegir Embed vs FULL vs LITE vs Plugin; sesión, eventos, secrets, voces. |
| **`liveavatar-debug`**                                                                                                               | Avatar mudo, audio garbled, sesión no arranca, eventos que no llegan, errores de API.                  |
| **`shopify-expert`**                                                                                                                 | Tema Liquid, Storefront/Admin API, HMAC, webhooks.                                                     |
| **superpowers** (`brainstorming`, `writing-plans`, `subagent-driven-development`, `systematic-debugging`, `test-driven-development`) | Todo feature/bugfix nuevo.                                                                             |

### Context7 (docs en vivo) — auto-invocar para:

- `@heygen/liveavatar-web-sdk` → **HeyGen LiveAvatar** (LITE Mode, ElevenLabs Agent connector).
- **ElevenLabs Conversational AI / Agents** → eventos client-to-server, `contextual_update`, plugin.
- **Next.js 16 App Router**, **Prisma 6**, **NextAuth 5**, **shadcn/ui**, **LiveKit client**.

> El plugin de ElevenLabs Agent y el connector se documentan en la skill LiveAvatar; usar esa skill
>
> - Context7 ANTES de escribir código del plugin (elegir mal el modo cuesta semanas de rework).

---

## 10. Environment Variables

```bash
# apps/demo/.env.local
HEYGEN_API_KEY=xxx
ELEVENLABS_API_KEY=xxx
ELEVENLABS_AGENT_ID=agent_xxx          # agente "clara-ai"

# Shopify
SHOPIFY_STORE_DOMAIN=betaskintech.myshopify.com
SHOPIFY_ADMIN_ACCESS_TOKEN=shpat_xxx
SHOPIFY_HMAC_SECRET=xxx                 # = shop.metafields.custom.hmac_secret

# DB / cache
POSTGRES_PRISMA_URL=postgres://...
# Vercel KV (rate-limit, beta gate)
KV_REST_API_URL=...
KV_REST_API_TOKEN=...

# Beta gate (si faltan → gate desactivado, fail-safe)
BETA_ACCESS_PASSWORD=...
BETA_ACCESS_COOKIE_SECRET=...
```

---

## 11. Limitaciones conocidas

| Issue                  | Status                                                 | Workaround                                                    |
| ---------------------- | ------------------------------------------------------ | ------------------------------------------------------------- |
| Safari iOS             | ⚠️ Limitado                                            | `SafariFallbackScreen` + banner                               |
| Latencia 1-2s          | By design                                              | Aceptable para conversación natural                           |
| Eco "Clara habla sola" | 🔴 Device-específico, no reproducible en setup del dev | Pendiente: telemetría para diagnosticar; fix = AEC, NO mutear |
| DB tracking            | 🟡 Prisma 6 OK, sin verificar escritura real           | Confirmar en QA de preview                                    |
| Sesiones > 10 min      | ⚠️ Pueden expirar                                      | `SESSION_STOPPED` + (TODO) keep-alive                         |

---

## 12. Tracking & docs

| Archivo                                | Propósito                                |
| -------------------------------------- | ---------------------------------------- |
| `.claude/sessions/claude-progress.txt` | Log de sesiones (actualizar cada sesión) |
| `.claude/tracking/feature_list.json`   | Estado de features                       |
| `.claude/tracking/blockers.json`       | Bloqueadores                             |
| `docs/QA_CHECKLIST.md`                 | Checklist de QA antes de promover a prod |
| `docs/TROUBLESHOOTING.md`              | Problemas y soluciones                   |
| `docs/superpowers/specs/` · `plans/`   | Specs y planes de features               |
