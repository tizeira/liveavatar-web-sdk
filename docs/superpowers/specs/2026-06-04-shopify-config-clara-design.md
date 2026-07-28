# Configuración Shopify para Clara (estado actual del código) — Design

**Fecha:** 2026-06-04
**Objetivo:** Conectar Shopify → Clara de punta a punta usando **exactamente lo que el código ya soporta hoy** (Opción 1: identidad + última compra, sin historial completo ni perfil de piel). El código está; falta provisionar el lado Shopify.

**Alcance:** A1 (asesora de rutina sobre la última compra) + configuración. **Fuera de alcance:** historial completo de productos, metafields de piel (`skin_type`/`skin_concerns`), catálogo/recomendación. Quedan como iteraciones futuras.

---

## 1. Contrato que el código espera (verificado en el repo)

Fuentes: `apps/demo/src/shopify/security.ts`, `apps/demo/app/api/shopify-customer/route.ts`, `apps/demo/app/page.tsx`.

### Trigger

`page.tsx` activa el flujo Shopify solo si la URL trae **ambos**: `shopify_token` **y** `customer_id`. Si faltan → `/login`.

### HMAC (make-or-break)

- `verifyCustomerToken(token, customerId)` calcula `expected = HMAC_SHA256(key = SHOPIFY_HMAC_SECRET, msg = customerId).hex` y compara timing-safe.
- `customerId` = id **numérico** (se le quita el prefijo `gid://shopify/Customer/`).
- En Liquid, `customer.id` ya es numérico → `{{ customer.id | hmac_sha256: hmac_secret }}` produce exactamente ese hex.
- **El secreto del Liquid (`shop.metafields.custom.hmac_secret`) debe ser byte-idéntico a la env `SHOPIFY_HMAC_SECRET`.**

### Parámetros de URL que el código lee (`page.tsx` líneas 47-54)

`customer_id`, `shopify_token`, `first_name`, `last_name`, `email`, `orders_count`, `last_order_product`, `last_order_date`.
(`skin_type` / `skin_concerns` también se leerían, pero en A1 **no se envían**.)

---

## 2. Piezas a configurar (5)

| #   | Pieza                                                                 | Dónde                                                      | Ejecuta                            |
| --- | --------------------------------------------------------------------- | ---------------------------------------------------------- | ---------------------------------- |
| 1   | Metafield shop `custom.hmac_secret` (valor random fuerte)             | Shopify admin → Settings → Custom data → Metafields → Shop | Usuario                            |
| 2   | Env `SHOPIFY_HMAC_SECRET` = mismo valor (preview **y** prod)          | Vercel                                                     | Usuario (o Claude con comando)     |
| 3   | Página `clara` + template `page.clara.liquid`                         | Shopify admin → Online Store → Themes → Edit code          | Usuario (pega el archivo del repo) |
| 4   | Botón/link "Hablá con Clara" → `/pages/clara`                         | Theme (cuenta de cliente / menú)                           | Usuario                            |
| 5   | System prompt del agente `clara-ai` (`[START]`) + First message vacío | ElevenLabs dashboard                                       | Usuario                            |

> Claude no tiene acceso al admin de Shopify ni al dashboard de ElevenLabs. Entregable del repo:
> `apps/demo/shopify-templates/page.clara.liquid` (archivo exacto) + `SHOPIFY_SETUP.md` (guía paso a paso).
> Los pasos 1, 3, 4, 5 los aplica el usuario copiando/pegando. El paso 2 lo puede hacer Claude si hay Vercel CLI; si no, se entrega el comando.

---

## 3. Template Liquid exacto (`page.clara.liquid`)

> **Fix vs. snippet viejo de REDIRECT_MIGRATION.md:** el snippet anterior hacía
> `widget_url | append: '&k=' | append: value | url_encode`, lo que **url-encodea TODA la URL**
> (rompe `?`, `&`, `=`). Acá se encodea **solo el valor** en una variable temporal antes de appendear.

