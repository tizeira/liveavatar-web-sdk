# QA Checklist — Clara Voice Agent

> Correr **en preview** (https://testers.betaskintech.com) antes de promover `develop → master` (PR #14).
> Marcar cada item. Cualquier ❌ bloquea la promoción a producción.
> Browsers objetivo: **Chrome desktop, Firefox desktop, Chrome Android, Safari iOS (fallback)**.

---

## 0. Pre-flight (local, antes de deploy)

- [ ] `pnpm typecheck` → PASS
- [ ] `pnpm test` → todos verdes (hoy: 55/55)
- [ ] `pnpm build` → PASS sin warnings de Prisma ("generation skipped")
- [ ] `pnpm lint` → sin errores nuevos

---

## 1. Acceso y autenticación

- [ ] Abrir preview en incógnito → redirige a `/access` (beta gate activo)
- [ ] Password incorrecta 5 veces → **429 lockout** (rate-limit KV)
- [ ] Password correcta → setea cookie → pasa a `/login`
- [ ] Reabrir pestaña dentro de los 7 días → **no** vuelve a pedir password (cookie persiste)
- [ ] Login con **Google** (tester sin órdenes Shopify) → entra a Clara con su nombre
- [ ] Login con cuenta **demo** hardcodeada → entra a Clara

---

## 2. Arranque de sesión (avatar + voz)

- [ ] El avatar aparece (`STREAM_READY`) en < ~5s
- [ ] No hay overlay tapando el avatar al iniciar
- [ ] Clara **saluda sola** por nombre (handshake `[START]`) — el transcript NO muestra un "Hola" falso del usuario
- [ ] El saludo NO se duplica (una sola conversación, no 3)
- [ ] Permiso de micrófono se pide y, si se deniega, hay mensaje claro

---

## 3. Saludo personalizado / Shopify

- [ ] Entrando vía **redirect de la tienda** (HMAC), el saludo menciona el nombre real
- [ ] Si el cliente tiene compra reciente → el saludo menciona el producto ("vi que compraste …")
- [ ] Fecha de compra se expresa bien ("hoy"/"ayer"/"hace N días"; nunca fecha futura)
- [ ] Cliente sin compras → saludo genérico correcto (sin frases rotas)

---

## 4. Conversación / audio (FOCO PR #14)

- [ ] Respuesta larga (>10s): **sin cortes ni palabras saltadas** entre blobs
- [ ] Respuesta corta (<2s): se reproduce completa, sin truncar
- [ ] Lip-sync alineado con el audio
- [ ] **Barge-in:** interrumpir a Clara hablándole por voz la corta y responde — DEBE funcionar
- [ ] Mute/unmute manual del usuario funciona y se respeta (no se auto-desmutea)
- [ ] ⚠️ **Bug "habla sola":** confirmar que Clara NO se responde a sí misma
  - [ ] En desktop con auriculares
  - [ ] En **móvil con parlantes a volumen alto** (caso reportado por usuarios)
  - [ ] Revisar consola: `USER_TRANSCRIPTION` NO debe contener palabras que dijo Clara

---

## 5. Ciclo de vida de la sesión

- [ ] Sesión > 10 min → manejo correcto (`SESSION_STOPPED`), mensaje al usuario
- [ ] Cerrar/recargar pestaña → la sesión se limpia (sin fugas de listeners/intervals)
- [ ] Pantalla de despedida correcta al terminar

---

## 6. DB / tracking (verificar que Prisma escribe)

- [ ] Tras una sesión real, aparece una fila en la tabla `sessions` (Postgres)
- [ ] `deviceType`, `status`, `verificationStatus` se registran
- [ ] Logs del cliente llegan (revisar Vercel Runtime Logs / `client-log`)

---

## 7. Cross-browser / dispositivo

- [ ] Chrome desktop — flujo completo
- [ ] Firefox desktop — flujo completo
- [ ] Chrome Android — flujo completo (foco: audio + barge-in)
- [ ] Safari iOS — muestra `SafariFallbackScreen` (no se cuelga)

---

## 8. Seguridad / robustez

- [ ] No hay secrets en el bundle del cliente (HMAC secret, API keys solo server-side)
- [ ] Rutas API protegidas (no se puede saltar el gate vía API directa)
- [ ] Si faltan env vars del beta gate → gate se desactiva (fail-safe), no rompe la app

---

## Veredicto

- [ ] **Todo verde → OK para mergear PR #14 (develop → master)**
- Responsable QA: ****\_\_**** · Fecha: ****\_\_**** · Commit develop: ****\_\_****
