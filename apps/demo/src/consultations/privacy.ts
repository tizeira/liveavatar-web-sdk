const PERSON_NAME_AFTER_ROLE =
  /\b(?:El\s+|La\s+|el\s+|la\s+)?(?:Cliente|cliente|Usuario|usuario|Usuaria|usuaria)\s+[A-ZÁÉÍÓÚÜÑ][\p{L}'’-]*(?:\s+[A-ZÁÉÍÓÚÜÑ][\p{L}'’-]*)?/gu;
const LEADING_NAME_BEFORE_INTENT =
  /^(?:[A-ZÁÉÍÓÚÜÑ][\p{L}'’-]*(?:\s+[A-ZÁÉÍÓÚÜÑ][\p{L}'’-]*)?)\s+(?=(?:tiene|busca|consultó|consulta|quiere|necesita|expresó|comentó|indicó|desea|presenta)\b)/u;

export function sanitizeUserFacingSummary(value: unknown): string {
  if (typeof value !== "string") return "";

  return value
    .replace(/\s+/g, " ")
    .trim()
    .replace(PERSON_NAME_AFTER_ROLE, "La persona")
    .replace(LEADING_NAME_BEFORE_INTENT, "La persona ")
    .slice(0, 1200);
}
