// /tournaments/js/brackets.js
// Llaves y sistemas de competencia (sin Firebase): eliminación simple y doble, grupos + playoffs y suizo.
//
// Los partidos de una llave se crean desde el principio. Los que dependen de otros guardan de dónde sale
// cada equipo en slotA / slotB:
//   { from: "<key>", take: "W" | "L" }      ganador / perdedor de otro partido de la llave
//   { pool: "A", rank: 1, divisionId }      1º del grupo A (cuando terminan todos los partidos del grupo)
// resolveGames() llena teamA / teamB con el equipo real en cuanto se sabe; mientras, muestra un texto
// ("Ganador de Semifinal 1"). Los byes (cuando no hay potencia de 2) se resuelven al generar: no se juegan.
import { GAME_STATUS, standings } from "/tournaments/js/model.js";

const LABELS = {
  final: "Final",
  semi: "Semifinal",
  quarter: "Cuartos de final",
  eighth: "Octavos de final",
  round: (n) => `Ronda ${n}`,
  third: "Tercer lugar",
  winners: "Ganadores",
  losers: "Perdedores",
  grandFinal: "Gran final",
  winnerOf: (label) => `Ganador de ${label}`,
  loserOf: (label) => `Perdedor de ${label}`,
  poolRank: (rank, pool) => `${rank}º del Grupo ${pool}`,
  bye: "Descansa",
};

const pow2 = (n) => 2 ** Math.ceil(Math.log2(Math.max(2, n)));

// Orden de siembra en la llave (1 vs 8, 4 vs 5, 2 vs 7, 3 vs 6…): los mejores se cruzan lo más tarde posible
export function seedOrder(size) {
  let order = [1, 2];
  while (order.length < size) {
    const n = order.length * 2 + 1;
    order = order.flatMap((s) => [s, n - s]);
  }
  return order;
}

// Nombre de la ronda según cuántas faltan para la final
function roundName(roundsFromEnd, r) {
  return [LABELS.final, LABELS.semi, LABELS.quarter, LABELS.eighth][roundsFromEnd] || LABELS.round(r);
}

const slotTeam = (team) => ({ team: { id: team.id, name: team.name || "", color: team.color || "" } });
const BYE = { bye: true };
const W = (key) => ({ from: key, take: "W" });
const L = (key) => ({ from: key, take: "L" });

/**
 * Llave de eliminación (simple) para `seeds` (equipos o slots ya armados, en orden de siembra).
 * @returns {{ games: object[], finalKey: string, rounds: number }}
 */
function elimination(seeds, { prefix = "", phase = "", thirdPlace = false, startRound = 1 } = {}) {
  const size = pow2(seeds.length);
  const rounds = Math.log2(size);
  const order = seedOrder(size);
  const slotOf = (seed) => {
    const s = seeds[seed - 1];
    if (!s) return BYE;
    return s.team || s.pool || s.from ? s : slotTeam(s);
  };
  const games = [];
  let prev = [];
  for (let r = 1; r <= rounds; r++) {
    const count = size / 2 ** r;
    const name = roundName(rounds - r, r);
    const cur = [];
    for (let i = 0; i < count; i++) {
      const key = `${prefix}R${r}-${i + 1}`;
      const a = r === 1 ? slotOf(order[i * 2]) : W(prev[i * 2]);
      const b = r === 1 ? slotOf(order[i * 2 + 1]) : W(prev[i * 2 + 1]);
      games.push({ key, base: phase ? `${phase} · ${name}` : name, round: startRound + r - 1, slotA: a, slotB: b });
      cur.push(key);
    }
    prev = cur;
  }
  if (thirdPlace && rounds >= 2) {
    const semis = games.filter((g) => g.key.startsWith(`${prefix}R${rounds - 1}-`)).map((g) => g.key);
    games.push({ key: `${prefix}3P`, base: phase ? `${phase} · ${LABELS.third}` : LABELS.third, round: startRound + rounds - 1, slotA: L(semis[0]), slotB: L(semis[1]) });
  }
  return { games, finalKey: prev[0], rounds };
}

/**
 * Doble eliminación: llave de ganadores, llave de perdedores y gran final.
 * Perder una vez te manda a perdedores; perder dos te elimina.
 */
