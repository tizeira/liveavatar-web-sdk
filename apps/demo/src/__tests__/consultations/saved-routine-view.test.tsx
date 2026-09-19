import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it, expect, vi } from "vitest";
import { SessionRecap } from "@/src/components/ClaraVoiceAgent";

describe("saved routine presentation", () => {
  it("shows a persisted routine independently from the current consultation", () => {
    const html = renderToStaticMarkup(
      <SessionRecap
        view="routine"
        durationSeconds={0}
        savedRoutine={{
          concerns: ["Hidratación"],
          cautions: [],
          steps: [
            {
              order: 1,
              moment: "morning_evening",
              instruction: "Aplicar sobre piel limpia",
              product: null,
            },
          ],
        }}
        savedConsultationDate="2026-09-19T12:00:00Z"
        onTalkAgain={vi.fn()}
        onViewChange={vi.fn()}
      />,
    );
    expect(html).toContain("Mi rutina guardada");
    expect(html).toContain("Mañana y noche");
    expect(html).toContain("Aplicar sobre piel limpia");
    expect(html).toContain("19 de septiembre de 2026");
    expect(html).not.toContain("Rutina pendiente");
  });
  it("offers saved routine access even when the new consultation has no routine", () => {
    const html = renderToStaticMarkup(
      <SessionRecap
        view="summary"
        durationSeconds={60}
        result={{
          consultationId: "test",
          status: "completed",
          summary: "Conversación breve",
          routine: null,
          transcript: [],
        }}
        onTalkAgain={vi.fn()}
        onViewChange={vi.fn()}
        onViewSavedRoutine={vi.fn()}
      />,
    );
    expect(html).toContain("Mi rutina guardada");
    expect(html).toContain("Esta consulta no tiene una nueva rutina guardada");
    expect(html).not.toContain("Rutina pendiente");
  });
});
