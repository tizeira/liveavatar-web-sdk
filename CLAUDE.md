# CLAUDE.md - Clara Voice Agent (LiveAvatar)

## Deployments

| Branch    | Environment | URL                              |
| --------- | ----------- | -------------------------------- |
| `master`  | Production  | https://clara.betaskintech.com   |
| `develop` | Preview     | https://testers.betaskintech.com |

## Quick Commands

```bash
cd liveavatar-web-sdk
pnpm dev                    # Monorepo completo (puerto 3001)
pnpm demo                   # Solo demo app
pnpm build                  # Build all (OBLIGATORIO antes de push)
pnpm typecheck              # TypeScript check
pnpm lint                   # ESLint
pnpm test                   # Tests con coverage
```

## Git Workflow

```bash
# Nueva feature
git checkout develop && git pull origin develop
git checkout -b feature/nombre
# ... trabajar ...
git push -u origin feature/nombre
gh pr create --base develop --head feature/nombre --title "..." --body "..."
# ⚠️ STOP AQUÍ - NO MERGEAR - Esperar aprobación del usuario

# Hotfix urgente
git checkout master
git checkout -b hotfix/descripcion
# ... fix ...
gh pr create --base master --head hotfix/descripcion --title "..." --body "..."
# ⚠️ STOP AQUÍ - NO MERGEAR - Esperar aprobación del usuario
```

## 🚨 PULL REQUEST PROTOCOL (CRÍTICO)

### ✅ PERMITIDO (Claude Code)

- ✅ Crear branches (`git checkout -b feature/...`)
- ✅ Hacer commits (`git commit -m "..."`)
- ✅ Push branches (`git push -u origin feature/...`)
- ✅ **CREAR PRs** (`gh pr create --base develop ...`)

### ❌ PROHIBIDO (Claude Code)

- ❌ **MERGEAR PRs** (`gh pr merge` está PROHIBIDO)
- ❌ Push directo a `master` o `develop`
- ❌ Aprobar PRs automáticamente
- ❌ Bypass de branch protection rules

### 👤 SOLO EL USUARIO PUEDE

- 👤 Revisar PRs en GitHub
- 👤 Aprobar PRs
- 👤 **MERGEAR PRs** (botón en GitHub UI o `gh pr merge` manual)
- 👤 Deploy manual a producción (si configurado)

### Flujo Correcto

```
┌──────────────────────────────────────────────────────────┐
│  1. Claude: Desarrolla código en feature branch          │
│  2. Claude: git commit && git push                       │
│  3. Claude: gh pr create (NO merge)                      │
│  4. Claude: "PR creado: https://github.com/.../pull/X"   │
│  5. Claude: STOP - Espera aprobación                     │
│                                                           │
│  6. Usuario: Revisa PR en GitHub                         │
│  7. Usuario: Testea en preview (opcional)                │
│  8. Usuario: Aprueba y mergea PR                         │
│  9. Usuario: Vercel auto-deploya (o manual)              │
└──────────────────────────────────────────────────────────┘
```

## Session Protocol

### Inicio (OBLIGATORIO)

```bash
./init.sh                                    # 1. Verificación completa
cat .claude/sessions/claude-progress.txt     # 2. Última sesión
cat .claude/tracking/feature_list.json       # 3. Features pendientes
# 4. Elegir UNA feature HIGH priority
# 5. Anunciar: "Trabajando en [feature-id]"
```

### Fin (OBLIGATORIO)

```bash
cd liveavatar-web-sdk && pnpm build          # 1. Verificar build
git add . && git commit -m "tipo: desc"      # 2. Commit
# 3. Actualizar .claude/sessions/claude-progress.txt
# 4. Si feature completa → passes: true en feature_list.json
```

## Arquitectura (30 segundos)

