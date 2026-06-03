# Shopify Purchase-Aware Greeting — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pass the customer's most recent purchase (product + date) from the Shopify Liquid redirect through to Clara, so the ElevenLabs agent greets "recién compró" customers by name and product.

**Architecture:** Extends the existing signed-redirect pipeline (Liquid → `/api/shopify-customer` → `page.tsx` → `ClaraVoiceAgent` → ElevenLabs contextual_update). Adds two optional fields (`lastOrderProduct`, `lastOrderDate`) end-to-end. HMAC stays customer_id-only. No new files except one test file.

**Tech Stack:** Next.js 16, React 19, TypeScript, vitest, `@heygen/liveavatar-web-sdk` (ElevenLabsAgentSession), Shopify Liquid.

**Spec:** `docs/superpowers/specs/2026-06-01-shopify-purchase-greeting-design.md`

**Test command (from repo root):** `pnpm --filter demo exec vitest run <path>`
**Build command (from repo root):** `pnpm build`

---

## Task 1: Add last-order fields to type definitions

**Files:**
- Modify: `apps/demo/src/liveavatar/types.ts` (CustomerData interface)
- Modify: `apps/demo/src/shopify/types.ts` (ShopifyCustomerRequest + ShopifyCustomerResponse)

- [ ] **Step 1: Add fields to `CustomerData`**

In `apps/demo/src/liveavatar/types.ts`, inside `export interface CustomerData`, after the `recentOrders` field, add:

```typescript
  // Last purchase (from Liquid redirect, drives "recién compró" greeting)
  lastOrderProduct?: string;
  lastOrderDate?: string; // ISO 8601 from customer.last_order.created_at
```

- [ ] **Step 2: Add fields to `ShopifyCustomerRequest`**

In `apps/demo/src/shopify/types.ts`, inside `export interface ShopifyCustomerRequest`, after `orders_count?: string;`, add:

```typescript
  last_order_product?: string;
  last_order_date?: string;
```

- [ ] **Step 3: Add fields to `ShopifyCustomerResponse`**

In `apps/demo/src/shopify/types.ts`, inside `ShopifyCustomerResponse`, in the `customer` object after `recentOrders?: ShopifyOrder[];`, add:

```typescript
    lastOrderProduct?: string;
    lastOrderDate?: string;
```

- [ ] **Step 4: Verify types compile**

Run: `pnpm --filter demo exec tsc --noEmit`
Expected: no errors (only type additions, no usages yet).

- [ ] **Step 5: Commit**

```bash
git add apps/demo/src/liveavatar/types.ts apps/demo/src/shopify/types.ts
git commit -m "feat: add lastOrderProduct/lastOrderDate to customer types"
```

---

## Task 2: `formatRelativeDate` helper (TDD)

A pure function that turns an ISO date into Spanish relative text. Lives in the same file that will use it.

**Files:**
- Modify: `apps/demo/src/utils/heygen/elevenlabs-commands.ts` (add exported helper)
- Create: `apps/demo/src/__tests__/utils/elevenlabs-commands.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/demo/src/__tests__/utils/elevenlabs-commands.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { formatRelativeDate } from "@/src/utils/heygen/elevenlabs-commands";

describe("formatRelativeDate", () => {
  beforeEach(() => {
    // Freeze "now" to 2026-06-01T12:00:00Z for deterministic day math
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-01T12:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns 'hoy' for a date earlier today", () => {
    expect(formatRelativeDate("2026-06-01T03:00:00Z")).toBe("hoy");
  });

  it("returns 'ayer' for one day ago", () => {
    expect(formatRelativeDate("2026-05-31T12:00:00Z")).toBe("ayer");
  });

  it("returns 'hace N días' for several days ago", () => {
    expect(formatRelativeDate("2026-05-27T12:00:00Z")).toBe("hace 5 días");
  });

  it("returns '' for undefined", () => {
    expect(formatRelativeDate(undefined)).toBe("");
  });

  it("returns '' for an invalid date string", () => {
    expect(formatRelativeDate("not-a-date")).toBe("");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter demo exec vitest run src/__tests__/utils/elevenlabs-commands.test.ts`
Expected: FAIL — `formatRelativeDate is not a function` (not exported yet).

- [ ] **Step 3: Implement `formatRelativeDate`**

In `apps/demo/src/utils/heygen/elevenlabs-commands.ts`, add at the top (after the imports, before `sendCustomerContext`):

