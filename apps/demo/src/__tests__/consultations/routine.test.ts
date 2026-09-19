import { describe, expect, it } from "vitest";
import {
  consolidateRoutineSteps,
  routineGoalsText,
} from "@/src/consultations/routine";
import type { ClaraRoutineStep } from "@/src/consultations/types";

const base = {
  order: 1,
  instruction: "Aplicar sobre la piel limpia",
  frequency: "Todos los días",
  product: null,
} satisfies Omit<ClaraRoutineStep, "moment">;

describe("routineGoalsText", () => {
  it("does not deny an existing routine when objectives are absent", () => {
    const routine = {
      concerns: [],
      steps: [
        { ...base, moment: "morning" as const },
        { ...base, moment: "evening" as const, order: 2 },
      ],
    };
    const before = structuredClone(routine);
    expect(routineGoalsText(routine)).toBe(
      "No se registraron objetivos específicos.",
    );
    expect(routine).toEqual(before);
  });
  it("shows the recorded objectives without inventing new ones", () => {
    expect(
      routineGoalsText({
        concerns: ["Hidratación", "Textura"],
        steps: [{ ...base, moment: "morning" }],
      }),
    ).toBe("Hidratación · Textura");
  });
  it("reports missing routine only when there are no steps", () => {
    for (const routine of [
      null,
      undefined,
      { concerns: ["Hidratación"], steps: [] },
    ]) {
      expect(routineGoalsText(routine)).toBe(
        "No se guardó una rutina en esta consulta.",
      );
    }
  });
});

describe("consolidateRoutineSteps", () => {
  it("combines identical morning and evening steps", () => {
    const result = consolidateRoutineSteps([
      { ...base, moment: "morning" },
      { ...base, moment: "evening", order: 2 },
    ]);

    expect(result).toEqual([{ ...base, moment: "morning_evening", order: 1 }]);
  });

  it("keeps genuinely different instructions separate", () => {
    const result = consolidateRoutineSteps([
      { ...base, moment: "morning" },
      {
        ...base,
        moment: "evening",
        order: 2,
        instruction: "Aplicar dos gotas por la noche",
      },
    ]);

    expect(result).toHaveLength(2);
    expect(result.map((step) => step.order)).toEqual([1, 2]);
  });
});
