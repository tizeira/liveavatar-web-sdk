import type { ClaraRoutine, ClaraRoutineStep } from "./types";
import type { ClaraCatalogProduct } from "../shopify/types";

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

function normalizedProductText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function mentionsProduct(
  instruction: string,
  product: ClaraCatalogProduct,
): boolean {
  const text = ` ${normalizedProductText(instruction)} `;
  const titleWords = normalizedProductText(product.title).split(" ");
  const handle = normalizedProductText(product.handle);
  const phrases = [titleWords.join(" "), handle];
  // Product titles often have a brand prefix; keep a distinctive two-word
  // suffix such as "ID Radiance" without matching generic single words.
  for (let start = 1; start <= titleWords.length - 2; start += 1) {
    phrases.push(titleWords.slice(start).join(" "));
  }
  return phrases.some(
    (phrase) => phrase.length >= 8 && text.includes(` ${phrase} `),
  );
}

export function findUnlinkedRoutineProducts(
  steps: Array<{ instruction: string; productHandle: string }>,
  products: ClaraCatalogProduct[],
): Array<{ step: number; products: Array<{ title: string; handle: string }> }> {
  return steps.flatMap((step, index) => {
    if (step.productHandle || !step.instruction) return [];
    const matches = products
      .filter((product) => mentionsProduct(step.instruction, product))
      .map(({ title, handle }) => ({ title, handle }));
    return matches.length ? [{ step: index + 1, products: matches }] : [];
  });
}