```typescript
/**
 * Convert an ISO date to Spanish relative text for the greeting.
 * "hoy" | "ayer" | "hace N días" | "" (if missing/invalid).
 */
export function formatRelativeDate(iso?: string): string {
  if (!iso) return "";
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return "";

  const now = new Date();
  // Compare calendar days in UTC to avoid TZ drift
  const msPerDay = 24 * 60 * 60 * 1000;
  const startOf = (d: Date) =>
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const diffDays = Math.round((startOf(now) - startOf(then)) / msPerDay);

  if (diffDays <= 0) return "hoy";
  if (diffDays === 1) return "ayer";
  return `hace ${diffDays} días`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter demo exec vitest run src/__tests__/utils/elevenlabs-commands.test.ts`
Expected: PASS (5/5).

- [ ] **Step 5: Commit**

```bash
git add apps/demo/src/utils/heygen/elevenlabs-commands.ts apps/demo/src/__tests__/utils/elevenlabs-commands.test.ts
git commit -m "feat: add formatRelativeDate helper with tests"
```

---

## Task 3: Include recent purchase in `sendCustomerContext` (TDD)

Extend the context builder to mention the last purchase. The function currently takes `(session, context)` and calls `session.sendContextualUpdate(text)`.

**Files:**
- Modify: `apps/demo/src/utils/heygen/elevenlabs-commands.ts` (`sendCustomerContext` signature + body)
- Modify: `apps/demo/src/__tests__/utils/elevenlabs-commands.test.ts` (add describe block)

- [ ] **Step 1: Write the failing test**

Append to `apps/demo/src/__tests__/utils/elevenlabs-commands.test.ts`:

```typescript
import { sendCustomerContext } from "@/src/utils/heygen/elevenlabs-commands";

// Minimal fake session capturing the contextual_update text
function makeFakeSession() {
  const calls: string[] = [];
  const session = {
    sendContextualUpdate: (text: string) => {
      calls.push(text);
    },
  };
  // Cast through unknown — we only exercise the one method used.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { session: session as any, calls };
}

describe("sendCustomerContext - recent purchase", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-01T12:00:00Z"));
  });
  afterEach(() => vi.useRealTimers());

  it("includes the last product with relative date", () => {
    const { session, calls } = makeFakeSession();
    sendCustomerContext(session, {
      firstName: "Ana",
      lastOrderProduct: "Sérum X",
      lastOrderDate: "2026-05-29T12:00:00Z",
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("Sérum X");
    expect(calls[0]).toContain("hace 3 días");
  });

  it("mentions the product without date when date is invalid", () => {
    const { session, calls } = makeFakeSession();
    sendCustomerContext(session, {
      firstName: "Ana",
      lastOrderProduct: "Crema Y",
      lastOrderDate: "bad-date",
    });
    expect(calls[0]).toContain("Crema Y");
    expect(calls[0]).not.toContain("hace");
  });

  it("omits purchase line when no lastOrderProduct", () => {
    const { session, calls } = makeFakeSession();
    sendCustomerContext(session, { firstName: "Ana" });
    expect(calls[0]).not.toContain("compra más reciente");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter demo exec vitest run src/__tests__/utils/elevenlabs-commands.test.ts`
Expected: FAIL — the new `describe` block fails because `sendCustomerContext` doesn't accept/emit `lastOrderProduct` yet.

- [ ] **Step 3: Extend `sendCustomerContext`**

In `apps/demo/src/utils/heygen/elevenlabs-commands.ts`, update the `context` parameter type to include the two new optional fields, and add the purchase block. The function signature becomes:

```typescript
export function sendCustomerContext(
  session: ElevenLabsAgentSession,
  context: {
    firstName?: string;
    lastName?: string;
    email?: string;
    skinType?: string;
    skinConcerns?: string[];
    ordersCount?: number;
    lastOrderProduct?: string;
    lastOrderDate?: string;
  },
): void {
```

Inside the body, AFTER the existing `ordersCount` block and BEFORE the `if (parts.length === 0)` check, add:

```typescript
  if (context.lastOrderProduct) {
    const whenStr = formatRelativeDate(context.lastOrderDate);
    parts.push(
      `Su compra más reciente fue: ${context.lastOrderProduct}${whenStr ? ` (${whenStr})` : ""}.`,
    );
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter demo exec vitest run src/__tests__/utils/elevenlabs-commands.test.ts`
Expected: PASS (all describe blocks, 8 tests total).

- [ ] **Step 5: Commit**

```bash
git add apps/demo/src/utils/heygen/elevenlabs-commands.ts apps/demo/src/__tests__/utils/elevenlabs-commands.test.ts
git commit -m "feat: include recent purchase in contextual_update"
```

---

