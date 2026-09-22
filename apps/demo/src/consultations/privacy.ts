const PERSON_NAME_AFTER_ROLE =
  /\b(?:El\s+|La\s+|el\s+|la\s+)?(?:Cliente|cliente|Usuario|usuario|Usuaria|usuaria)\s+[A-ZÁÉÍÓÚÜÑ][\p{L}'’-]*(?:\s+[A-ZÁÉÍÓÚÜÑ][\p{L}'’-]*)?/gu;
const LEADING_NAME_BEFORE_INTENT =
  /^(?:[A-ZÁÉÍÓÚÜÑ][\p{L}'’-]*(?:\s+[A-ZÁÉÍÓÚÜÑ][\p{L}'’-]*)?)\s+(?=(?:tiene|busca|consultó|consulta|quiere|necesita|expresó|comentó|indicó|desea|presenta)\b)/u;

export function sanitizeUserFacingSummary(value: unknown): string {
  if (typeof value !== "string") return "";

  const normalized = value
    .replace(/\s+/g, " ")
    .trim()
    .replace(PERSON_NAME_AFTER_ROLE, "La persona")
    .replace(LEADING_NAME_BEFORE_INTENT, "La persona ")
    .slice(0, 1200);

  // A generated narrative is not evidence of a database write. Storage status
  // is rendered separately from the persisted structured routine. Apply this
  // on reads as well, so old summaries cannot propagate false confirmations.
  return (normalized.match(/[^.!?]+[.!?]*/g) || [])
    .filter((sentence) => {
      const mentionsRoutine = /\b(?:rutina|plan|recomendaciones?)\b/i.test(
        sentence,
      );
      const mentionsPersistence =
        /\b(?:(?:guard|registr|almacen|actualiz)(?:ad[ao]s?|amos|aron|[óé])|saved|stored|updated)(?=\s|[.!?,;:]|$)/i.test(
          sentence,
        );
      const standaloneConfirmation =
        /\b(?:ya|he|hemos|qued[oó]|est[aá])\s+(?:la\s+|lo\s+)?(?:guardad[ao]|registrad[ao]|actualizad[ao])/i.test(
          sentence,
        );
      return (
        !(mentionsRoutine && mentionsPersistence) && !standaloneConfirmation
      );
    })
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}