function doubleElimination(seeds, { prefix = "" } = {}) {
  const size = pow2(seeds.length);
  const k = Math.log2(size);
  const wb = elimination(seeds, { prefix: `${prefix}W`, phase: LABELS.winners });
  const games = [...wb.games];
  const wKey = (r, i) => `${prefix}WR${r}-${i + 1}`;
  let lr = 0;
  let prev = [];
  // L1: los perdedores de la 1ª ronda de ganadores se cruzan entre sí
  if (k >= 2) {
    lr++;
    const count = size / 4;
    for (let i = 0; i < count; i++) {
      const key = `${prefix}LR${lr}-${i + 1}`;
      games.push({ key, base: `${LABELS.losers} · ${LABELS.round(lr)}`, round: 2, slotA: L(wKey(1, i * 2)), slotB: L(wKey(1, i * 2 + 1)) });
      prev.push(key);
    }
    for (let j = 2; j <= k; j++) {
      // caen los perdedores de la ronda j de ganadores (en orden inverso, para evitar revanchas inmediatas)
      lr++;
      const count2 = size / 2 ** j;
      const drop = [];
      for (let i = 0; i < count2; i++) {
        const key = `${prefix}LR${lr}-${i + 1}`;
        const isLast = j === k;
        const base = isLast ? `${LABELS.losers} · ${LABELS.final}` : `${LABELS.losers} · ${LABELS.round(lr)}`;
        games.push({ key, base, round: j + lr - 1, slotA: W(prev[i]), slotB: L(wKey(j, count2 - 1 - i)) });
        drop.push(key);
      }
      prev = drop;
      if (j < k) {
        lr++;
        const half = drop.length / 2;
        const cons = [];
        for (let i = 0; i < half; i++) {
          const key = `${prefix}LR${lr}-${i + 1}`;
          games.push({ key, base: `${LABELS.losers} · ${LABELS.round(lr)}`, round: j + lr - 1, slotA: W(drop[i * 2]), slotB: W(drop[i * 2 + 1]) });
          cons.push(key);
        }
        prev = cons;
      }
    }
  }
  const lbFinal = prev[0];
  const maxRound = Math.max(...games.map((g) => g.round || 1));
  games.push({ key: `${prefix}GF`, base: LABELS.grandFinal, round: maxRound + 1, slotA: W(wb.finalKey), slotB: lbFinal ? W(lbFinal) : L(wb.finalKey) });
  return { games };
}

/**
 * Saca los partidos con "bye": el equipo que no tiene rival pasa solo, y su "perdedor" es otro bye.
 * Repite hasta que no quede ninguno (en doble eliminación los byes se encadenan).
 */
function collapseByes(games) {
  let list = games.slice();
  for (let guard = 0; guard < 200; guard++) {
    const g = list.find((x) => x.slotA?.bye || x.slotB?.bye);
    if (!g) break;
    const winner = g.slotA?.bye ? g.slotB : g.slotA;
    const loser = BYE;
    list = list.filter((x) => x !== g).map((x) => {
      const fix = (s) => (s?.from === g.key ? (s.take === "W" ? winner : loser) : s);
      return { ...x, slotA: fix(x.slotA), slotB: fix(x.slotB) };
    });
  }
  return list;
}

// Nombres finales: "Semifinal 1", "Semifinal 2"… (numerados solo si hay más de uno, después de sacar los byes)
function withLabels(games) {
  const total = new Map();
  games.forEach((g) => total.set(g.base, (total.get(g.base) || 0) + 1));
  const seen = new Map();
  return games.map((g) => {
    const n = (seen.get(g.base) || 0) + 1;
    seen.set(g.base, n);
    // "Ronda 1" ya termina en número: "Ronda 1 (2)" en vez de "Ronda 1 2"
    const numbered = /\d$/.test(g.base) ? `${g.base} (${n})` : `${g.base} ${n}`;
    return { ...g, label: total.get(g.base) > 1 ? numbered : g.base };
  });
}

/* =========================
   Generadores (los registra formats.js)
========================= */
// teams en orden de siembra (el organizador los ordena; si no, alfabético)
export function singleElimination(teams, { thirdPlace = false } = {}) {
  return withLabels(collapseByes(elimination(teams, { thirdPlace }).games));
}

export function doubleElim(teams) {
  return withLabels(collapseByes(doubleElimination(teams).games));
}

/**
 * Grupos + playoffs: round robin por grupo y una llave con los mejores de cada grupo.
 * @param {object[]} rrGames partidos de grupos ya armados (round robin)
 */
export function poolsPlayoffs(teams, rrGames, { advance = 2, thirdPlace = false, divisionId = "" } = {}) {
  const pools = [...new Set(teams.map((t) => String(t.pool || "").trim().toUpperCase() || "A"))].sort();
  // siembra: 1º de cada grupo, después 2º de cada grupo… (A1, B1, A2, B2 → A1 vs B2, B1 vs A2)
  const seeds = [];
  for (let r = 1; r <= advance; r++) pools.forEach((pool) => seeds.push({ pool, rank: r, divisionId }));
  const lastPoolRound = Math.max(0, ...rrGames.map((g) => g.round || 0));
  const bracket = withLabels(collapseByes(elimination(seeds, { prefix: "P", thirdPlace, startRound: lastPoolRound + 1 }).games));
  return { pools, bracket };
}

/**
 * Suizo: arma la ronda siguiente emparejando equipos con el mismo récord, sin repetir rivales.
 * @param {object[]} played partidos suizos ya creados de esta división
 * @returns {{ round: number, games: object[], bye: object|null }}
 */