```
┌─────────────────────────────────────────────────────────────────────┐
│                     CLARA VOICE AGENT                                │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  liveavatar-web-sdk/                                                 │
│  ├── apps/demo/                                                      │
│  │   └── ClaraVoiceAgent                                            │
│  │       ├── ElevenLabs (STT/TTS)                                   │
│  │       └── HeyGen (Lip Sync)                                      │
│  └── packages/js-sdk/                                               │
│      └── @heygen/liveavatar-web-sdk                                 │
│                                                                      │
│  Usuario habla → Mic (44.1kHz)                                       │
│      ↓ resample 16kHz                                                │
│  ElevenLabs WebSocket (STT + LLM + TTS)                              │
│      ↓ chunks audio 16kHz                                            │
│  Audio Buffer (200-500ms)                                            │
│      ↓ resample 24kHz                                                │
│  HeyGen LiveAvatar (lip-sync video)                                  │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

## Archivos Críticos

| Qué                        | Dónde                                                               |
| -------------------------- | ------------------------------------------------------------------- |
| Componente principal Clara | `liveavatar-web-sdk/apps/demo/src/components/ClaraVoiceAgent.tsx`   |
| Hook ElevenLabs            | `liveavatar-web-sdk/apps/demo/src/hooks/useElevenLabsAgent.ts`      |
| Context HeyGen             | `liveavatar-web-sdk/apps/demo/src/liveavatar/LiveAvatarContext.tsx` |
| SDK público                | `liveavatar-web-sdk/packages/js-sdk/`                               |

## Reglas Críticas

### PROHIBIDO

- ❌ **MERGEAR PRs** - Solo crear PRs, NUNCA mergear (`gh pr merge` PROHIBIDO)
- ❌ Modificar `packages/js-sdk/src/` sin plan aprobado (es el SDK público)
- ❌ Push directo a `master` o `develop` - usar PRs siempre
- ❌ Push sin `pnpm build` passing
- ❌ Marcar feature como `passes: true` sin test en browser real

### OBLIGATORIO

- ✅ Todo trabajo nuevo en `develop` primero
- ✅ UNA feature por sesión
- ✅ **CREAR PRs** pero **NO MERGEAR** - Esperar aprobación del usuario
- ✅ Test en preview antes de merge a master
- ✅ Test end-to-end en Chrome/Firefox/Safari antes de declarar completo
- ✅ Documentar workarounds en `docs/TROUBLESHOOTING.md`
- ✅ Commit después de cada cambio funcional

## Limitaciones Conocidas

| Issue                    | Status                       | Workaround                                 |
| ------------------------ | ---------------------------- | ------------------------------------------ |
| Safari iOS               | ⚠️ Funciona con limitaciones | Banner de advertencia, fallback disponible |
| Latencia 1-2s            | By design                    | Aceptable para conversación natural        |
| Sesiones largas (>10min) | ⚠️ Puede expirar             | Implementar keep-alive (TODO)              |
| Audio cortado            | Respuestas cortas            | Buffer mínimo 200ms                        |

## Environment Variables

```bash
# liveavatar-web-sdk/apps/demo/.env.local (REQUERIDAS)
HEYGEN_API_KEY=xxx
ELEVENLABS_API_KEY=xxx
ELEVENLABS_AGENT_ID=agent_xxx

# Shopify Integration
SHOPIFY_STORE_DOMAIN=betaskintech.myshopify.com
SHOPIFY_ADMIN_ACCESS_TOKEN=shpat_xxx
SHOPIFY_HMAC_SECRET=xxx  # Mismo valor que shop.metafields.custom.hmac_secret
```

## Tracking Files

| Archivo                                | Propósito       | Actualizar       |
| -------------------------------------- | --------------- | ---------------- |
| `.claude/sessions/claude-progress.txt` | Log sesiones    | Cada sesión      |
| `.claude/tracking/feature_list.json`   | Estado features | Al completar     |
| `.claude/tracking/blockers.json`       | Bloqueadores    | Cuando aparezcan |

## Documentación Extendida

- Arquitectura completa: `docs/PROJECT_KNOWLEDGE.md`
- Problemas y soluciones: `docs/TROUBLESHOOTING.md`
- **Estrategia de branches**: `liveavatar-web-sdk/.github/BRANCH_STRATEGY.md`
- Guía HeyGen: `avatar-custom-audio.md`
- Guía ElevenLabs: `liveavatar-elevenlabs.md`

## Context7 Auto-Invoke

Usar automáticamente para:

- `@heygen/liveavatar-web-sdk` → HeyGen LiveAvatar docs
- `ElevenLabs WebSocket API` → ElevenLabs Conversational AI docs
- `Next.js 15 App Router` → Next.js docs
- `shadcn/ui` → shadcn docs

## Requisitos Sistema

- Node.js >= 22
- pnpm 9.0.0
- Chrome/Firefox/Safari para testing
- Vercel CLI para deploys (`npm i -g vercel`)
