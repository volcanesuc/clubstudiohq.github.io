// /js/features/events/formats.js
// Formatos de competencia. Cada formato genera partidos (sin guardarlos) a partir de los equipos.
// Para agregar uno (fase 2: swiss, eliminación, grupos + llave, personalizados):
//   registerFormat({ id, label, available: true, generate(teams, options) -> [{ phase, round, teamA, teamB }] })
// El organizador elige el formato al generar el calendario; los horarios y canchas los asigna assignSlots().

import { doubleElim, groupsWithByes, nextSwissRound, poolsPlayoffs, singleElimination, splitTwoPools } from "/tournaments/js/brackets.js";

const FORMATS = new Map();

export function registerFormat(format) {
  FORMATS.set(format.id, format);
}

export function listFormats() {
  return [...FORMATS.values()];
}

export function getFormat(id) {
  return FORMATS.get(id) || FORMATS.get("round_robin");
}

/* =========================
   Round robin (todos contra todos, por grupo)
========================= */
// Método del círculo: n equipos -> n-1 rondas (n par) o n rondas con descanso (n impar).
export function roundRobinPairs(teams) {
  const list = [...teams];
  if (list.length < 2) return [];
  if (list.length % 2) list.push(null); // descanso
  const n = list.length;
  const rounds = [];
  let rot = list.slice(1);
  for (let r = 0; r < n - 1; r++) {
    const ring = [list[0], ...rot];
    const games = [];
    for (let i = 0; i < n / 2; i++) {
      const a = ring[i];
      const b = ring[n - 1 - i];
      if (a && b) games.push(r % 2 ? [b, a] : [a, b]); // alterna quién es "A"
    }
    rounds.push(games);
    rot = [rot[rot.length - 1], ...rot.slice(0, -1)];
  }
  return rounds;
}

registerFormat({
  id: "round_robin",
  label: "Round robin (todos contra todos)",
  available: true,
  // teams: [{ id, name, pool }]; un round robin por grupo
  generate(teams) {
    const pools = new Map();
    teams.forEach((t) => {
      const pool = String(t.pool || "").trim().toUpperCase() || "A";
      if (!pools.has(pool)) pools.set(pool, []);
      pools.get(pool).push(t);
    });
    const singlePool = pools.size === 1;
    const games = [];
    pools.forEach((poolTeams, pool) => {
      roundRobinPairs(poolTeams).forEach((round, ri) => {
        round.forEach(([a, b]) => games.push({ pool: singlePool ? "" : pool, round: ri + 1, teamA: a, teamB: b }));
      });
    });
    return games;
  },
});

// Llaves (ver brackets.js): los partidos que dependen de otros llevan slotA/slotB y se llenan solos.
// Orden de siembra: el orden de los equipos (el organizador lo define en Equipos › "Siembra").
const bySeed = (teams) => teams.slice().sort((a, b) => (Number(a.seed) || 999) - (Number(b.seed) || 999) || String(a.name).localeCompare(String(b.name)));
const toGame = (g) => ({ key: g.key, phase: g.label, round: g.round, slotA: g.slotA, slotB: g.slotB, teamA: g.slotA?.team || null, teamB: g.slotB?.team || null });

registerFormat({
  id: "single_elim",
  label: "Eliminación simple",
  available: true,
  options: ["thirdPlace"],
  generate: (teams, { thirdPlace = false } = {}) => singleElimination(bySeed(teams), { thirdPlace }).map(toGame),
});

registerFormat({
  id: "double_elim",
  label: "Eliminación doble",
  available: true,
  generate: (teams) => doubleElim(bySeed(teams)).map(toGame),
});

registerFormat({
  id: "pools_playoffs",
  label: "Fase de grupos + playoffs",
  available: true,
  options: ["advance", "thirdPlace"],
  generate(teams, { advance = 2, thirdPlace = false, divisionId = "" } = {}) {
    const rr = FORMATS.get("round_robin").generate(teams);
    // con un solo grupo los partidos no llevan "pool": la llave lo busca igual
    const { bracket } = poolsPlayoffs(teams, rr, { advance, thirdPlace, divisionId });
    return [...rr, ...bracket.map(toGame)];
  },
});

// 2 grupos + llave: el 1º de cada grupo directo a semis, 2º y 3º cruzan en cuartos (ideal para 6 equipos)
const poolOf = (t) => String(t.pool || "").trim().toUpperCase();
registerFormat({
  id: "groups_byes",
  label: "2 grupos + llave (1º de cada grupo directo a semis)",
  available: true,
  minTeams: 6,
  maxTeams: 8,
  // si los equipos no tienen exactamente 2 grupos, se reparten por siembra (el organizador guarda el grupo)
  pools(teams) {
    const pools = new Set(teams.map(poolOf).filter(Boolean));
    if (pools.size === 2 && teams.every((t) => poolOf(t))) return null;
    return splitTwoPools(bySeed(teams));
  },
  generate(teams, { divisionId = "" } = {}) {
    const rr = FORMATS.get("round_robin").generate(teams);
    return [...rr, ...groupsWithByes(teams, rr, { divisionId }).map(toGame)];
  },
});

registerFormat({
  id: "swiss",
  label: "Sistema suizo",
  available: true,
  incremental: true, // se genera ronda por ronda
  generate(teams, { played = [] } = {}) {
    return nextSwissRound(bySeed(teams), played).games;
  },
});

/* =========================
   Horarios y canchas
========================= */
/**
 * Reparte partidos en franjas: cada franja usa todas las canchas, y un equipo no juega dos veces en la misma franja.
 * Mantiene el orden por ronda (los de la ronda 1 primero).
 * @returns los mismos partidos con { field, startAt: Date }
 */
export function assignSlots(games, { fields = [], start, gameMinutes = 90 } = {}) {
  const courts = fields.length ? fields : [""];
  const pending = games.slice().sort((a, b) => (a.round || 0) - (b.round || 0));
  const out = [];
  // llaves: un partido va después de los partidos de los que salen sus equipos (y de su grupo)
  const slotOfKey = new Map();
  const poolSlots = new Map(); // grupo -> última franja con partidos de ese grupo
  const poolOf = (g) => String(g.pool || "").toUpperCase();
  const deps = (g) => [g.slotA, g.slotB].filter(Boolean);
  const ready = (g, slot) => deps(g).every((s) => {
    if (s.from) return slotOfKey.has(s.from) && slotOfKey.get(s.from) < slot;
    if (s.pool) {
      const left = pending.some((x) => !x.key && (poolOf(x) === s.pool || !x.pool));
      return !left && (poolSlots.get(s.pool) ?? poolSlots.get("") ?? -1) < slot;
    }
    return true;
  });
  let slot = 0;
  while (pending.length) {
    const busy = new Set();
    let used = 0;
    for (let i = 0; i < pending.length && used < courts.length; ) {
      const g = pending[i];
      const ids = [g.teamA?.id, g.teamB?.id].filter(Boolean);
      if (ids.some((id) => busy.has(id)) || !ready(g, slot)) {
        i++;
        continue;
      }
      ids.forEach((id) => busy.add(id));
      if (g.key) slotOfKey.set(g.key, slot);
      else poolSlots.set(poolOf(g), slot);
      out.push({
        ...g,
        field: courts[used],
        startAt: start ? new Date(start.getTime() + slot * gameMinutes * 60000) : null,
      });
      used++;
      pending.splice(i, 1);
    }
    slot++;
    if (slot > 500) break; // seguridad
  }
  return out;
}
