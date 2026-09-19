import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  ARGENTINA_TIME_ZONE,
  formatConsultationTime,
  formatRelativeDate,
} from "@/src/utils/heygen/elevenlabs-commands";

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

  it("returns '' for a future date", () => {
    expect(formatRelativeDate("2026-06-05T12:00:00Z")).toBe("");
  });

  it("uses Argentina calendar boundaries instead of UTC boundaries", () => {
    const argentinaLateNight = new Date("2026-06-02T02:00:00Z");
    expect(formatRelativeDate("2026-06-01T02:00:00Z", argentinaLateNight)).toBe(
      "ayer",
    );
  });

  it("provides exact ISO time and the Argentina local weekday/date", () => {
    const now = new Date("2026-06-01T12:00:00Z");
    const context = formatConsultationTime(now);
    expect(context).toContain("2026-06-01T12:00:00.000Z");
    expect(context).toContain(ARGENTINA_TIME_ZONE);
    expect(context).toContain("lunes");
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
    sendCustomerContext(session, {
      firstName: "Ana",
      clock: () => new Date("2026-06-01T12:00:00Z"),
    });
    expect(calls[0]).not.toContain("compra más reciente");
    expect(calls[0]).toContain("guardar_rutina_clara_memoria_qa");
    expect(calls[0]).toContain("saved:true");
  });

  it("personalizes with first name only", () => {
    const { session, calls } = makeFakeSession();
    sendCustomerContext(session, { firstName: "Ana" });
    expect(calls[0]).toContain("La cliente se llama Ana.");
    expect(calls[0]).not.toContain("apellido");
    expect(calls[0]).not.toContain("@");
  });

  it("adds recent sanitized consultation memory and follow-up guidance", () => {
    const { session, calls } = makeFakeSession();
    sendCustomerContext(session, {
      firstName: "Ana",
      conversationMemory: [
        {
          completedAt: "2026-05-31T12:00:00Z",
          summary: "La persona consultó por hidratación.",
          concerns: ["piel seca"],
          products: ["Beta Hidra"],
        },
      ],
    });

    expect(calls[0]).toContain("Antecedentes de conversaciones previas");
    expect(calls[0]).toContain("Fecha de consulta: 2026-05-31T12:00:00.000Z");
    expect(calls[0]).toContain("domingo");
    expect(calls[0]).toContain("ayer");
    expect(calls[0]).toContain("Beta Hidra");
    expect(calls[0]).toContain("preguntá cómo le resultó");
    expect(calls[0]).toContain("saved:true");
    expect(calls[0]).not.toContain("Tizeira");
  });

  it("injects a deterministic consultation clock and handles future order dates cautiously", () => {
    const { session, calls } = makeFakeSession();
    sendCustomerContext(session, {
      lastOrderProduct: "Crema Y",
      lastOrderDate: "2026-06-03T12:00:00Z",
      clock: () => new Date("2026-06-01T12:00:00Z"),
    });

    expect(calls[0]).toContain("2026-06-01T12:00:00.000Z");
    expect(calls[0]).toContain("America/Argentina/Buenos_Aires");
    expect(calls[0]).toContain("parece posterior a esta consulta");
    expect(calls[0]).not.toContain("hace 2 días");
  });

  it("does not turn a future memory date into past history", () => {
    const { session, calls } = makeFakeSession();
    sendCustomerContext(session, {
      clock: () => new Date("2026-06-01T12:00:00Z"),
      conversationMemory: [
        {
          completedAt: "2026-06-03T12:00:00Z",
          summary: "No debe aparecer como antecedente.",
          concerns: [],
          products: [],
        },
      ],
    });

    expect(calls[0]).not.toContain("No debe aparecer como antecedente");
  });

  it("keeps the save guard even with no customer data", () => {
    const { session, calls } = makeFakeSession();
    sendCustomerContext(session, {
      clock: () => new Date("2026-06-01T12:00:00Z"),
    });

    expect(calls[0]).toContain("guardar_rutina_clara_memoria_qa");
    expect(calls[0]).toContain("confirmación explícita");
    expect(calls[0]).toContain("saved:true");
    expect(calls[0]).not.toContain("Antecedentes de conversaciones previas");
  });
});
