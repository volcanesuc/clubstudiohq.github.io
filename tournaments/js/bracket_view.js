// /tournaments/js/bracket_view.js
// Vista "Llave" de un torneo: grupos → rondas de la llave → posiciones finales (en columnas, como un cuadro).
// Sirve para torneos armados acá (slots que se llenan solos) y para los importados (solo tienen la fase).

import { GAME_STATUS, standings } from "/tournaments/js/model.js";
import { EX, exf } from "/tournaments/js/strings.js";
import { esc, fmtTimeOnly, fmtWhen, teamBadge, toMillis, withLiveTeams } from "/tournaments/js/ui.js";

const isBracketGame = (g) => !!(g.phase || g.key);

// Partidos que definen puestos: "Final" = 1º-2º, "Tercer lugar" = 3º-4º, "Puesto 9-10"…
const PLACE_PHASES = [
  [/^Final$/i, 1],
  [/^Tercer lugar/i, 3],
  [/^Quinto lugar/i, 5],
  [/^S[ée]ptimo lugar/i, 7],
  [/^Puestos? (\d+)/i, null],
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

// Columna de cada partido de llave: [orden, título]
function columnOf(g) {
  const p = String(g.phase || "");
  if (/^Octavos/i.test(p)) return [20, EX.bkEighths];
  if (/^Cuartos/i.test(p)) return [30, EX.bkQuarters];
  if (/^Semifinal/i.test(p)) return [40, EX.bkSemis];
  if (placeOfPhase(p)) return [50, EX.bkFinals];
  // otras llaves (ej. "Ronda 1", "Ganadores · Ronda 2"): por ronda, antes de cuartos
  const base = p.replace(/\s*(\(\d+\)|\d+)$/, "").trim() || EX.bkRound;
  return [10 + Math.min(9, Number(g.round) || 0) / 10, base];
}

const orderInColumn = (g) => {
  const place = placeOfPhase(g.phase);
  return place ? place : 100;
};

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
      <div class="bk-game__head"><span class="text-truncate">${esc(game.phase || "")}</span><span>${when}</span></div>
      ${row(game.teamA, a, b)}
      ${row(game.teamB, b, a)}
    </a>`;
}

/**
 * @param {{ teams: object[], games: object[], href: (g) => string, title?: string }} p  equipos y partidos de UNA división
 */
export function bracketHtml({ teams, games, href, title = "" }) {
  const bracket = games.filter(isBracketGame);
  if (!bracket.length) return `<div class="ev-card ev-muted">${esc(EX.bkEmpty)}</div>`;
  const byId = new Map(teams.map((t) => [t.id, t]));

  // 1) grupos (o la tabla general si no hubo grupos)
  const stage = games.filter((g) => !isBracketGame(g));
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
                <span class="bk-row__rec">${r.w}-${r.l}</span>
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
  const roundCols = [...cols.values()].sort((a, b) => a.order - b.order).map((c) => `
    <div class="bk-col">
      <div class="bk-col__title">${esc(c.name)}</div>
      <div class="bk-col__games">
        ${c.games.slice().sort((a, b) => orderInColumn(a) - orderInColumn(b) || String(a.phase).localeCompare(String(b.phase), "es", { numeric: true }) || toMillis(a.startAt) - toMillis(b.startAt)).map((g) => gameBox(g, teams, href)).join("")}
      </div>
    </div>`).join("");

  // 3) posiciones finales
  const places = [...finalPlaces(teams, games).entries()].sort((a, b) => a[1] - b[1]);
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

  return `<div class="bk-scroll"><div class="bk-board">${groupCol}${roundCols}${placesCol}</div></div>`;
}

export const hasBracket = (games = []) => games.some(isBracketGame);
