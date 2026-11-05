// /js/features/events/events_model.js
// Lógica pura de eventos organizados (sin Firebase): reglas, estado del partido a partir de sus jugadas,
// estadísticas por jugador y equipo, posiciones, líderes y espíritu.

export const GAME_STATUS = { SCHEDULED: "scheduled", LIVE: "live", FINAL: "final" };
export const EVENT_STATUS = { DRAFT: "draft", PUBLISHED: "published", FINISHED: "finished" };

// Jugadas que se guardan en org_events/{e}/games/{g}/plays
export const PLAY = {
  START: "start",
  GOAL: "goal",
  DROP: "drop",
  THROWAWAY: "throwaway",
  BLOCK: "block",
  TIMEOUT: "timeout",
  HALFTIME: "halftime",
  PAUSE: "pause",
  RESUME: "resume",
  END: "end",
  // registro (no cambian el marcador): quedan en Jugadas para que todo sea trazable
  CLOCK_ADJUST: "clock_adjust",
  BREAK_END: "break_end",
  REOPEN: "reopen",
  RATIO: "ratio", // mixto con proporción por punto: { point, letter: "F" | "M" }
};

export const AUDIT_PLAYS = [PLAY.CLOCK_ADJUST, PLAY.BREAK_END, PLAY.REOPEN, PLAY.RATIO];

// Reglas de proporción en mixto (WFDF Apéndice / USA Ultimate):
//  abba    Regla A (proporción prescrita): se elige el 1er punto y se alterna cada dos puntos (ABBA)
//  offense La ofensiva elige en cada punto (ligas locales)
//  fixed   Fija: siempre la misma (ej. 4M · 3F)
//  none    Libre: no se lleva proporción
export const RATIO_RULES = ["abba", "offense", "fixed", "none"];
export const ratioPerPoint = (rules) => rules?.ratioRule === "offense";
// ¿se elige la proporción del primer punto al iniciar?
export const ratioChosenAtStart = (rules) => rules?.ratioRule === "abba" || ratioPerPoint(rules);

export const SPIRIT_KEYS = ["rules", "fouls", "fair", "attitude", "comm"];

export const DEFAULT_RULES = {
  gameMinutes: 90, // el reloj cuenta hacia atrás desde aquí (0 = hacia arriba)
  stopClockOnBreaks: true, // el reloj se detiene en timeouts y medio tiempo
  auditLog: true, // Jugadas muestra todo: anuladas, pausas, ajustes de reloj, reaperturas
  mode: "7v7", // modalidad (ver GAME_MODES en divisions-config.js)
  playersOnField: 7,
  betweenGamesMin: 10, // descanso entre partidos al armar el calendario
  gameTo: 13,
  halftimeAt: 7,
  softCapMin: 0,
  hardCapMin: 0,
  timeoutsPerHalf: 1,
  timeoutSeconds: 75,
  halftimeMinutes: 7,
  rosterMin: 7, // jugadores mínimos por equipo (por defecto, los que van en cancha)
  rosterMax: 0, // 0 = sin máximo
  ratioRule: "abba", // mixto: ver RATIO_RULES
  ratioFixed: "M", // con ratioRule "fixed": mayoría de hombres (M) o mujeres (F)
  mvp: { goals: 1, assists: 1, blocks: 1, turns: 0 },
};