## Task 4: Extend `/api/shopify-customer` to pass through last-order fields

**Files:**
- Modify: `apps/demo/app/api/shopify-customer/route.ts`

- [ ] **Step 1: Destructure new fields from the body**

In the body-parse block (currently destructuring `customer_id, shopify_token, first_name, last_name, email, orders_count`), add the two new fields:

```typescript
    const {
      customer_id,
      shopify_token,
      first_name,
      last_name,
      email,
      orders_count,
      last_order_product,
      last_order_date,
    } = body;
```

- [ ] **Step 2: Include fields in the CACHE HIT response**

In the cache-hit block (the `if (cached)` branch that returns early), add the two fields to the returned `customer` object so the greeting works even on a cache hit (they come from the request, not the cache):

```typescript
          customer: {
            id: cached.shopifyId || customer_id,
            email: cached.shopifyEmail,
            firstName: cached.firstName,
            lastName: cached.lastName,
            ordersCount: cached.ordersCount || 0,
            skinType: cached.skinType,
            skinConcerns: cached.skinConcerns,
            lastOrderProduct: last_order_product,
            lastOrderDate: last_order_date,
          },
```

- [ ] **Step 3: Include fields in the validated (non-cache) response**

In the `const response: ShopifyCustomerResponse = { ... }` object (after HMAC validation), add the two fields to `customer`:

```typescript
      customer: {
        id: cleanId,
        email: email || null,
        firstName: first_name || null,
        lastName: last_name || null,
        ordersCount: ordersCountNum,
        lastOrderProduct: last_order_product,
        lastOrderDate: last_order_date,
      },
```

- [ ] **Step 4: Verify types compile**

Run: `pnpm --filter demo exec tsc --noEmit`
Expected: no errors (fields exist on `ShopifyCustomerRequest`/`Response` from Task 1).

- [ ] **Step 5: Commit**

```bash
git add apps/demo/app/api/shopify-customer/route.ts
git commit -m "feat: pass last-order fields through shopify-customer endpoint"
```

---

## Task 5: Wire `page.tsx` to read + forward last-order params

**Files:**
- Modify: `apps/demo/app/page.tsx` (`verifyShopifyCustomer`)

- [ ] **Step 1: Forward params in the POST body**

In `verifyShopifyCustomer`, in the `fetch("/api/shopify-customer", ...)` body, add the two params:

```typescript
        body: JSON.stringify({
          customer_id: params.get("customer_id"),
          shopify_token: params.get("shopify_token"),
          first_name: params.get("first_name"),
          last_name: params.get("last_name"),
          email: params.get("email"),
          orders_count: params.get("orders_count"),
          last_order_product: params.get("last_order_product"),
          last_order_date: params.get("last_order_date"),
        }),
```

- [ ] **Step 2: Include fields when building the verified customer**

In the same function, in the `if (data.customer)` success branch where `setCustomerData({...})` is called with the full customer object, add the two fields:

```typescript
        const customer = {
          firstName: data.customer.firstName || undefined,
          lastName: data.customer.lastName || undefined,
          email: data.customer.email || undefined,
          ordersCount: data.customer.ordersCount,
          skinType: data.customer.skinType as CustomerData["skinType"],
          skinConcerns: data.customer.skinConcerns,
          lastOrderProduct: data.customer.lastOrderProduct,
          lastOrderDate: data.customer.lastOrderDate,
        };
```

> Note: `data.customer.lastOrderProduct/Date` exist on `ShopifyCustomerResponse` from Task 1. If TS complains the response type for this fetch is `ShopifyCustomerResponse`, it already includes them.

- [ ] **Step 3: Verify types compile**

Run: `pnpm --filter demo exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/demo/app/page.tsx
git commit -m "feat: read and forward last-order params in page.tsx"
```

---

## Task 6: `[START]` trigger + pass last-order fields in ClaraVoiceAgent

**Files:**
- Modify: `apps/demo/src/components/ClaraVoiceAgent.tsx` (Step 2 greeting handshake)

