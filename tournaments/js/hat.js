// /tournaments/js/hat.js
// Torneos hat: elegibilidad por división, puntajes, parejas y el armado de equipos.
// Funciones puras (sin Firebase): se prueban con `node tools/test_hat.mjs`.
import { HAT_PLAYERS_PER_TEAM_FACTOR, HAT_QUESTIONS, HAT_WEIGHTS } from "./hat-config.js";

export const HAT_STATUS = { WAITING: "waiting", WAITLIST: "waitlist", ASSIGNED: "assigned" };
export const PLAYER_FEE_MODES = ["free", "optional", "required"];

export const isHatEvent = (event) => event?.type === "hat";

// id del doc del jugador en el pool: uno por división
export const hatPlayerId = (uid, divisionId) => `${uid}__${divisionId}`;

/* =========================
   Elegibilidad
========================= */
// Géneros permitidos en la división: lo que eligió el organizador o, si no, según la rama
export function hatGenders(division = {}) {
  const set = division.hat?.genders;
  if (Array.isArray(set) && set.length) return set.filter((g) => g === "F" || g === "M");
  if (division.gender === "femenino") return ["F"];
  if (division.gender === "masculino") return ["M"];
  return ["F", "M"];
}

// Edad cumplida en la fecha de referencia ("YYYY-MM-DD"); null si falta la fecha de nacimiento
export function ageOn(birth, ref) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(birth || "")) return null;
  const r = /^\d{4}-\d{2}-\d{2}$/.test(ref || "") ? ref : new Date().toISOString().slice(0, 10);
  const [by, bm, bd] = birth.split("-").map(Number);
  const [ry, rm, rd] = r.split("-").map(Number);
  let age = ry - by;
  if (rm < bm || (rm === bm && rd < bd)) age--;
  return age;
}

export const ageRefOf = (division, event) => division?.hat?.ageRef || event?.startDate || "";

/**
 * ¿Puede este jugador entrar a la división?
 * @returns {{ ok: boolean, code?: "gender"|"birth"|"min"|"max", min?: number, max?: number, age?: number|null }}
 */
export function eligibility(division, { gender, birthDate } = {}, event = {}) {
  const hat = division?.hat || {};
  if (!hatGenders(division).includes(gender)) return { ok: false, code: "gender" };
  const min = Number(hat.minAge) || 0;
  const max = Number(hat.maxAge) || 0;
  if (!min && !max) return { ok: true };
  const age = ageOn(birthDate, ageRefOf(division, event));
  if (age === null) return { ok: false, code: "birth", min, max };
  if (min && age < min) return { ok: false, code: "min", min, max, age };
  if (max && age > max) return { ok: false, code: "max", min, max, age };
  return { ok: true, age };
}

/* =========================
   Puntajes
========================= */
// Puntaje propio "crudo" (0–100) del cuestionario, ponderado con HAT_WEIGHTS
export function selfScore(answers = {}, weights = HAT_WEIGHTS, questions = HAT_QUESTIONS) {
  let sum = 0;
  let total = 0;
  questions.filter((q) => q.scored !== false && weights[q.id]).forEach((q) => {
    const opt = q.options.find((o) => o.id === answers[q.id]);
    total += weights[q.id];
    if (opt) sum += weights[q.id] * (Number(opt.value) || 0);
  });
  return total ? Math.round((sum / total) * 1000) / 10 : 0;
}

// El puntaje del organizador manda sobre el propio
export function rawScore(rating = {}) {
  const org = rating.organizerScore;
  if (org !== null && org !== undefined && org !== "" && Number.isFinite(Number(org))) return Number(org);
  return Number(rating.selfScore) || 0;
}

// Puntaje mostrado (0–100): el mejor del pool de la división siempre es 100.
// players: [{ raw }] → mismo arreglo con `score`
export function normalize(players = []) {
  const max = Math.max(0, ...players.map((p) => Number(p.raw) || 0));
  return players.map((p) => ({ ...p, score: max > 0 ? Math.round(((Number(p.raw) || 0) / max) * 100) : 0 }));
}

/* =========================
   Parejas
========================= */
// Parejas que cuentan: los dos se eligieron mutuamente y están en el mismo pool.
// players: [{ uid, teammateUid }] → Map uid → uid de su pareja
export function mutualPairs(players = []) {
  const byUid = new Map(players.map((p) => [p.uid, p]));
  const pairs = new Map();
  players.forEach((p) => {
    const other = p.teammateUid && byUid.get(p.teammateUid);
    if (other && other.teammateUid === p.uid && other.uid !== p.uid) pairs.set(p.uid, other.uid);
  });
  return pairs;
}

/* =========================
   Cantidad de equipos
========================= */
// Sugerencia por división: jugadores / (en cancha × factor). Devuelve también los datos para la línea explicativa.
export function suggestTeamCount(players, playersOnField = 7, factor = HAT_PLAYERS_PER_TEAM_FACTOR) {
  const per = Math.max(1, (Number(playersOnField) || 7) * factor);
  const n = Math.max(players >= 2 ? 2 : 0, Math.round(players / per));
  return { n, perTeam: n ? Math.round((players / n) * 10) / 10 : 0 };
}

/* =========================
   Camisetas
========================= */
// Totales por talla + corte: { "M · mujer": 4, ... } ordenados por talla
export function jerseyTotals(players = [], sizes = ["XS", "S", "M", "L", "XL", "XXL"]) {
  const out = new Map();
  players.forEach((p) => {
    const size = p.jersey?.size || "?";
    const cut = p.jersey?.cut || "?";
    const key = `${size}|${cut}`;
    out.set(key, (out.get(key) || 0) + 1);
  });
  const order = (s) => (sizes.includes(s) ? sizes.indexOf(s) : 99);
  return [...out.entries()]
    .map(([key, n]) => {
      const [size, cut] = key.split("|");
      return { size, cut, n };
    })
    .sort((a, b) => order(a.size) - order(b.size) || a.cut.localeCompare(b.cut));
}