export function eventRules(event = {}) {
  const r = event.rules || {};
  const n = (v, d) => (Number.isFinite(Number(v)) && v !== "" && v !== null ? Number(v) : d);
  return {
    gameMinutes: n(r.gameMinutes, DEFAULT_RULES.gameMinutes),
    stopClockOnBreaks: typeof r.stopClockOnBreaks === "boolean" ? r.stopClockOnBreaks : DEFAULT_RULES.stopClockOnBreaks,
    auditLog: typeof r.auditLog === "boolean" ? r.auditLog : DEFAULT_RULES.auditLog,
    mode: r.mode || DEFAULT_RULES.mode,
    playersOnField: n(r.playersOnField, DEFAULT_RULES.playersOnField),
    betweenGamesMin: n(r.betweenGamesMin, DEFAULT_RULES.betweenGamesMin),
    gameTo: n(r.gameTo, DEFAULT_RULES.gameTo),
    halftimeAt: n(r.halftimeAt, DEFAULT_RULES.halftimeAt),
    softCapMin: n(r.softCapMin, 0),
    hardCapMin: n(r.hardCapMin, 0),
    timeoutsPerHalf: n(r.timeoutsPerHalf, DEFAULT_RULES.timeoutsPerHalf),
    timeoutSeconds: n(r.timeoutSeconds, DEFAULT_RULES.timeoutSeconds),
    halftimeMinutes: n(r.halftimeMinutes, DEFAULT_RULES.halftimeMinutes),
    // torneos viejos sin el dato: 0 (sin mínimo), igual que las reglas de Firestore
    rosterMin: n(r.rosterMin, 0),
    rosterMax: n(r.rosterMax, 0),
    ratioRule: RATIO_RULES.includes(r.ratioRule) ? r.ratioRule : DEFAULT_RULES.ratioRule,
    ratioFixed: r.ratioFixed === "F" ? "F" : "M",
    mvp: {
      goals: n(r.mvp?.goals, 1),
      assists: n(r.mvp?.assists, 1),
      blocks: n(r.mvp?.blocks, 1),
      turns: n(r.mvp?.turns, 0),
    },
  };
}

// Tipo de campo del torneo
export const SURFACES = ["grass", "turf", "indoor", "beach", "other"];
export const SURFACE_ICONS = { grass: "bi-tree", turf: "bi-grid-3x3", indoor: "bi-house", beach: "bi-sun", other: "bi-geo" };

// ¿el roster cumple el mínimo y máximo del torneo? "" si sí, o "min" / "max".
export function rosterProblem(count, rules = DEFAULT_RULES) {
  if (rules.rosterMin && count < rules.rosterMin) return "min";
  if (rules.rosterMax && count > rules.rosterMax) return "max";
  return "";
}

export const other = (side) => (side === "A" ? "B" : "A");

// Minutos que ocupa cada partido en el calendario (duración + descanso)
export function slotMinutes(rules = DEFAULT_RULES) {
  const game = rules.gameMinutes || rules.hardCapMin || 90;
  return game + (rules.betweenGamesMin || 0);
}

/* =========================
   Divisiones y mixto
========================= */
export const findDivision = (event, id) => (event?.divisions || []).find((d) => d.id === id) || null;

export function isMixedDivision(division) {
  if (!division) return false;
  if (typeof division.mixed === "boolean") return division.mixed;
  return /mixt|mixed/i.test(division.name || "");
}

// Regla A (WFDF, ABBA): el 1er punto usa la proporción elegida, luego se alterna cada dos puntos.
// pointIndex 0 = primer punto. Devuelve "F" (FMP) o "M" (MMP).
export function ratioForPoint(pointIndex, first) {
  if (first !== "F" && first !== "M") return "";
  const group = Math.floor((pointIndex + 1) / 2);
  return group % 2 === 0 ? first : first === "F" ? "M" : "F";
}

// "4F · 3M" para 7 en cancha; vacío si es par (no hay proporción que elegir)
export function ratioLabel(letter, players = 7) {
  const p = Number(players) || 0;
  if (!letter || p < 2 || p % 2 === 0) return "";
  const maj = Math.ceil(p / 2);
  const min = Math.floor(p / 2);
  return letter === "F" ? `${maj}F · ${min}M` : `${maj}M · ${min}F`;
}

export const needsRatio = (division, rules = DEFAULT_RULES) =>
  isMixedDivision(division) && (rules.playersOnField || 0) % 2 === 1 && rules.ratioRule !== "none";

