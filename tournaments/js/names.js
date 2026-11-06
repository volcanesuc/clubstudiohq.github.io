// /tournaments/js/names.js
// Comparar nombres de personas (sin tildes, sin mayúsculas, en cualquier orden).
// Se usa para sugerir qué jugador de un torneo anterior (ej. importado) es qué cuenta.

export const normName = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
export const nameTokens = (s) => normName(s).split(/[^a-z0-9]+/).filter((w) => w.length > 1);

/**
 * ¿Es probablemente la misma persona? Criterio conservador:
 * al menos 2 palabras en común y todas las del nombre más corto (o 3 en común).
 * "Diego Rivera" = "Diego Alonso Rivera" · "Diego Rivera Mora" ≠ "Diego Rivera Solano".
 */
export function sameName(a, b) {
  const A = [...new Set(nameTokens(a))];
  const B = new Set(nameTokens(b));
  if (!A.length || !B.size) return false;
  const common = A.filter((w) => B.has(w)).length;
  if (A.length === 1 && B.size === 1) return common === 1;
  return common >= 2 && (common >= Math.min(A.length, B.size) || common >= 3);
}
