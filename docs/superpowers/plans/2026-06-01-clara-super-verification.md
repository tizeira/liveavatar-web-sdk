# Clara — Diagnóstico comparativo: Google (bien) vs Demo (mal)

> Plan de diagnóstico. Clara funciona bien al entrar por Google, pero la cuenta demo hardcodeada se porta mal: habla sola, incoherencias, lip-sync malo. Objetivo: aislar qué es diferencia de código/flow (demo-específico) vs qué es ambiental (eco, afecta a cualquiera con parlantes). **NO se ejecutan cambios durante el diagnóstico.**

---

## 1. Diferencias de código verificadas entre los dos flujos

Ambos terminan en `setPageState("verified")` → renderizan el MISMO `ClaraVoiceAgent`. La maquinaria de sesión/saludo/audio es idéntica una vez verificado. Las únicas diferencias están en **cómo y cuándo se arma `customerData`**:

| Aspecto             | Google (`verifySessionEmail`)                                                                                  | Demo (`testEmails` bypass, page.tsx:283)   |
| ------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| Disparo             | `verifySessionEmail(email)` → fetch async a `/api/verify-customer`                                             | bypass **síncrono** inmediato              |
| `customerData`      | `{ firstName, lastName, email }` (o datos ricos: skinType/skinConcerns/orders si el cliente existe en Shopify) | `{ firstName, email }` — **solo 2 campos** |
| `lastName`          | presente                                                                                                       | **ausente**                                |
| Contexto para Clara | más rico (puede incluir datos reales de Shopify)                                                               | mínimo (solo nombre)                       |
| Timing              | `customerData` llega **después** del fetch async                                                               | `customerData` seteado **antes** (sync)    |

**Conclusión honesta:** estas diferencias NO explican por sí solas "habla sola". Una vez `verified`, el componente, la sesión HeyGen, el trigger de saludo y el pipeline de audio son idénticos. Lo que SÍ podrían explicar las diferencias:

- **"Incoherencias"** → plausible: el contexto pobre de demo (solo nombre) da menos grounding al agente → más propenso a divagar.
- **"Habla sola" / lip-sync malo** → NO se explica por el código demo-vs-Google. Apunta a causa ambiental (eco) o a una condición que el usuario reproduce distinto en cada test.

---

## 2. Hipótesis rankeadas

### H1 — Eco acústico / half-duplex incompleto (ambiental, afecta a cualquiera) ⭐

El mic se mutea solo durante el saludo; después queda abierto. El `<video>` del avatar suena con `muted={false}` (ClaraVoiceAgent.tsx:411). Con parlantes/volumen alto, la voz de Clara entra al mic → VAD la detecta → STT la transcribe → el agente se responde a sí mismo → habla sola + incoherente + el re-trigger rompe el lip-sync.

- **Por qué al usuario no le pasa con Google:** probablemente probó Google con auriculares/volumen bajo y demo con parlantes. NO es demo-específico — es condición de audio.
- **Confirmación:** el mismo problema debe reproducirse con Google + parlantes a volumen alto.

### H2 — Contexto pobre de demo → incoherencia del agente (demo-específico)

El bypass demo manda solo `{firstName, email}`. Si el system prompt del agente espera más contexto, con demo improvisa más. Explica "incoherencias" pero NO "habla sola".

### H3 — Bypass demo desactualizado (demo-específico, menor)

`page.tsx:283` es un bloque hardcodeado escrito antes de los cambios de saludo: omite `lastName` y no pasa por `verifySessionEmail`. Es divergencia/deuda, probablemente cosmético respecto al mal comportamiento.

### H4 — Re-trigger por timing async (afectaría a Google, no a demo)

El `customerData` de Google llega async → el effect de saludo (`[isStreamReady, customerData]`) podría re-correr. Mitigado por `hasSentContextRef`. Bajo riesgo y, de existir, perjudicaría a Google — lo contrario de lo reportado. Descartable salvo que falle el guard.

---

## 3. Tests discriminantes (los corre el usuario en browser)

### T1 — Demo + auriculares (decisivo para H1)

- [ ] Entrar con cuenta demo, AURICULARES, conversar.
- [ ] **Mejora/desaparece "habla sola"** → era eco (H1), no el flow demo.
- [ ] **Sigue mal** → no es eco; ir a T3.

### T2 — Google + parlantes a volumen alto (confirma H1 es ambiental)

- [ ] Entrar con Google, parlantes fuerte, conversar.
- [ ] **También habla sola** → confirma: H1 es universal, no demo-específico.

### T3 — Logs lado a lado (Google vs Demo)

Con consola abierta durante el mal comportamiento, comparar:

- [ ] ¿`[EVT] EL:user_transcript` contiene palabras que dijo CLARA (no el usuario)? → eco confirmado.
- [ ] ¿Cuántos `conversation_initiation_metadata`? (>1 = duplicación, bug aparte)
- [ ] ¿Qué `customerData` se logueó en cada caso? (confirmar la diferencia de campos)

### T4 — Demo + auriculares pero AÚN incoherente (aísla H2)

- [ ] Si sin eco igual divaga → es el contexto pobre / system prompt → fix H2.

---

## 4. Restricción de diseño: NO romper la interrupción (barge-in)

Poder interrumpir a Clara mientras habla es lo que hace la conversación interactiva y natural (vs un mensaje grabado). **Cualquier fix de eco DEBE preservar el barge-in.** Mutear el mic mientras Clara habla (half-duplex) elimina el eco pero MATA la interrupción → es una regresión de UX, no un fix aceptable como default.

El objetivo correcto es **full-duplex con rechazo de eco**: el mic escucha al usuario (interrupción posible) pero NO a Clara. Eso es exactamente para lo que existe la cancelación de eco acústico (AEC), igual que en una llamada telefónica.

## 5. Fixes candidatos (se deciden DESPUÉS del diagnóstico)

| Fix                                                                                                                                                                                                                                                                           | Aborda                     | Barge-in                     | Confianza                   | Alcance                                               |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- | ---------------------------- | --------------------------- | ----------------------------------------------------- |
| **A. Verificar/forzar AEC del browser** — confirmar que `echoCancellation:true` se aplica al track publicado y que el audio del avatar (`<video muted={false}>`, ClaraVoiceAgent.tsx:411) está en el grafo de referencia del AEC. Cancela la voz de Clara del mic SIN mutear. | "habla sola" (H1)          | ✅ preservado                | Alta — es EL fix correcto   | SDK VoiceChat / cómo se reproduce el audio del avatar |
| **B. Tunear VAD/umbral de interrupción en ElevenLabs** — subir el umbral para que solo dispare con voz clara del usuario, no con eco bajo.                                                                                                                                    | "habla sola" (H1)          | ✅ preservado                | Media — ajuste en dashboard | Agente ElevenLabs (config)                            |
| **C. Modo "altavoz" opcional (half-duplex)** — mute en `AVATAR_SPEAK_STARTED`, unmute en `AVATAR_SPEAK_ENDED`, SOLO si el usuario lo activa (lugares ruidosos con parlantes). Nunca default.                                                                                  | "habla sola" como fallback | ❌ se pierde mientras activo | Baja — última opción        | `ClaraVoiceAgent.tsx` (toggle)                        |
| **D. Enriquecer/unificar contexto demo** — rutear demo por el mismo path que Google o darle contexto consistente.                                                                                                                                                             | incoherencia (H2/H3)       | n/a                          | Media — depende de T4       | `page.tsx` bypass demo                                |
| **E. Refrescar bypass demo desactualizado** — agregar `lastName`, alinear con el shape actual.                                                                                                                                                                                | deuda (H3)                 | n/a                          | Alta — consistencia         | `page.tsx:283`                                        |

**Importante:** NINGÚN fix se ejecuta sin confirmar el diagnóstico (el usuario pidió no ejecutar cambios). A es el camino correcto pero requiere primero verificar cómo se reproduce el audio del avatar y si el AEC lo referencia.

---

## 6. Orden de ejecución propuesto (tras diagnóstico)

1. **Usuario corre T1/T2** (auriculares vs parlantes) → confirma si "habla sola" es eco.
2. Si es eco → **investigar Fix A** (AEC): leer cómo el SDK/`ClaraVoiceAgent` reproduce el audio del avatar y publica el mic; confirmar que el AEC tiene la referencia correcta. Solo después, branch + PR.
3. Si A no alcanza → **Fix B** (tunear interrupción en ElevenLabs).
4. Según T3/T4 → **Fix D/E** (contexto demo) por las "incoherencias".
5. **Fix C** solo como toggle opcional, jamás default.

---

## Notas

- La voz de Clara entrando al mic es el patrón clásico de voice-agent. La solución correcta NO es turn-taking estricto (mute), sino AEC — permite barge-in. ElevenLabs maneja parte server-side, pero vía el plugin HeyGen el audio pasa primero por el mic del browser → la cancelación de eco depende del browser/AEC y falla con parlantes a volumen alto.
- El deploy `testers` (branch `develop`) tiene la lógica de saludo previa a PR #17/#19. Cualquier fix debe ir sobre `develop` para que aplique a testers.
- "Habla sola" es ambiental (eco con parlantes), no demo-específico → por eso a vos con Google no te pasa. "Incoherencias" sí puede ser parcialmente demo-específico (contexto pobre).
