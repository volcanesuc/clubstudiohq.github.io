// /tournaments/js/bracket_view.js
// Vista "Llave" de un torneo: grupos → rondas de la llave → posiciones finales (en columnas, como un cuadro).
// Sirve para torneos armados acá (slots que se llenan solos) y para los importados (solo tienen la fase).

import { GAME_STATUS, standings } from "/tournaments/js/model.js";
import { EX, LOCALE, exf, trData } from "/tournaments/js/strings.js";
import { esc, fmtTimeOnly, fmtWhen, teamBadge, toMillis, withLiveTeams } from "/tournaments/js/ui.js";

const isBracketGame = (g) => !!(g.phase || g.key);

// Partidos que definen puestos: "Final" = 1º-2º, "Tercer lugar" = 3º-4º, "Puesto 9-10"…
const PLACE_PHASES = [
  [/^Final$/i, 1],
  [/^Tercer lugar/i, 3],
  [/^Quinto lugar/i, 5],
  [/^S[ée]ptimo lugar/i, 7],
  [/^Puesto (\d+)-\d+$/i, null],
];
function placeOfPhase(phase = "") {
  for (const [re, place] of PLACE_PHASES) {
    const m = String(phase).match(re);
    if (m) return place ?? Number(m[1]);
  }
  return 0;
}

/**
 * Puesto final de cada equipo: el guardado (importados) o el que sale de los partidos por puesto ya jugados.
 * @returns {Map<string, number>} teamId -> puesto
 */
export function finalPlaces(teams = [], games = []) {
  const out = new Map();
  teams.forEach((t) => Number(t.finalPlace) > 0 && out.set(t.id, Number(t.finalPlace)));
  if (out.size) return out;
  games.forEach((g) => {
    const place = placeOfPhase(g.phase);
    if (!place || g.status !== GAME_STATUS.FINAL || !g.teamA?.id || !g.teamB?.id) return;
    const a = g.scoreA || 0;
    const b = g.scoreB || 0;
    if (a === b) return;
    out.set(a > b ? g.teamA.id : g.teamB.id, place);
    out.set(a > b ? g.teamB.id : g.teamA.id, place + 1);
  });
  return out;
}

// Nombre de la ronda sin el rango de puestos ni el número: "Puestos 5-8 · Semifinal 2" → "Semifinal"
const roundBase = (phase = "") => String(phase).split(" · ").pop().replace(/\s*(\(\d+\)|\d+)$/, "").trim();
const PLURAL = { Cruce: EX.bkCrossovers, Semifinal: EX.bkSemis, "Cuartos de final": EX.bkQuarters, "Octavos de final": EX.bkEighths };
// Primer puesto que se juega en ese partido (para ordenar: bracket principal arriba, 5-8 después…)
const startPlaceOf = (g) => {
  const m = String(g.phase || "").match(/^Puestos (\d+)-/);
  return m ? Number(m[1]) : placeOfPhase(g.phase) || 1;
};

// Columna de cada partido de bracket: [orden, título]
function columnOf(g) {
  const p = String(g.phase || "");
  // armados acá (con ronda): una columna por ronda, con el nombre de la ronda del bracket principal
  if (g.key && Number(g.round)) return [Number(g.round), null];
  if (/^Octavos/i.test(p)) return [20, EX.bkEighths];
  if (/^Cuartos/i.test(p)) return [30, EX.bkQuarters];
  if (/^Semifinal/i.test(p)) return [40, EX.bkSemis];
  if (placeOfPhase(p)) return [50, EX.bkFinals];
  // otras llaves (ej. "Ronda 1", "Ganadores · Ronda 2"): por ronda, antes de cuartos
  const base = p.replace(/\s+(\(\d+\)|\d+)$/, "").trim() || EX.bkRound;
  return [10 + Math.min(9, Number(g.round) || 0) / 10, PLURAL[base] || trData(base)];
}

const orderInColumn = (g) => startPlaceOf(g);

// Título de una columna por ronda: la ronda del bracket principal; si solo hay partidos por puesto, "Finales"
function roundTitle(games) {
  const main = games.filter((g) => !/^Puestos /.test(g.phase || "") && !placeOfPhase(g.phase));
  if (main.length) {
    const base = roundBase(main[0].phase);
    return PLURAL[base] || trData(base);
  }
  if (games.some((g) => /^Final$/i.test(g.phase || ""))) return EX.bkFinals;
  const any = games.find((g) => !placeOfPhase(g.phase));
  return any ? PLURAL[roundBase(any.phase)] || trData(roundBase(any.phase)) : EX.bkFinals;
}

