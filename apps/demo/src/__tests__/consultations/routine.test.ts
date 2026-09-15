import { describe, expect, it } from "vitest";
import { consolidateRoutineSteps } from "@/src/consultations/routine";
import type { ClaraRoutineStep } from "@/src/consultations/types";

const base = {
  order: 1,
  instruction: "Aplicar sobre la piel limpia",
  frequency: "Todos los días",
  product: null,
} satisfies Omit<ClaraRoutineStep, "moment">;

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