> Context: the greeting handshake (Step 2) already exists. It calls `sendCustomerContext(session, {...})` then `session.sendUserMessage("Hola")` (or `"[START]"` if PR #17 already switched it). This task ensures the trigger is `"[START]"` and the last-order fields are passed.

- [ ] **Step 1: Pass last-order fields to `sendCustomerContext`**

In `ClaraVoiceAgent.tsx`, find the Step 2 `useEffect` that calls `sendCustomerContext(session, {...})`. Add the two fields to the object:

```typescript
    sendCustomerContext(session, {
      firstName: customerData?.firstName,
      lastName: customerData?.lastName,
      email: customerData?.email,
      skinType: customerData?.skinType,
      skinConcerns: customerData?.skinConcerns,
      ordersCount: customerData?.ordersCount,
      lastOrderProduct: customerData?.lastOrderProduct,
      lastOrderDate: customerData?.lastOrderDate,
    });
```

- [ ] **Step 2: Ensure the trigger is `[START]`**

In the same `useEffect`, find the trigger call. If it reads `session.sendUserMessage("Hola")`, change it to:

```typescript
        session.sendUserMessage("[START]");
```

If it already reads `"[START]"`, leave it unchanged.

- [ ] **Step 3: Verify build**

Run: `pnpm build`
Expected: `Tasks: 2 successful, 2 total`.

- [ ] **Step 4: Commit**

```bash
git add apps/demo/src/components/ClaraVoiceAgent.tsx
git commit -m "feat: pass last-order context + use [START] greeting trigger"
```

---

## Task 7: Update Liquid template (manual paste) + agent prompt — documentation

These two changes are applied OUTSIDE the codebase (Shopify dashboard + ElevenLabs dashboard). This task produces a single doc file with the exact snippets so the user can copy-paste.

**Files:**
- Create: `apps/demo/shopify-templates/REDIRECT_MIGRATION.md`

- [ ] **Step 1: Write the migration doc**

Create `apps/demo/shopify-templates/REDIRECT_MIGRATION.md`:

```markdown
# Migración iframe → redirect + última compra

Aplicar estos dos cambios manualmente (no son código del repo).

## 1. Shopify theme — `page.clara.liquid`

### 1a. Agregar params de última compra
Dentro del bloque `if customer and hmac_secret != blank`, después de los
`if orders_count` existentes, agregar:

\`\`\`liquid
{%- if customer.last_order != blank -%}
  {%- assign last_order = customer.last_order -%}
  {%- assign last_item = last_order.line_items.first -%}
  {%- if last_item != blank -%}
    {%- assign widget_url = widget_url | append: '&last_order_product=' | append: last_item.title | url_encode -%}
  {%- endif -%}
  {%- assign widget_url = widget_url | append: '&last_order_date=' | append: last_order.created_at | url_encode -%}
{%- endif -%}
\`\`\`

### 1b. Reemplazar el iframe por un redirect
Reemplazar el bloque `<iframe ...></iframe>` por:

\`\`\`liquid
<script>
  window.location.replace({{ widget_url | json }});
</script>
<noscript>
  <a href="{{ widget_url }}">Continuar a Clara</a>
</noscript>
\`\`\`

El `<div class="clara-loading">` se mantiene como pantalla intermedia.

## 2. ElevenLabs — system prompt del agente `clara-ai`

Agregar al prompt:

> Cuando recibas el mensaje "[START]", es la señal de que un cliente acaba de
> iniciar la sesión. Saludalo cálidamente por su nombre usando el contexto que
> recibiste. Si el contexto indica una compra reciente, mencionala con
> naturalidad y ofrecele guiarlo en su rutina (ej: "Hola Ana, vi que compraste
> el Sérum X, ¿querés que te guíe en tu rutina?"). Nunca muestres el texto
> "[START]" en tu respuesta. Si no hay compra reciente, da una bienvenida general.
```

- [ ] **Step 2: Commit**

```bash
git add apps/demo/shopify-templates/REDIRECT_MIGRATION.md
git commit -m "docs: liquid redirect migration + agent prompt instructions"
```

---

## Task 8: Final verification

- [ ] **Step 1: Run all demo tests**

Run: `pnpm --filter demo exec vitest run`
Expected: all tests pass (existing + the new elevenlabs-commands suite).

- [ ] **Step 2: Full build**

Run: `pnpm build`
Expected: `Tasks: 2 successful, 2 total`.

- [ ] **Step 3: Lint**

Run: `pnpm --filter demo lint`
Expected: no errors.

- [ ] **Step 4: Manual e2e checklist (preview deploy)**

After pushing the branch and Vercel builds a preview:
1. Apply the Liquid changes (Task 7) in a test theme + the agent prompt.
2. Log into the Shopify store as a customer with ≥1 order → click "Hablá con Clara".
3. Confirm full-page redirect (no iframe) to the preview URL with `last_order_product` in the URL.
4. In browser console, confirm `[EL-CMD] Sending contextual_update` text includes the product, and `[START]` trigger fires.
5. Confirm Clara greets by name + mentions the product, without saying "[START]".
6. Test a customer with 0 orders → generic greeting, no purchase mention.