function gameBox(g, teams, href) {
  const game = withLiveTeams(g, teams);
  const final = game.status === GAME_STATUS.FINAL;
  const live = game.status === GAME_STATUS.LIVE;
  const a = game.scoreA || 0;
  const b = game.scoreB || 0;
  const row = (t, score, other) => {
    const win = final && score > other;
    const tbd = !t?.id;
    return `
      <div class="bk-row ${win ? "is-winner" : ""} ${final && score < other ? "is-loser" : ""} ${tbd ? "is-tbd" : ""}">
        ${teamBadge(t || {}, 20)}
        <span class="bk-row__name">${esc(t?.name || "—")}</span>
        <b class="bk-row__score">${final || live ? score : ""}</b>
      </div>`;
  };
  const when = live ? `<span class="bk-live">${esc(EX.gameLive)}</span>` : !final && toMillis(game.startAt) ? esc(fmtWhen(game.startAt, { weekday: "short" }) + " " + fmtTimeOnly(game.startAt)) : "";
  return `
    <a class="bk-game ${live ? "is-live" : ""}" href="${esc(href(game))}">
      <div class="bk-game__head"><span class="text-truncate">${esc(trData(game.phase || ""))}</span><span>${when}</span></div>
      ${row(game.teamA, a, b)}
      ${row(game.teamB, b, a)}
    </a>`;
}

// Puestos que se juegan en cada partido: [desde, hasta] (ej. "Puestos 17-32 · Octavos de final 3" → [17, 32])
const SIZE_OF_ROUND = { Dieciseisavos: 32, Octavos: 16, Cuartos: 8, Semifinal: 4 };
function rangeOf(g) {
  const p = String(g.phase || "");
  let m = p.match(/^Puestos (\d+)-(\d+)/);
  if (m) return [Number(m[1]), Number(m[2])];
  m = p.match(/^Puesto (\d+)-(\d+)$/);
  if (m) return [Number(m[1]), Number(m[2])];
  const place = placeOfPhase(p);
  if (place) return [place, place + 1];
  m = p.match(/^Ronda de (\d+)/);
  if (m) return [1, Number(m[1])];
  const word = Object.keys(SIZE_OF_ROUND).find((w) => p.startsWith(w));
  return word ? [1, SIZE_OF_ROUND[word]] : null;
}

/**
 * Secciones del bracket para filtrar en torneos grandes (como el mundial): "Cruces", "1-16", "17-32", "33-40".
 * Cada bracket principal de 16+ equipos se parte en su mitad de arriba y de abajo; su 1ª ronda son los cruces.
 * @returns {{ id: string, label: string, from: number, to: number, exact?: boolean }[]} vacío si no hace falta filtrar
 */
export function bracketSections(games = []) {
  const bracket = games.filter(isBracketGame);
  if (bracket.length < 16) return [];
  const ranges = bracket.map(rangeOf).filter(Boolean);
  const tops = ranges
    .filter(([a, b]) => !ranges.some(([c, d]) => c <= a && d >= b && (d - c) > (b - a)))
    .filter(([a, b], i, list) => list.findIndex(([c, d]) => c === a && d === b) === i)
    .sort((x, y) => x[0] - y[0]);
  const out = [];
  tops.forEach(([a, b]) => {
    const n = b - a + 1;
    if (n >= 16) {
      out.push({ id: `x${a}-${b}`, label: EX.bkCrossovers, from: a, to: b, exact: true });
      out.push({ id: `${a}-${a + n / 2 - 1}`, label: `${a}-${a + n / 2 - 1}`, from: a, to: a + n / 2 - 1 });
      out.push({ id: `${a + n / 2}-${b}`, label: `${a + n / 2}-${b}`, from: a + n / 2, to: b });
    } else out.push({ id: `${a}-${b}`, label: `${a}-${b}`, from: a, to: b });
  });
  return out.length > 1 ? out : [];
}

/**
 * @param {{ teams: object[], games: object[], href: (g) => string, title?: string, section?: string }} p
 *   equipos y partidos de UNA división; section = id de bracketSections() ("" = todo)
 */