```liquid
{%- comment -%}
  page.clara.liquid
  Redirige al cliente logueado a Clara con su contexto firmado por HMAC.
  Requiere: shop metafield custom.hmac_secret == SHOPIFY_HMAC_SECRET (Vercel).
  Para testear en preview, cambiar clara_base a https://testers.betaskintech.com/
{%- endcomment -%}

{%- assign clara_base = 'https://clara.betaskintech.com/' -%}
{%- assign hmac_secret = shop.metafields.custom.hmac_secret -%}

{%- if customer and hmac_secret != blank -%}
  {%- assign token = customer.id | hmac_sha256: hmac_secret -%}
  {%- assign widget_url = clara_base | append: '?customer_id=' | append: customer.id | append: '&shopify_token=' | append: token -%}

  {%- if customer.first_name != blank -%}
    {%- assign enc = customer.first_name | url_encode -%}
    {%- assign widget_url = widget_url | append: '&first_name=' | append: enc -%}
  {%- endif -%}
  {%- if customer.last_name != blank -%}
    {%- assign enc = customer.last_name | url_encode -%}
    {%- assign widget_url = widget_url | append: '&last_name=' | append: enc -%}
  {%- endif -%}
  {%- if customer.email != blank -%}
    {%- assign enc = customer.email | url_encode -%}
    {%- assign widget_url = widget_url | append: '&email=' | append: enc -%}
  {%- endif -%}
  {%- assign widget_url = widget_url | append: '&orders_count=' | append: customer.orders_count -%}

  {%- if customer.last_order != blank -%}
    {%- assign last_item = customer.last_order.line_items.first -%}
    {%- if last_item != blank -%}
      {%- assign enc = last_item.title | url_encode -%}
      {%- assign widget_url = widget_url | append: '&last_order_product=' | append: enc -%}
    {%- endif -%}
    {%- assign enc = customer.last_order.created_at | url_encode -%}
    {%- assign widget_url = widget_url | append: '&last_order_date=' | append: enc -%}
  {%- endif -%}

  <div class="clara-loading" style="text-align:center;padding:4rem 1rem;font-family:sans-serif;">
    <p>Conectando con Clara…</p>
  </div>
  <script>
    window.location.replace({{ widget_url | json }});
  </script>
  <noscript>
    <a href="{{ widget_url }}">Continuar a Clara</a>
  </noscript>

{%- elsif customer == blank -%}
  <div style="text-align:center;padding:4rem 1rem;font-family:sans-serif;">
    <p>Iniciá sesión para hablar con Clara.</p>
    <a href="/account/login?return_url=/pages/clara">Iniciar sesión</a>
  </div>
{%- else -%}
  <!-- hmac_secret no configurado: ver SHOPIFY_SETUP.md paso 1 -->
  <div style="text-align:center;padding:4rem 1rem;font-family:sans-serif;">
    <p>Clara no está disponible en este momento.</p>
  </div>
{%- endif -%}
```

**Notas de diseño:**

- `customer.id` y `token` (hex) no necesitan `url_encode`.
- Solo `customer_id` va firmado por HMAC; los datos de compra van sin firmar (riesgo aceptado: son cosméticos para el saludo, no para autorización).
- El gate de acceso (beta password) sigue aplicando en clara.betaskintech.com; este flujo solo provee identidad/compra.

---

## 4. Botón de entrada (paso 4)

En el theme (ej. `customers/account.liquid` o un menú), agregar:

```liquid
<a href="/pages/clara" class="btn">Hablá con Clara</a>
```

---

## 5. System prompt del agente (paso 5)

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

## 6. Verificación (end-to-end)

1. Configurar 1+2 con el mismo secreto. Confirmar `isHmacConfigured()` no falla (no 503).
2. Pegar `page.clara.liquid` (paso 3) y crear la página `clara`.
3. Login en la tienda como cliente con ≥1 orden → abrir `/pages/clara`.
4. Confirmar redirect full-page a clara con `customer_id`, `shopify_token`, `last_order_product` en la URL.
5. En consola: `[EL-CMD] Sending contextual_update` incluye el producto; `[START]` dispara.
6. Clara saluda por nombre + menciona el producto, sin decir "[START]".
7. **Caso negativo:** alterar `shopify_token` en la URL → el backend responde 401 (`Invalid token`) y se loguea sesión `invalid_token`.
8. Cliente con 0 órdenes → saludo genérico, sin mención de compra.
9. DB: aparece fila en `sessions` con `verificationStatus = verified`.

### Manejo de errores (ya en el código)

- Secreto ausente → 503 (`isHmacConfigured` false).
- Token inválido → 401 + tracking `invalid_token`.
- Rate limit → 429.
- Cache hit por email → respuesta cacheada (TTL 24h).

---

## 7. Entregables del repo (lo que Claude crea)

1. `apps/demo/shopify-templates/page.clara.liquid` — template listo para pegar.
2. `apps/demo/shopify-templates/SHOPIFY_SETUP.md` — guía paso a paso (1→5) + verificación + cómo generar el secreto + comando Vercel para la env.
3. Actualizar `REDIRECT_MIGRATION.md` apuntando al nuevo setup (o marcarlo como reemplazado) y notar el fix de `url_encode`.

**Sin cambios de código de la app** (Opción 1 usa el contrato existente). Cero tests nuevos de código; la verificación es manual end-to-end (sección 6).
