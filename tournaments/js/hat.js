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

/* =========================
   Armado de equipos
========================= */
// PRNG con semilla (mulberry32): mismo seed → mismos equipos; "Regenerar" usa otro seed
export function seededRandom(seed = 1) {
  let a = (Number(seed) >>> 0) || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const handlerValue = (p) => (p.position === "handler" ? 1 : p.position === "both" ? 0.5 : 0);
const scoreOf = (p) => Number(p.score ?? p.raw) || 0;

/**
 * Números de un equipo para comparar: jugadores, F/M, puntaje total y promedio, edad promedio y handlers.
 * @param {object[]} players [{ gender, score|raw, age, position }]
 */
export function teamStats(players = []) {
  const ages = players.map((p) => p.age).filter((a) => Number.isFinite(a));
  const total = players.reduce((n, p) => n + scoreOf(p), 0);
  return {
    n: players.length,
    f: players.filter((p) => p.gender === "F").length,
    m: players.filter((p) => p.gender === "M").length,
    total: Math.round(total * 10) / 10,
    avg: players.length ? Math.round((total / players.length) * 10) / 10 : 0,
    avgAge: ages.length ? Math.round((ages.reduce((a, b) => a + b, 0) / ages.length) * 10) / 10 : null,
    handlers: players.reduce((n, p) => n + handlerValue(p), 0),
  };
}

// Diferencia de promedio entre el equipo más fuerte y el más débil (el indicador de balance)
export function balanceGap(teams = []) {
  const avgs = teams.map((t) => teamStats(t.players || t).avg);
  return avgs.length ? Math.round((Math.max(...avgs) - Math.min(...avgs)) * 10) / 10 : 0;
}

const range = (xs) => (xs.length ? Math.max(...xs) - Math.min(...xs) : 0);
const stdev = (xs) => {
  if (!xs.length) return 0;
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length);
};

// Costo de un reparto (más bajo = más parejo), en orden de prioridad:
// F/M por equipo (solo si se balancea género) y tamaño ≫ puntaje promedio ≫ handlers ≫ edad promedio
function cost(teams, balanceGender) {
  const st = teams.map((t) => teamStats(t.flatMap((u) => u.members)));
  let c = 1000 * Math.max(0, range(st.map((s) => s.n)) - 1);
  if (balanceGender) c += 1000 * (Math.max(0, range(st.map((s) => s.f)) - 1) + Math.max(0, range(st.map((s) => s.m)) - 1));
  c += 10 * range(st.map((s) => s.avg)) + 10 * stdev(st.map((s) => s.avg));
  c += 2 * range(st.map((s) => s.handlers));
  const ages = st.map((s) => s.avgAge).filter((a) => a !== null);
  c += 0.5 * range(ages);
  return c;
}

/**
 * Arma `count` equipos con los jugadores de UNA división.
 * 1) Las parejas mutuas son una sola unidad (van juntas).
 * 2) Reparto inicial tipo draft: por puntaje (de mayor a menor) dentro de cada género, cada unidad va al equipo
 *    con menos jugadores de ese género y, si empatan, al de menor puntaje.
 * 3) Mejora: intercambia unidades de la misma composición (F/M) entre equipos mientras baje el costo.
 * Determinista con `seed` (desempata con números al azar con semilla).
 * @param {object[]} players [{ uid, gender, score|raw, age, position, teammateUid }]
 * @param {number} count cantidad de equipos
 * @param {{ mixed?: boolean, seed?: number, maxPasses?: number }} opts mixed: balancear F/M (solo si hay de los dos)
 * @returns {object[][]} equipos (arreglos de jugadores)
 */
export function generateTeams(players = [], count = 2, { mixed = false, seed = 1, maxPasses = 200 } = {}) {
  const n = Math.max(1, Math.min(Math.round(count) || 1, players.length || 1));
  const rand = seededRandom(seed);
  const balanceGender = mixed && players.some((p) => p.gender === "F") && players.some((p) => p.gender === "M");

  // unidades: parejas mutuas juntas, el resto de a uno
  const pairs = mutualPairs(players);
  const byUid = new Map(players.map((p) => [p.uid, p]));
  const used = new Set();
  const units = [];
  players.forEach((p) => {
    if (used.has(p.uid)) return;
    const mate = pairs.get(p.uid) && byUid.get(pairs.get(p.uid));
    const members = mate ? [p, mate] : [p];
    members.forEach((m) => used.add(m.uid));
    const f = members.filter((m) => m.gender === "F").length;
    units.push({ members, f, m: members.length - f, score: members.reduce((s, m) => s + scoreOf(m), 0), jitter: rand() });
  });

  // reparto inicial: parejas primero (son las más difíciles de acomodar), después F y M por separado
  const teams = Array.from({ length: n }, () => []);
  const size = (t) => t.reduce((s, u) => s + u.members.length, 0);
  const genderCount = (t, g) => t.reduce((s, u) => s + (g === "F" ? u.f : u.m), 0);
  const total = (t) => t.reduce((s, u) => s + u.score, 0);
  const byScore = (a, b) => b.score / b.members.length - a.score / a.members.length || a.jitter - b.jitter;
  const place = (u, key) => {
    const order = teams
      .map((t, i) => ({ t, i, r: rand() }))
      .sort((a, b) => key(a.t) - key(b.t) || total(a.t) - total(b.t) || a.r - b.r);
    order[0].t.push(u);
  };
  const groups = balanceGender
    ? [units.filter((u) => u.members.length > 1), units.filter((u) => u.members.length === 1 && u.f), units.filter((u) => u.members.length === 1 && !u.f)]
    : [units.filter((u) => u.members.length > 1), units.filter((u) => u.members.length === 1)];
  groups.forEach((g, gi) => {
    g.sort(byScore).forEach((u) => {
      if (!balanceGender || gi === 0) return place(u, size);
      const gender = u.f ? "F" : "M";
      place(u, (t) => genderCount(t, gender) * 1000 + size(t));
    });
  });

  // mejora por intercambios de unidades con la misma composición (no cambia F/M ni tamaño)
  let best = cost(teams, balanceGender);
  for (let pass = 0; pass < maxPasses; pass++) {
    let improved = false;
    for (let a = 0; a < n; a++) {
      for (let b = a + 1; b < n; b++) {
        for (let i = 0; i < teams[a].length; i++) {
          for (let j = 0; j < teams[b].length; j++) {
            const ua = teams[a][i];
            const ub = teams[b][j];
            if (ua.f !== ub.f || ua.m !== ub.m || ua.score === ub.score) continue;
            teams[a][i] = ub;
            teams[b][j] = ua;
            const c = cost(teams, balanceGender);
            if (c < best - 1e-9) {
              best = c;
              improved = true;
            } else {
              teams[a][i] = ua;
              teams[b][j] = ub;
            }
          }
        }
      }
    }
    if (!improved) break;
  }

  // cada equipo ordenado por puntaje (de mayor a menor)
  return teams.map((t) => t.flatMap((u) => u.members).sort((x, y) => scoreOf(y) - scoreOf(x)));
}
