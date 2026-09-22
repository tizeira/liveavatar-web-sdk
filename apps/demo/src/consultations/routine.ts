import type { ClaraRoutine, ClaraRoutineStep } from "./types";

export function routineGoalsText(
  routine: Pick<ClaraRoutine, "concerns" | "steps"> | null | undefined,
): string {
  if (!routine?.steps.length)
    return "No se guardó una rutina en esta consulta.";
  return routine.concerns.length
    ? routine.concerns.join(" · ")
    : "No se registraron objetivos específicos.";
}

function normalized(value?: string): string {
  return (value || "").trim().replace(/\s+/g, " ").toLocaleLowerCase("es");
}

function stepIdentity(step: ClaraRoutineStep): string {
  return [
    step.product?.handle || "no-product",
    normalized(step.instruction),
    normalized(step.frequency),
  ].join("|");
}

export function consolidateRoutineSteps(
  source: ClaraRoutineStep[],
): ClaraRoutineStep[] {
  const output: ClaraRoutineStep[] = [];
  const consumed = new Set<number>();

  for (let index = 0; index < source.length; index += 1) {
    if (consumed.has(index)) continue;
    const step = source[index];
    if (!step) continue;
    if (step.moment !== "morning" && step.moment !== "evening") {
      output.push(step);
      continue;
    }

    const counterpartMoment = step.moment === "morning" ? "evening" : "morning";
    const counterpartIndex = source.findIndex(
      (candidate, candidateIndex) =>
        candidateIndex > index &&
        !consumed.has(candidateIndex) &&
        candidate.moment === counterpartMoment &&
        stepIdentity(candidate) === stepIdentity(step),
    );

    if (counterpartIndex >= 0) {
      consumed.add(counterpartIndex);
      output.push({ ...step, moment: "morning_evening" });
    } else {
      output.push(step);
    }
  }

  return output.map((step, index) => ({ ...step, order: index + 1 }));
}