export function nextSwissRound(teams, played = []) {
  const round = Math.max(0, ...played.map((g) => g.round || 0)) + 1;
  const met = new Set(played.map((g) => [g.teamA?.id, g.teamB?.id].sort().join("|")));
  const table = standings(teams, played);
  const order = round === 1
    // 1ª ronda: mitad de arriba contra mitad de abajo según la siembra
    ? (() => { const h = Math.ceil(teams.length / 2); return teams.slice(0, h).flatMap((t, i) => [t, teams[h + i]]).filter(Boolean); })()
    : table.map((r) => r.team);
  const byeTaken = new Set(played.filter((g) => g.bye).map((g) => g.teamA?.id));
  const pool = order.slice();
  let bye = null;
  if (pool.length % 2) {
    // descansa el peor ubicado que todavía no descansó
    const idx = [...pool.keys()].reverse().find((i) => !byeTaken.has(pool[i].id));
    bye = pool.splice(idx ?? pool.length - 1, 1)[0];
  }
  const games = [];
  while (pool.length) {
    const a = pool.shift();
    let j = pool.findIndex((b) => !met.has([a.id, b.id].sort().join("|")));
    if (j < 0) j = 0; // sin opción: se repite el cruce
    const b = pool.splice(j, 1)[0];
    games.push({ round, teamA: a, teamB: b });
  }
  return { round, games, bye };
}

/* =========================
   Resolución (ganadores, perdedores y posiciones de grupo)
========================= */
const winnerSide = (g) => {
  if (g?.status !== GAME_STATUS.FINAL) return "";
  const a = g.scoreA || 0;
  const b = g.scoreB || 0;
  return a > b ? "A" : b > a ? "B" : "";
};

/**
 * Llena teamA / teamB de los partidos de llave con el equipo real cuando ya se sabe.
 * Si todavía no se sabe, deja un equipo "placeholder" con el texto (ej. "Ganador de Semifinal 1").
 * Devuelve una lista nueva; los partidos sin slots quedan igual.
 */
export function resolveGames(games = []) {
  if (!games.some((g) => g.slotA || g.slotB)) return games;
  const byKey = new Map(games.filter((g) => g.key).map((g) => [`${g.divisionId || ""}|${g.key}`, g]));
  const memo = new Map();

  const poolTeam = (slot, divisionId) => {
    const div = slot.divisionId ?? divisionId ?? "";
    const poolGames = games.filter((g) => (g.divisionId || "") === div && !g.phase && !g.key && String(g.pool || "").toUpperCase() === slot.pool);
    // un solo grupo: los partidos no llevan "pool"
    const list = poolGames.length ? poolGames : games.filter((g) => (g.divisionId || "") === div && !g.phase && !g.key && !g.pool);
    if (!list.length || list.some((g) => g.status !== GAME_STATUS.FINAL)) return null;
    const teams = new Map();
    list.forEach((g) => [g.teamA, g.teamB].forEach((t) => t?.id && teams.set(t.id, t)));
    return standings([...teams.values()], list)[slot.rank - 1]?.team || null;
  };

  const teamFor = (slot, divisionId, depth = 0) => {
    if (!slot || depth > 40) return null;
    if (slot.team) return slot.team;
    if (slot.pool) return poolTeam(slot, divisionId);
    if (!slot.from) return null;
    const src = resolveOne(byKey.get(`${divisionId || ""}|${slot.from}`), depth + 1);
    const side = winnerSide(src);
    if (!src || !side) return null;
    const pick = slot.take === "W" ? side : side === "A" ? "B" : "A";
    const t = pick === "A" ? src.teamA : src.teamB;
    return t && t.id ? t : null;
  };

  const labelFor = (slot, divisionId) => {
    if (!slot) return "—";
    if (slot.pool) return LABELS.poolRank(slot.rank, slot.pool);
    if (slot.bye) return LABELS.bye;
    const src = byKey.get(`${divisionId || ""}|${slot.from}`);
    const name = src?.phase || slot.from;
    return slot.take === "W" ? LABELS.winnerOf(name) : LABELS.loserOf(name);
  };

  function resolveOne(g, depth = 0) {
    if (!g) return null;
    if (memo.has(g)) return memo.get(g);
    if (!g.slotA && !g.slotB) {
      memo.set(g, g);
      return g;
    }
    const filled = { A: false, B: false };
    const fill = (slot, current, side) => {
      if (current?.id) return current; // ya guardado con el equipo real
      const t = teamFor(slot, g.divisionId, depth);
      if (t) filled[side] = true; // se acaba de saber: el organizador lo guarda en el partido
      return t ? { id: t.id, name: t.name || "", color: t.color || "" } : { id: "", name: labelFor(slot, g.divisionId), placeholder: true };
    };
    const out = { ...g, teamA: fill(g.slotA, g.teamA, "A"), teamB: fill(g.slotB, g.teamB, "B"), _filled: filled };
    memo.set(g, out);
    return out;
  }

  return games.map((g) => resolveOne(g));
}

// ¿el partido ya tiene sus dos equipos? (si no, todavía no se puede jugar)
export const hasBothTeams = (g) => !!(g?.teamA?.id && g?.teamB?.id);
