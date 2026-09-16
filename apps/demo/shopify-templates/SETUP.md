# Shopify → Clara — Setup (estado actual del código)

Guía única y vigente para conectar Shopify con Clara. Reemplaza a `REDIRECT_MIGRATION.md`
(migración iframe→redirect, ya incorporada acá).

**Alcance (Opción 1):** Clara conoce **nombre + identidad + última compra**. Asesora sobre la
rutina de lo que el cliente ya compró. Fuera de alcance: historial completo, perfil de piel
(metafields `skin_type`/`skin_concerns`), catálogo/recomendación.

**Cómo funciona:** la página `/pages/clara` en Shopify firma el `customer.id` con HMAC y hace un
**redirect full-page** (sin iframe) a Clara, pasando los datos del cliente por la URL. El backend
valida el HMAC y personaliza el saludo.

---

## Flujo

```
Cliente logueado → /pages/clara (Shopify)
   page.clara.liquid: token = HMAC_SHA256(customer.id, secret)
   redirect → clara.betaskintech.com/?customer_id=…&shopify_token=…&first_name=…&last_order_product=…
        │
        ▼
Clara (Next.js): page.tsx detecta shopify_token+customer_id
   → POST /api/shopify-customer  (valida HMAC timing-safe)
   → contextual_update con el contexto + sendUserMessage("[START]")
   → Clara saluda por nombre y menciona la última compra
```

---

## Contrato HMAC (no romper)

- Backend (`src/shopify/security.ts`): `expected = HMAC_SHA256(key = SHOPIFY_HMAC_SECRET, msg = customer.id_numerico).hex`.
- Liquid: `{{ customer.id | hmac_sha256: hmac_secret }}` → `customer.id` ya es numérico → matchea.
- **El secreto del metafield `custom.hmac_secret` debe ser BYTE-IDÉNTICO a la env `SHOPIFY_HMAC_SECRET`** (sin espacios).

Parámetros que el backend lee: `customer_id`, `shopify_token`, `first_name`, `last_name`, `email`,
`orders_count`, `last_order_product`, `last_order_date`.

---

## Pasos

### 1. Generar el secreto

```bash
openssl rand -hex 32          # o: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Guardá ese valor; va EN DOS LADOS idénticos (paso 2 y 3). **No lo commitees al repo.**

### 2. Metafield en Shopify

Shopify admin → **Settings → Custom data → Metafields → Shop** → **Add definition**:

- Namespace and key: `custom.hmac_secret`
- Type: **Single line text**
- Luego, en el valor del metafield de la tienda, pegar el secreto del paso 1.

### 3. Env en Vercel (mismo valor)

**Opción CLI** (requiere `vercel login` + `vercel link` una vez, en `apps/demo/`):

```bash
cd apps/demo
vercel login                 # interactivo (lo hace el usuario)
vercel link                  # elegir el proyecto de Clara
# agregar a los 3 entornos con el MISMO secreto del paso 1:
printf '%s' '<SECRETO_PASO_1>' | vercel env add SHOPIFY_HMAC_SECRET production
printf '%s' '<SECRETO_PASO_1>' | vercel env add SHOPIFY_HMAC_SECRET preview
printf '%s' '<SECRETO_PASO_1>' | vercel env add SHOPIFY_HMAC_SECRET development
vercel deploy                # o redeploy desde el dashboard para tomar la env
```

**Opción dashboard:** Project Settings → Environment Variables → `SHOPIFY_HMAC_SECRET` = secreto del paso 1
(marcar Production + Preview). Redeploy.

> Verificá que NO quede 503: si `isHmacConfigured()` es false (env ausente) el endpoint responde 503.

### 4. Template + página en Shopify

1. Online Store → **Themes → Edit code → Templates → Add a new template** → Type `page`, name `clara`.
2. Pegar el contenido de **`page.clara.liquid`** (este folder). Por defecto apunta a producción;
   para probar en preview, cambiar `clara_base` a `https://testers.betaskintech.com/`.
3. Online Store → **Pages → Add page** → Title "Clara", Template `page.clara`, handle `clara` (URL `/pages/clara`).

### 5. Botón de entrada

En el theme (cuenta de cliente o menú), agregar un link:

```liquid
<a href="/pages/clara" class="btn">Hablá con Clara</a>
```

### 6. System prompt del agente ElevenLabs

Agente `agent_6901kc9x6f16e0gb7gbwhjk4514r` (`clara-ai`). **First message: VACÍO.** Agregar al system prompt:

> Cuando recibas el mensaje "[START]", es la señal de que un cliente acaba de iniciar la sesión.
> Saludalo cálidamente por su nombre usando el contexto recibido. Si el contexto indica una compra
> reciente, mencionala con naturalidad y ofrecele guiarlo en su rutina (ej: "Hola Ana, vi que
> compraste el Sérum X, ¿querés que te guíe para usarlo en tu rutina?"). Como asesora de skincare de
> BetaSkintech, aconsejá SOBRE los productos que el cliente ya compró: cómo usarlos, en qué orden y en
> qué momento del día. Si no sabés el tipo de piel, preguntáselo. No inventes productos ni recomiendes
> comprar nada nuevo. Nunca muestres el texto "[START]". Si no hay compra reciente, da una bienvenida
> general y ofrecé ayuda.

---

## Verificación end-to-end

1. Secreto en metafield (2) y env (3) **iguales**. Confirmar que el endpoint no responde 503.
2. Login en la tienda como cliente con ≥1 orden → abrir `/pages/clara`.
3. Confirmar **redirect full-page** (no iframe) con `customer_id`, `shopify_token`, `last_order_product` en la URL.
4. Consola del browser: `[EL-CMD] Sending contextual_update` incluye el producto; `[START]` dispara.
5. Clara saluda por nombre + menciona la compra, **sin** decir "[START]".
6. **Caso negativo:** alterar `shopify_token` en la URL → backend 401 (`Invalid token`) + sesión `invalid_token` en DB.
7. Cliente con 0 órdenes → saludo genérico, sin mención de compra.
8. DB: fila en `sessions` con `verificationStatus = verified`.

---

## Troubleshooting

| Síntoma                       | Causa probable                                  | Fix                                                         |
| ----------------------------- | ----------------------------------------------- | ----------------------------------------------------------- |
| 503 Service not configured    | `SHOPIFY_HMAC_SECRET` ausente en Vercel         | Agregar env (paso 3) + redeploy                             |
| 401 Invalid token             | Secreto metafield ≠ env, o espacios             | Igualar byte a byte                                         |
| Va a /login en vez de Clara   | Falta `shopify_token` o `customer_id` en la URL | Revisar que el cliente esté logueado y el metafield exista  |
| Saludo dice "[START]"         | System prompt no configurado                    | Paso 6                                                      |
| Caracteres raros en el nombre | url_encode mal aplicado                         | Usar `page.clara.liquid` de este folder (encodea por valor) |

---

## Archivos en este folder

| Archivo                                           | Estado                                                                |
| ------------------------------------------------- | --------------------------------------------------------------------- |
| `page.clara.liquid`                               | ✅ **VIGENTE** — redirect, url_encode correcto, incluye última compra |
| `SETUP.md`                                        | ✅ Esta guía (canónica)                                               |
| `REDIRECT_MIGRATION.md`                           | ⛔ Reemplazado por SETUP.md (histórico)                               |
| `page.clara-v2.liquid`, `page.clara-debug.liquid` | ⛔ Variantes viejas (iframe). No usar                                 |