// Proporción ("F" o "M") del punto pointIndex (0 = primer punto) según la regla del torneo.
export function pointRatio(rules, game = {}, plays = [], pointIndex = 0) {
  const rule = rules?.ratioRule || "abba";
  if (rule === "none") return "";
  if (rule === "fixed") return rules.ratioFixed === "F" ? "F" : "M";
  if (rule === "abba") return ratioForPoint(pointIndex, game.ratioFirst);
  // por punto: la última elección registrada para ese punto (el primero puede venir del inicio)
  const chosen = plays.filter((p) => p.type === PLAY.RATIO && !p.deleted && p.point === pointIndex).sort((a, b) => (a.at || 0) - (b.at || 0)).pop();
  if (chosen) return chosen.letter === "F" ? "F" : "M";
  return pointIndex === 0 && (game.ratioFirst === "F" || game.ratioFirst === "M") ? game.ratioFirst : "";
}

export function slugify(text) {
  return String(text || "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
}

export function randomId(prefix = "") {
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  return prefix + [...bytes].map((b) => b.toString(36).padStart(2, "0")).join("").slice(0, 16);
}

// "7, Ana Mora, F" por línea -> [{ id, number, name, gender }]
export function parseRoster(text, existing = []) {
  const byKey = new Map(existing.map((p) => [`${p.number ?? ""}|${String(p.name).toLowerCase()}`, p]));
  return String(text || "")
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split(/[,;\t]/).map((s) => s.trim());
      let number = null;
      let name = line;
      let gender = "";
      if (parts.length >= 2 && /^#?\d{1,3}$/.test(parts[0])) {
        number = Number(parts[0].replace("#", ""));
        name = parts[1];
        gender = (parts[2] || "").toUpperCase().slice(0, 1);
      } else if (parts.length >= 2) {
        name = parts[0];
        gender = (parts[1] || "").toUpperCase().slice(0, 1);
      }
      const prev = byKey.get(`${number ?? ""}|${name.toLowerCase()}`);
      return { id: prev?.id || randomId("p"), number, name, gender: ["M", "F"].includes(gender) ? gender : "" };
    });
}

export function rosterToText(players = []) {
  return players.map((p) => [p.number ?? "", p.name, p.gender || ""].filter((v, i) => i === 1 || v !== "").join(", ")).join("\n");
}

/* =========================
   Reloj
========================= */
// clock = { startedAt (ms), pausedMs, pausedAt (ms|null), offsetMs, endedAt,
//           break: { type: "timeout"|"halftime", team, endsAt (ms), stopsClock } | null }
export function gameElapsedMs(clock = {}, now = Date.now()) {
  if (!clock.startedAt) return 0;
  const end = clock.pausedAt || clock.endedAt || now;
  return Math.max(0, end - clock.startedAt - (clock.pausedMs || 0) + (clock.offsetMs || 0));
}

