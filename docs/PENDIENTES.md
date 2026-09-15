# Pendientes — Clara Voice Agent

> Tareas que quedaron abiertas de esta sesión de trabajo. Derivadas de lo hecho/hablado
> y de los últimos commits. Fecha: 2026-06-04.
> Contexto de estado: `develop` ~48 commits adelante de `master` (prod desactualizado).
> Últimos commits: `daa64ef` (shopify redirect + setup), `138bd51` (spec shopify), `24e19e2` (CLAUDE.md+tracking+QA).

---

## 🔴 P0 — Shopify → Clara (Opción 1, en curso)

Objetivo: que el cliente entre por la tienda y Clara vea su última compra (el login Google NO ve compras por diseño — Admin API bloqueado).

- [ ] Cargar metafield `custom.hmac_secret` en Shopify = `b6e2bc0ed8256bb0c1fdce4f3422d4253dca64fcc15c17964af345f62ef10981` (mismo valor que ya está en Vercel).
- [ ] Crear página `/pages/clara` con template `page.clara.liquid` (ya quedó apuntando a testers).
- [ ] Probar la **URL firmada** en testers (pasar el beta gate ANTES para tener cookie, sino se pierden los params).
- [ ] Verificar que testers tiene el código de última compra (#19) — último deploy ~15 días; **redeployar `develop` si Clara no menciona la compra**.
- [ ] Agregar botón "Hablá con Clara" → `/pages/clara` en el theme.
- [ ] Configurar system prompt del agente `clara-ai` + First message VACÍO (SETUP.md §6).
- [ ] Mergear **PR #20** (shopify-config → develop) una vez probado.

## 🔴 P0 — Camino a producción

- [ ] Correr **QA en preview** con `docs/QA_CHECKLIST.md` (incluye: saludo Shopify, audio sin cortes, beta gate, barge-in, escritura en DB).
- [ ] Verificar que **DB tracking escribe en Postgres** (Prisma 6) — sesión real → fila en `sessions`.
- [ ] Mergear **PR #14** (`develop → master`) = promoción a producción, SOLO tras QA verde. Es grande (48 commits) → desriesgar antes.

## 🟠 P1 — Blockers de calidad (requieren diseño previo)

- [ ] **Bug "Clara habla sola / incoherencias / lip-sync malo"** (device-específico, no reproducible en dev). Diagnóstico bloqueado hasta tener telemetría. Fix candidato = **AEC del browser** (full-duplex). ⛔ NO mutear el mic (rompe el barge-in).
- [ ] **Telemetría de sesiones** (diseño pausado en brainstorming): capturar cada sesión (logs + dispositivo) en store consultable, digerible por IA. Falta: elegir backend (Postgres vs log-sink) + diseño de PII. Es prerequisito del bug de arriba y del circuit-breaker.
- [ ] **Circuit-breaker / auto-apagado por salud**: si Clara falla para X% de usuarios → desactivar + redirigir con aviso → revisar → reactivar. Base existe (outage banner, PR #13 mergeado). Depende de la telemetría (señales técnicas duras: sin STREAM_READY, sin AVATAR_SPEAK, errores de conexión).

## 🟡 P2 — Features pendientes (del feature_list)

- [ ] **Reconexión WebRTC + manejo de `SESSION_STOPPED`** por `end_reason` (NO_CREDITS, IDLE_TIMEOUT, MAX_DURATION) + 1 reintento en disconnect.
- [ ] **UX de permiso de micrófono**: mensaje claro cuando se deniega (error #1 en mobile).
- [ ] **Shopify Opción B (futuro):** habilitar Admin API con Protected Customer Data aprobado, para que el login Google/email también vea compras.
- [ ] **Historial completo (futuro, Opción 2):** hoy solo se manda la última compra; enriquecer a la lista de productos comprados (cambio chico en route + `sendCustomerContext`).

## 🟢 P3 — Limpieza de repo

- [ ] Rebasar o cerrar **PR #12** (docs/husky, stale 56 commits).
- [ ] Cerrar **PR #4** (OpenAI voice, draft + conflicting, obsoleto).
- [ ] Borrar el **`git stash` colgado** (WIP de feature/shopify-purchase-greeting).
- [ ] Borrar ramas viejas: `feature/elevenlabs-plugin`, `claude/streaming-api-fix`, `fix/audio-first-words`, `claude/integrate-openai-voice-agent-h7m2K`.
- [ ] Revisar `hotfix/security-hardening-apr-2026` (11 commits **sin mergear** — decidir si recuperar o descartar).
- [ ] Actualizar `.claude/sessions/claude-progress.txt` con el cierre de esta sesión.

---

## Referencias

- Setup Shopify: `apps/demo/shopify-templates/SETUP.md`
- Spec Shopify config: `docs/superpowers/specs/2026-06-04-shopify-config-clara-design.md`
- QA: `docs/QA_CHECKLIST.md`
- Contexto/arquitectura: `CLAUDE.md`
- Estado de features: `.claude/tracking/feature_list.json` · Blockers: `.claude/tracking/blockers.json`
