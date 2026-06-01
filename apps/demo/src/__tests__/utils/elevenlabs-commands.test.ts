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