export function fmtClock(ms) {
  const s = Math.floor(Math.max(0, ms) / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

// Cuenta regresiva: redondea hacia arriba para que muestre 0:00 solo al terminar.
export function fmtCountdown(ms) {
  return fmtClock(Math.ceil(Math.max(0, ms) / 1000) * 1000);
}

/**
 * Lo que muestra el reloj del partido.
 * @returns {{ text, countdown, elapsedMs, remainingMs, timeUp, paused, brk: null|{ type, team, remainingMs, text, done } }}
 */
export function clockView(clock = {}, rules = DEFAULT_RULES, now = Date.now()) {
  const elapsedMs = gameElapsedMs(clock, now);
  const totalMs = (Number(rules.gameMinutes) || 0) * 60000;
  const countdown = totalMs > 0;
  const remainingMs = countdown ? Math.max(0, totalMs - elapsedMs) : 0;
  const b = clock.break;
  const brk = b && b.endsAt
    ? { type: b.type, team: b.team || "", remainingMs: Math.max(0, b.endsAt - now), text: fmtCountdown(b.endsAt - now), done: now >= b.endsAt }
    : null;
  return {
    text: countdown ? fmtCountdown(remainingMs) : fmtClock(elapsedMs),
    countdown,
    elapsedMs,
    remainingMs,
    timeUp: countdown && remainingMs <= 0 && !!clock.startedAt,
    paused: !!clock.pausedAt && !clock.endedAt,
    brk,
  };
}

// Empieza un timeout / medio tiempo: cuenta regresiva propia y (según reglas) detiene el reloj del partido.
export function startBreak(clock = {}, { type, team = "", seconds }, rules = DEFAULT_RULES, now = Date.now()) {
  const stopsClock = !!rules.stopClockOnBreaks && !clock.pausedAt;
  return {
    ...clock,
    ...(stopsClock ? { pausedAt: now } : {}),
    break: { type, team, endsAt: now + Math.max(0, Number(seconds) || 0) * 1000, stopsClock },
  };
}

// Termina el descanso (al llegar a 0 o antes) y reanuda el reloj si lo había detenido.
export function endBreak(clock = {}, now = Date.now()) {
  const b = clock.break;
  if (!b) return clock;
  const next = { ...clock, break: null };
  if (b.stopsClock && clock.pausedAt) {
    next.pausedMs = (clock.pausedMs || 0) + (now - clock.pausedAt);
    next.pausedAt = null;
  }
  return next;
}

/* =========================
   Estado del partido a partir de sus jugadas
========================= */
// Orden: tiempo de juego, y si empatan (dos jugadas en el mismo segundo) el momento en que se anotaron.
export function sortPlays(plays = []) {
  return plays.slice().sort((a, b) => (a.t ?? 0) - (b.t ?? 0) || (a.at ?? 0) - (b.at ?? 0) || String(a.id).localeCompare(String(b.id)));
}
const isTurnForA = (p, possession) =>
  // ¿la jugada le quita el disco al equipo que lo tenía?
  ((p.type === PLAY.DROP || p.type === PLAY.THROWAWAY) && p.team === possession) ||
  (p.type === PLAY.BLOCK && p.team !== possession);

/**
 * @param {Array} plays  ordenadas por t
 * @param {object} game  { offenseFirst: "A"|"B" }
 * @param {object} rules eventRules()
 */
export function computeGameState(plays = [], game = {}, rules = DEFAULT_RULES) {
  const list = sortPlays(plays.filter((p) => !p.deleted));
  const startOffense = game.offenseFirst === "B" ? "B" : "A";

  const s = {
    score: { A: 0, B: 0 },
    half: false,
    halftimeDone: false,
    started: false,
    ended: false,
    offense: startOffense, // quién arrancó el punto actual en ofensiva
    possession: startOffense,
    timeoutsUsed: { A: [0, 0], B: [0, 0] }, // [primera mitad, segunda mitad]
    teams: {
      A: { goals: 0, turns: 0, blocks: 0, holds: 0, oPoints: 0, breaks: 0, breakChances: 0, dPoints: 0 },
      B: { goals: 0, turns: 0, blocks: 0, holds: 0, oPoints: 0, breaks: 0, breakChances: 0, dPoints: 0 },
    },
    players: {}, // id -> { goals, assists, blocks, turns, callahans }
    points: [], // [{ n, offense, scoredBy, scoreA, scoreB, break }]
    feed: list,
  };

  const pl = (id) => {
    if (!id) return null;
    if (!s.players[id]) s.players[id] = { goals: 0, assists: 0, blocks: 0, turns: 0, callahans: 0 };
    return s.players[id];
  };

  for (const p of list) {
    switch (p.type) {
      case PLAY.START:
        s.started = true;
        break;
      case PLAY.GOAL: {
        const scorer = p.team;
        s.score[scorer] += 1;
        s.teams[scorer].goals += 1;
        const isBreak = scorer !== s.offense;
        if (isBreak) s.teams[scorer].breaks += 1;
        else s.teams[scorer].holds += 1;
        s.teams[s.offense].oPoints += 1;
        s.teams[other(s.offense)].dPoints += 1;
        if (pl(p.scorerId)) pl(p.scorerId).goals += 1;
        if (p.callahan) {
          if (pl(p.scorerId)) pl(p.scorerId).callahans += 1;
        } else if (pl(p.assistId)) pl(p.assistId).assists += 1;
        s.points.push({ n: s.points.length + 1, offense: s.offense, scoredBy: scorer, scoreA: s.score.A, scoreB: s.score.B, break: isBreak, t: p.t });
        // siguiente punto: ataca el que recibió el gol
        s.offense = other(scorer);
        s.possession = s.offense;
        break;
      }
      case PLAY.DROP:
      case PLAY.THROWAWAY:
      case PLAY.BLOCK: {
        if (p.type === PLAY.BLOCK) {
          s.teams[p.team].blocks += 1;
          if (pl(p.playerId)) pl(p.playerId).blocks += 1;
        } else {
          s.teams[p.team].turns += 1;
          if (pl(p.playerId)) pl(p.playerId).turns += 1;
        }
        if (isTurnForA(p, s.possession)) {
          s.possession = other(s.possession);
          // el equipo que arrancó en defensa recupera el disco: oportunidad de break
          if (s.possession !== s.offense) s.teams[s.possession].breakChances += 1;
        }
        break;
      }
      case PLAY.TIMEOUT:
        s.timeoutsUsed[p.team][s.halftimeDone ? 1 : 0] += 1;
        break;
      case PLAY.HALFTIME:
        s.halftimeDone = true;
        // WFDF: después del medio tiempo ataca quien empezó el partido en defensa
        s.offense = other(startOffense);
        s.possession = s.offense;
        break;
      case PLAY.END:
        s.ended = true;
        break;
      default:
        break;
    }
  }

  const halfIdx = s.halftimeDone ? 1 : 0;
  s.timeoutsLeft = {
    A: Math.max(0, rules.timeoutsPerHalf - s.timeoutsUsed.A[halfIdx]),
    B: Math.max(0, rules.timeoutsPerHalf - s.timeoutsUsed.B[halfIdx]),
  };
  s.suggestHalftime = !s.halftimeDone && Math.max(s.score.A, s.score.B) >= rules.halftimeAt;
  s.reachedGameTo = Math.max(s.score.A, s.score.B) >= rules.gameTo;
  return s;
}

/* =========================
   Resumen guardado en el doc del partido (para posiciones y líderes sin leer cada jugada)
========================= */
export function gameSummary(state) {
  return {
    scoreA: state.score.A,
    scoreB: state.score.B,
    teamStats: state.teams,
    playerStats: state.players,
    halftimeDone: state.halftimeDone,
  };
}

/* =========================
   Lista de jugadas
========================= */
// Con historial completo se ven también las anuladas y los registros (reloj, reaperturas);
// sin él, solo las jugadas vigentes.
export function feedPlays(plays = [], rules = DEFAULT_RULES) {
  const list = rules.auditLog ? plays : plays.filter((p) => !p.deleted && !AUDIT_PLAYS.includes(p.type));
  return sortPlays(list);
}

/* =========================
   MVP y líderes
========================= */
export function mvpScore(p, rules = DEFAULT_RULES) {
  const w = rules.mvp || DEFAULT_RULES.mvp;
  return (p.goals || 0) * w.goals + (p.assists || 0) * w.assists + (p.blocks || 0) * w.blocks - (p.turns || 0) * w.turns;
}

/**
 * @param games  partidos con playerStats y teamA/teamB
 * @param teams  [{ id, name, players: [] }]
 */
export function playerTotals(games = [], teams = [], rules = DEFAULT_RULES) {
  const playerInfo = new Map();
  teams.forEach((t) => (t.players || []).forEach((p) => playerInfo.set(p.id, { ...p, teamId: t.id, teamName: t.name })));
  const totals = new Map();
  games.forEach((g) => {
    Object.entries(g.playerStats || {}).forEach(([id, st]) => {
      const cur = totals.get(id) || { id, goals: 0, assists: 0, blocks: 0, turns: 0, callahans: 0, games: 0 };
      cur.goals += st.goals || 0;
      cur.assists += st.assists || 0;
      cur.blocks += st.blocks || 0;
      cur.turns += st.turns || 0;
      cur.callahans += st.callahans || 0;
      cur.games += 1;
      totals.set(id, cur);
    });
  });
  return [...totals.values()]
    .map((t) => ({ ...t, ...(playerInfo.get(t.id) || { name: "—" }), mvp: mvpScore(t, rules) }))
    .filter((t) => t.name);
}

export function leaders(totals, key, limit = 10) {
  return totals
    .filter((t) => (t[key] || 0) > 0)
    .sort((a, b) => (b[key] || 0) - (a[key] || 0) || (b.mvp || 0) - (a.mvp || 0) || String(a.name).localeCompare(String(b.name)))
    .slice(0, limit);
}

/* =========================
   Posiciones
========================= */
// Orden: ganados, enfrentamiento directo (empate de 2), diferencia, puntos a favor, nombre
export function standings(teams = [], games = []) {
  const rows = new Map(teams.map((t) => [t.id, { team: t, played: 0, w: 0, l: 0, pf: 0, pa: 0 }]));
  const finals = games.filter((g) => g.status === GAME_STATUS.FINAL && rows.has(g.teamA?.id) && rows.has(g.teamB?.id));

  finals.forEach((g) => {
    const a = rows.get(g.teamA.id);
    const b = rows.get(g.teamB.id);
    const sa = g.scoreA || 0;
    const sb = g.scoreB || 0;
    a.played++; b.played++;
    a.pf += sa; a.pa += sb;
    b.pf += sb; b.pa += sa;
    if (sa > sb) { a.w++; b.l++; } else if (sb > sa) { b.w++; a.l++; }
  });

  const h2h = (x, y) => {
    let diff = 0;
    finals.forEach((g) => {
      if (g.teamA.id === x && g.teamB.id === y) diff += (g.scoreA || 0) - (g.scoreB || 0);
      if (g.teamA.id === y && g.teamB.id === x) diff += (g.scoreB || 0) - (g.scoreA || 0);
    });
    return diff;
  };

  const list = [...rows.values()].map((r) => ({ ...r, diff: r.pf - r.pa }));
  list.sort((a, b) => {
    if (b.w !== a.w) return b.w - a.w;
    const tiedTwo = list.filter((r) => r.w === a.w).length === 2;
    if (tiedTwo) {
      const d = h2h(b.team.id, a.team.id);
      if (d !== 0) return d;
    }
    if (b.diff !== a.diff) return b.diff - a.diff;
    if (b.pf !== a.pf) return b.pf - a.pf;
    return String(a.team.name).localeCompare(String(b.team.name));
  });
  return list;
}

/* =========================
   Espíritu (WFDF)
========================= */
export function spiritTotal(card = {}) {
  return SPIRIT_KEYS.reduce((sum, k) => sum + (Number(card[k]) || 0), 0);
}

// Promedio recibido por equipo (lo que le dieron los rivales)
export function spiritTable(teams = [], games = []) {
  const rows = new Map(teams.map((t) => [t.id, { team: t, count: 0, total: 0, cats: Object.fromEntries(SPIRIT_KEYS.map((k) => [k, 0])) }]));
  games.forEach((g) => {
    // spirit.A = lo que A le dio a B
    [["A", "B"], ["B", "A"]].forEach(([giver, receiver]) => {
      const card = g.spirit?.[giver];
      const team = receiver === "A" ? g.teamA : g.teamB;
      if (!card || !team || !rows.has(team.id)) return;
      const r = rows.get(team.id);
      r.count++;
      r.total += spiritTotal(card);
      SPIRIT_KEYS.forEach((k) => (r.cats[k] += Number(card[k]) || 0));
    });
  });
  return [...rows.values()]
    .map((r) => ({
      ...r,
      avg: r.count ? r.total / r.count : 0,
      catAvg: Object.fromEntries(SPIRIT_KEYS.map((k) => [k, r.count ? r.cats[k] / r.count : 0])),
    }))
    .sort((a, b) => b.avg - a.avg || b.count - a.count);
}
