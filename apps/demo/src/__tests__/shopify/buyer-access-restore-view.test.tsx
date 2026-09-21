/** @vitest-environment happy-dom */

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: null, status: "unauthenticated" }),
}));

vi.mock("@/src/components/ClaraVoiceAgent", () => ({
  default: ({ userName }: { userName: string | null }) => (
    <div data-testid="clara-ready">Clara lista para {userName}</div>
  ),
}));

vi.mock("@/src/components/CustomerVerification", () => ({
  default: () => <div data-testid="customer-verification" />,
}));

vi.mock("@/src/components/auth/LogoutButton", () => ({
  UserMenu: () => null,
}));

import Home from "@/app/page";

describe("Shopify buyer access restoration", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    window.history.replaceState({}, "", "/");
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("keeps the restored buyer verified when NextAuth is unauthenticated", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        valid: true,
        hasOrders: true,
        customer: {
          firstName: "Ivan",
          ordersCount: 1,
          lastOrderProduct: "Beta Hidra",
          lastOrderDate: "2026-09-20",
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => root.render(<Home />));

    await vi.waitFor(() => {
      expect(container.textContent).toContain("Clara lista para Ivan");
    });

    expect(container.textContent).not.toContain("Preparando tu acceso");
    expect(
      container.querySelector('[data-testid="customer-verification"]'),
    ).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/shopify-access",
      expect.objectContaining({ cache: "no-store" }),
    );
  });

  it("leaves the loading screen after a slow access check", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("Aborted", "AbortError"));
          });
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => root.render(<Home />));
    expect(container.textContent).toContain("Preparando tu acceso");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });

    expect(container.textContent).not.toContain("Preparando tu acceso");
    expect(container.textContent).toContain("No pudimos conectarnos");
    expect(container.textContent).toContain("Volver a intentar");
  });

  it("does not repeat a timed-out signed access exchange", async () => {
    vi.useFakeTimers();
    window.history.replaceState(
      {},
      "",
      "/?shopify_token=test-signature&customer_id=test-customer",
    );
    const fetchMock = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("Aborted", "AbortError"));
          });
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => root.render(<Home />));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(container.textContent).not.toContain("Preparando tu acceso");
    expect(container.textContent).toContain("No pudimos conectarnos");
  });

  it("does not repeat a rejected signed access exchange", async () => {
    window.history.replaceState(
      {},
      "",
      "/?shopify_token=invalid-signature&customer_id=test-customer",
    );
    const fetchMock = vi.fn(async () =>
      Response.json({ error: "Invalid token" }, { status: 401 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => root.render(<Home />));

    await vi.waitFor(() => {
      expect(container.textContent).toContain("No pudimos validar tu acceso");
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(container.textContent).not.toContain("Preparando tu acceso");
  });
});
