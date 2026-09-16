> ⛔ **REEMPLAZADO por `SETUP.md`** (2026-06-04). El snippet Liquid de abajo tenía un bug de
> `url_encode` (encodeaba toda la URL). Usá `page.clara.liquid` + `SETUP.md` de este folder.
> Este archivo queda solo como histórico.

# Migración iframe → redirect + última compra

Dos cambios manuales (no son código del repo): el tema Liquid de Shopify y el
system prompt del agente en ElevenLabs. Aplicalos para que Clara salude a los
clientes que recién compraron, por nombre y producto.

---

## 1. Shopify theme — `page.clara.liquid`

Editar la plantilla `page.clara` (Online Store → Themes → Edit code → Templates).

### 1a. Agregar params de última compra

Dentro del bloque `if customer and hmac_secret != blank`, después de los
`if orders_count` existentes (y antes del `else`), agregar:

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

### 1b. Reemplazar el iframe por un redirect full-page

Reemplazar todo el bloque `<iframe ...></iframe>` por:

```liquid
<script>
  window.location.replace({{ widget_url | json }});
</script>
<noscript>
  <a href="{{ widget_url }}">Continuar a Clara</a>
</noscript>
```

El `<div class="clara-loading">` se mantiene como pantalla intermedia mientras
ocurre el redirect. El `customer_id` sigue siendo el único campo firmado por
HMAC (los datos de compra van sin firmar; riesgo aceptado por ser cosméticos).

**Por qué redirect y no iframe:** elimina los problemas conocidos del iframe
(Safari iOS bloquea mic/cámara, WebRTC/LiveKit con peor performance, cookies de
terceros) y mantiene el bypass del Admin API (el Liquid inyecta los datos en
cualquier plan de Shopify).

---

## 2. ElevenLabs — system prompt del agente `clara-ai`

Agregar al system prompt del agente (`agent_6901kc9x6f16e0gb7gbwhjk4514r`):

> Cuando recibas el mensaje "[START]", es la señal de que un cliente acaba de
> iniciar la sesión. Saludalo cálidamente por su nombre usando el contexto que
> recibiste. Si el contexto indica una compra reciente, mencionala con
> naturalidad y ofrecele guiarlo en su rutina (ej: "Hola Ana, vi que compraste
> el Sérum X, ¿querés que te guíe en tu rutina?"). Nunca muestres el texto
> "[START]" en tu respuesta. Si no hay compra reciente, da una bienvenida general.

**Importante:** el "First message" del agente debe quedar VACÍO. El cliente
controla el inicio del saludo enviando `[START]` después de inyectar el contexto
silencioso, lo que evita que el saludo se corte por el warm-up de WebRTC.

---

## 3. Verificación

1. Login en la tienda como cliente con ≥1 orden → click "Hablá con Clara".
2. Confirmar redirect full-page (no iframe) con `last_order_product` en la URL.
3. En la consola del browser: `[EL-CMD] Sending contextual_update` incluye el
   producto, y el trigger `[START]` se dispara.
4. Clara saluda por nombre + menciona el producto, sin decir "[START]".
5. Cliente con 0 órdenes → saludo genérico, sin mención de compra.
