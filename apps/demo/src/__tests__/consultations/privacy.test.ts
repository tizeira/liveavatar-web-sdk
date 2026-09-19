import { describe, expect, it } from "vitest";
import { sanitizeUserFacingSummary } from "@/src/consultations/privacy";

describe("sanitizeUserFacingSummary", () => {
  it("preserves product storage instructions", () => {
    const advice = "En tu rutina, guardá el sérum lejos de la luz.";
    expect(sanitizeUserFacingSummary(advice)).toBe(advice);
  });
  it("removes unsupported persistence claims while preserving consultation content", () => {
    expect(
      sanitizeUserFacingSummary(
        "Acordamos usar Beta Hidra. Tu rutina ha sido guardada con éxito.",
      ),
    ).toBe("Acordamos usar Beta Hidra.");
    expect(
      sanitizeUserFacingSummary(
        "La rutina quedó registrada. Buscás hidratación.",
      ),
    ).toBe("Buscás hidratación.");
    expect(
      sanitizeUserFacingSummary(
        "Ya la he guardado. Tu rutina fue actualizada hoy.",
      ),
    ).toBe("");
  });

  it("removes a customer name after a role label", () => {
    expect(
      sanitizeUserFacingSummary(
        "Cliente Iván Tizeira busca una rutina para manchas.",
      ),
    ).toBe("La persona busca una rutina para manchas.");
  });

  it("removes a leading first name before an intent", () => {
    expect(
      sanitizeUserFacingSummary("Iván tiene piel seca y busca hidratación."),
    ).toBe("La persona tiene piel seca y busca hidratación.");
  });

  it("preserves product names and normalizes whitespace", () => {
    expect(
      sanitizeUserFacingSummary(
        "  Se acordó usar   Beta Hacker iD Radiance por la noche. ",
      ),
    ).toBe("Se acordó usar Beta Hacker iD Radiance por la noche.");
  });
});
