# Saludo personalizado "recién compró" vía redirect Shopify — Design Spec

**Fecha:** 2026-06-01
**Estado:** Aprobado
**Alcance:** Subsistema 1 (personalización Shopify). La memoria entre sesiones es un proyecto aparte.

---

## 1. Objetivo

Cuando un cliente logueado en la tienda Shopify hace clic en "Hablá con Clara", debe ser **redirigido** (no embebido en iframe) a `clara.betaskintech.com` con sus datos firmados. Clara recibe los datos —incluyendo **su última compra**— y, al iniciar la sesión de voz, saluda mencionando ese producto:

> "Hola Ana, vi que compraste el Sérum X, ¿querés que te guíe en tu rutina?"

El escenario objetivo es **"recién compró"** (cliente con al menos una orden). Casos sin compra reusan el saludo genérico ya existente.

---

## 2. Contexto: qué ya existe (no se construye)

La infraestructura Shopify ya está implementada y funcionando. **No se modifica su comportamiento base.**

| Componente | Archivo | Estado |
|---|---|---|
| Snippet Liquid con URL firmada (HMAC) | `apps/demo/shopify-templates/page.clara.liquid` | Existe (usa iframe) |
| Generación HMAC `hmac_sha256` | en el Liquid | Existe |
| Validación HMAC timing-safe | `apps/demo/src/shopify/security.ts` | Existe, sin cambios |
| Endpoint de validación | `apps/demo/app/api/shopify-customer/route.ts` | Existe, se extiende |
| Consumo de params + estado | `apps/demo/app/page.tsx` (`verifyShopifyCustomer`) | Existe, se extiende |
| Cache DB + session tracking | `apps/demo/src/lib/db/queries.ts` | Existe, sin cambios |
| Trigger de saludo `[START]` + contexto silencioso | `apps/demo/src/components/ClaraVoiceAgent.tsx`, `apps/demo/src/utils/heygen/elevenlabs-commands.ts` | Existe (PR #17), se afina |

**Bypass del Admin API:** los datos provienen del template Liquid (acceso nativo a `customer.*` en cualquier plan Shopify), por lo que el límite de plan Basic (`SHOPIFY_PLAN_LIMITED`) **no aplica** a este flujo.

---

## 3. Decisiones de diseño

| Decisión | Elección | Razón |
|---|---|---|
| Firma HMAC | Solo `customer_id` (como hoy) | Los datos de compra son cosméticos (guían un saludo, no autorizan nada). Riesgo de manipulación aceptado. Evita reescribir Liquid + `security.ts`. |
| Botón "volver a la tienda" | No, por ahora | Fuera de alcance. Se puede agregar después. |
| Memoria entre sesiones | Proyecto aparte | Complejidad alta (persistencia, resumen, recall). No en este spec. |
| Redacción del saludo | La genera el agente ElevenLabs | Nosotros pasamos hechos estructurados + directiva; el agente fraseа natural. |
| Trigger | `[START]` (token literal) | Invisible para el usuario; el system prompt del agente lo reconoce como señal de inicio. |

---

## 4. Arquitectura del flujo

```
TIENDA SHOPIFY (cliente logueado)
  page.clara.liquid:
    - construye URL firmada
    - NUEVO: agrega &last_order_product= y &last_order_date=
    - CAMBIO: iframe → redirect full-page (window.location)
       ↓
CLARA (clara.betaskintech.com)
  page.tsx → verifyShopifyCustomer(params):
    - lee params (incl. los 2 nuevos)
    - POST /api/shopify-customer (valida HMAC de customer_id)
    - setCustomerData({ ..., lastOrderProduct, lastOrderDate })
       ↓
  ClaraVoiceAgent.tsx (al SESSION_STREAM_READY):
    - sendCustomerContext(...) → contextual_update silencioso
      incluye: "Última compra: Sérum X (hace N días)"
    - sendUserMessage("[START]")
       ↓
  Agente ElevenLabs (system prompt editado por el usuario):
    - [START] → saluda por nombre + menciona la compra + ofrece guía
```

---

## 5. Componentes y cambios

### 5.1 Liquid — `page.clara.liquid` (lo aplica el usuario)

**Responsabilidad:** construir la URL firmada con los datos del customer y redirigir.

Dos cambios:

1. **Agregar params de última compra** dentro del bloque `if customer and hmac_secret != blank`:

```liquid
{%- if customer.last_order != blank -%}
  {%- assign last_order = customer.last_order -%}
  {%- assign last_item = last_order.line_items.first -%}
  {%- if last_item != blank -%}
    {%- assign widget_url = widget_url | append: '&last_order_product=' | append: last_item.title | url_encode -%}
  {%- endif -%}
  {%- assign widget_url = widget_url | append: '&last_order_date=' | append: last_order.created_at | url_encode -%}
{%- endif -%}
```

2. **Cambiar iframe por redirect.** Reemplazar el bloque `<iframe ...>` por:

```liquid
<script>
  window.location.replace({{ widget_url | json }});
</script>
<noscript>
  <a href="{{ widget_url }}">Continuar a Clara</a>
</noscript>
```

> Nota: se mantiene el `<div class="clara-loading">` como pantalla intermedia mientras redirige. El `customer_id` sigue siendo el único campo firmado por HMAC.

### 5.2 Type — `CustomerData` (`apps/demo/src/liveavatar/types.ts`)

Agregar dos campos opcionales:

```typescript
export interface CustomerData {
  firstName?: string;
  lastName?: string;
  email?: string;
  ordersCount?: number;
  skinType?: "Dry" | "Oily" | "Combination" | "Sensitive" | "Normal";
  skinConcerns?: string[];
  recentOrders?: Array<{
    name: string;
    date: string;
    items: Array<{ title: string; quantity: number }>;
  }>;
  // NUEVO — última compra (del Liquid, para saludo "recién compró")
  lastOrderProduct?: string;
  lastOrderDate?: string; // ISO 8601 desde Liquid (customer.last_order.created_at)
}
```

### 5.3 Request/Response types (`apps/demo/src/shopify/types.ts`)

`ShopifyCustomerRequest` — agregar campos del body:

```typescript
export interface ShopifyCustomerRequest {
  customer_id: string;
  shopify_token: string;
  first_name?: string;
  last_name?: string;
  email?: string;
  orders_count?: string;
  // NUEVO
  last_order_product?: string;
  last_order_date?: string;
}
```

`ShopifyCustomerResponse.customer` — agregar al objeto:

```typescript
  customer: {
    id: string;
    email: string | null;
    firstName: string | null;
    lastName: string | null;
    ordersCount: number;
    skinType?: string;
    skinConcerns?: string[];
    recentOrders?: ShopifyOrder[];
    // NUEVO
    lastOrderProduct?: string;
    lastOrderDate?: string;
  } | null;
```

### 5.4 Endpoint — `apps/demo/app/api/shopify-customer/route.ts`

**Responsabilidad:** validar HMAC y devolver los datos (incluyendo la compra). Sin cambios de seguridad.

Cambios:
1. Desestructurar `last_order_product`, `last_order_date` del body.
2. Incluirlos en el objeto `response.customer` tras validar HMAC (paso 4 actual).
3. El cache (`cacheCustomer`) **no** se modifica para estos campos en este spec (la compra reciente puede cambiar; mantenerla fuera del cache de 24h evita servir datos viejos). Se pasan directo desde el request validado.

> Importante: el bloque "CACHE HIT" temprano (líneas ~85-109) hace short-circuit antes de validar HMAC. Como la compra reciente NO se cachea, en un cache hit `lastOrderProduct` quedaría `undefined`. **Decisión:** adjuntar `last_order_product`/`last_order_date` del request (ya presentes en el body) también en la rama de cache hit, sin requerir que estén cacheados. Así el saludo de compra funciona aunque el resto venga de cache.

### 5.5 Consumo — `apps/demo/app/page.tsx`

En `verifyShopifyCustomer(params)`:
1. Leer `params.get("last_order_product")` y `params.get("last_order_date")`.
2. Enviarlos en el body del POST a `/api/shopify-customer`.
3. Al setear `customerData` desde la respuesta, incluir `lastOrderProduct` y `lastOrderDate`.

### 5.6 Contexto a Clara — `apps/demo/src/utils/heygen/elevenlabs-commands.ts`

En `sendCustomerContext`, agregar un bloque que, si hay `lastOrderProduct`, lo incluya en el texto del `contextual_update`:

```typescript
if (context.lastOrderProduct) {
  const whenStr = formatRelativeDate(context.lastOrderDate); // "hace 3 días" | "" si no parsea
  parts.push(
    `Su compra más reciente fue: ${context.lastOrderProduct}${whenStr ? ` (${whenStr})` : ""}.`,
  );
}
```

`formatRelativeDate(iso?: string): string` — helper nuevo en el mismo archivo: parsea ISO, calcula días de diferencia, devuelve "hoy" / "ayer" / "hace N días" / "" si inválido. La firma del objeto `context` se extiende con `lastOrderProduct?`, `lastOrderDate?`.

### 5.7 Trigger — `apps/demo/src/components/ClaraVoiceAgent.tsx`

El Step 2 (handshake de saludo) ya existe (PR #17). Cambio:
- El trigger pasa de `session.sendUserMessage("Hola")` a `session.sendUserMessage("[START]")`.
- Pasar `lastOrderProduct`/`lastOrderDate` de `customerData` al llamado de `sendCustomerContext`.

### 5.8 System prompt del agente (lo aplica el usuario, ElevenLabs dashboard)

Agregar al prompt del agente `clara-ai`:

> Cuando recibas el mensaje "[START]", es la señal de que un cliente acaba de iniciar la sesión. Saludalo cálidamente por su nombre usando el contexto que recibiste. Si el contexto indica una compra reciente, mencionala con naturalidad y ofrecele guiarlo en su rutina (ej: "Hola Ana, vi que compraste el Sérum X, ¿querés que te guíe en tu rutina?"). Nunca muestres el texto "[START]" en tu respuesta. Si no hay compra reciente, da una bienvenida general.

---

## 6. Manejo de errores y edge cases

| Caso | Comportamiento |
|---|---|
| Cliente sin compras (`orders_count=0`) | `lastOrderProduct` ausente → saludo genérico (rama existente). |
| `last_order_date` inválido o ausente | `formatRelativeDate` devuelve "" → se menciona el producto sin fecha. |
| Cache hit en el endpoint | Se adjuntan `last_order_*` desde el request (no del cache). |
| HMAC inválido | Sin cambios: 401, igual que hoy. |
| Sin JavaScript en la tienda | `<noscript>` con link manual a Clara. |
| Usuario llega sin params (login Google directo) | Flujo existente sin cambios; sin datos de compra. |

---

## 7. Testing

**Unit (vitest):**
- `formatRelativeDate`: "hoy", "ayer", "hace 5 días", "" para input inválido/undefined.
- `sendCustomerContext`: con `lastOrderProduct` incluye la frase de compra; sin él, no.

**Integración manual (preview branch):**
1. Liquid genera URL con `last_order_product` → redirect a Clara.
2. HMAC valida (customer_id) → `customerData.lastOrderProduct` presente.
3. Al iniciar, los logs muestran el `contextual_update` con la compra + `[START]`.
4. El agente saluda mencionando el producto, sin decir "[START]".
5. Caso sin compra → saludo genérico.

---

## 8. Fuera de alcance (explícito)

- Firma HMAC del payload completo (decidido: solo customer_id).
- Botón "volver a la tienda".
- Memoria entre sesiones / recordar conversaciones previas.
- skinType/skinConcerns vía Liquid (los metafields existen pero no se cablean en este spec; el escenario objetivo es "recién compró").
- Cachear la compra reciente en `ShopifyCustomerCache`.