export function bracketHtml({ teams, games, href, title = "", section = "" }) {
  let bracket = games.filter(isBracketGame);
  if (!bracket.length) return `<div class="ev-card ev-muted">${esc(EX.bkEmpty)}</div>`;
  const byId = new Map(teams.map((t) => [t.id, t]));
  const sections = bracketSections(games);
  const sec = sections.find((s) => s.id === section) || null;
  if (sec) {
    bracket = bracket.filter((g) => {
      const r = rangeOf(g);
      if (!r) return false;
      return sec.exact ? r[0] === sec.from && r[1] === sec.to : r[0] >= sec.from && r[1] <= sec.to;
    });
  }
  const chips = sections.length ? `
    <div class="sb-days bk-sections">
      <button class="sb-day sb-day--all ${!sec ? "is-active" : ""}" data-bk-section="">${esc(EX.bkAll)}</button>
      ${sections.map((s) => `<button class="sb-day ${sec?.id === s.id ? "is-active" : ""}" data-bk-section="${esc(s.id)}">${esc(s.label)}</button>`).join("")}
    </div>` : "";

  // 1) grupos (o la tabla general si no hubo grupos); solo en "Todos"
  const stage = sec ? [] : games.filter((g) => !isBracketGame(g));
  const pools = [...new Set(teams.map((t) => String(t.pool || "").toUpperCase()))].sort();
  const groupCol = stage.length ? `
    <div class="bk-col">
      <div class="bk-col__title">${esc(pools.length > 1 || pools[0] ? EX.bkGroups : EX.bkStage)}</div>
      ${pools.map((pool) => {
        const ts = teams.filter((t) => String(t.pool || "").toUpperCase() === pool);
        const ids = new Set(ts.map((t) => t.id));
        const rows = standings(ts, stage.filter((g) => ids.has(g.teamA?.id) && ids.has(g.teamB?.id)));
        return `
          <div class="bk-group">
            <div class="bk-group__title">${esc(pool ? exf(EX.phasePool, { pool }) : title || EX.bkStage)}</div>
            ${rows.map((r, i) => `
              <div class="bk-row ${i === 0 && r.played ? "is-winner" : ""}">
                <span class="bk-rank">${i + 1}</span>
                ${teamBadge(r.team, 20)}
                <span class="bk-row__name">${esc(r.team.name)}</span>
                <span class="bk-row__rec">${r.w}-${r.l}${r.t ? `-${r.t}` : ""}</span>
              </div>`).join("")}
          </div>`;
      }).join("")}
    </div>` : "";

  // 2) rondas de la llave
  const cols = new Map();
  bracket.forEach((g) => {
    const [order, name] = columnOf(g);
    const k = `${order}|${name}`;
    if (!cols.has(k)) cols.set(k, { order, name, games: [] });
    cols.get(k).games.push(g);
  });
  cols.forEach((c) => (c.name = c.name || roundTitle(c.games)));
  const roundCols = [...cols.values()].sort((a, b) => a.order - b.order).map((c) => `
    <div class="bk-col">
      <div class="bk-col__title">${esc(c.name)}</div>
      <div class="bk-col__games">
        ${c.games.slice().sort((a, b) => orderInColumn(a) - orderInColumn(b) || String(a.phase).localeCompare(String(b.phase), LOCALE, { numeric: true }) || toMillis(a.startAt) - toMillis(b.startAt)).map((g) => gameBox(g, teams, href)).join("")}
      </div>
    </div>`).join("");

  // 3) posiciones finales
  const places = [...finalPlaces(teams, games).entries()].sort((a, b) => a[1] - b[1]).filter(([, p]) => !sec || sec.exact || (p >= sec.from && p <= sec.to));
  const placesCol = places.length ? `
    <div class="bk-col">
      <div class="bk-col__title">${esc(EX.bkResults)}</div>
      <div class="bk-group">
        ${places.map(([id, place]) => {
          const t = byId.get(id) || { id, name: "—" };
          return `
            <div class="bk-row ${place === 1 ? "is-winner" : ""}">
              <span class="bk-rank">${place}</span>
              ${teamBadge(t, 20)}
              <span class="bk-row__name">${esc(t.name)}</span>
              ${place === 1 ? `<i class="bi bi-trophy-fill bk-trophy"></i>` : ""}
            </div>`;
        }).join("")}
      </div>
    </div>` : "";

  return `${chips}<div class="bk-scroll"><div class="bk-board">${groupCol}${roundCols}${sec?.exact ? "" : placesCol}</div></div>`;
}

export const hasBracket = (games = []) => games.some(isBracketGame);
