// /torneos/js/event_page.js
// Página pública de un evento (?e=slug): resumen, posiciones, estadísticas (MVP y líderes), equipos,
// partidos y espíritu. Los partidos se actualizan en vivo.
import { EX, exf } from "/torneos/js/strings.js";
import {
  GAME_STATUS,
  SPIRIT_KEYS,
  eventRules,
  leaders,
  playerTotals,
  spiritTable,
  standings,
} from "/torneos/js/model.js";
import { listTeams, loadEvent, loadPublicEventBySlug, subscribeGames } from "/torneos/js/services.js";
import { esc, fmtDateRange, fmtDayOnly, gameRowHtml, gameUrl, hideLoader, playerLabel, renderNav, showLoader, toMillis, waitForUser } from "/torneos/js/ui.js";

const $ = (id) => document.getElementById(id);
const KEY = new URLSearchParams(location.search).get("e") || "";

const state = { event: null, rules: eventRules({}), teams: [], games: [], tab: location.hash.replace("#", "") || "overview", division: "" };

const divisions = () => (state.event.divisions?.length ? state.event.divisions : [{ id: "", name: "" }]);
const inDivision = (divId) => (x) => !state.division || (x.divisionId || divisions()[0].id) === divId;

/* =========================
   Pestañas
========================= */
function overview() {
  const games = state.games;
  const finals = games.filter((g) => g.status === GAME_STATUS.FINAL);
  const live = games.filter((g) => g.status === GAME_STATUS.LIVE);
  const upcoming = games.filter((g) => g.status === GAME_STATUS.SCHEDULED).slice(0, 6);
  const players = state.teams.reduce((n, t) => n + (t.players || []).length, 0);
  const goals = finals.concat(live).reduce((n, g) => n + (g.scoreA || 0) + (g.scoreB || 0), 0);
  const tile = (v, l) => `<div class="ev-stat"><div class="ev-stat__value">${esc(v)}</div><div class="ev-stat__label">${esc(l)}</div></div>`;
  const list = (title, arr) => (arr.length ? `<h2 class="h6 mt-4 mb-2">${esc(title)}</h2><div class="d-grid gap-2">${arr.map((g) => gameRowHtml(g, { href: gameUrl(state.event.id, g.id) })).join("")}</div>` : "");
  return `
    ${state.event.description ? `<div class="ev-card mb-3" style="white-space:pre-line">${esc(state.event.description)}</div>` : ""}
    <div class="ev-stat-grid">
      ${tile(state.teams.length, EX.overviewTeams)}
      ${tile(players, EX.overviewPlayers)}
      ${tile(`${finals.length}/${games.length}`, EX.overviewGames)}
      ${tile(goals, EX.overviewGoals)}
    </div>
    ${list(EX.liveNow, live)}
    ${list(EX.upcoming, upcoming)}
    ${list(EX.results, finals.slice().reverse().slice(0, 6))}`;
}

function divisionPicker() {
  if (divisions().length < 2) return "";
  return `
    <div class="mb-3">
      <select class="form-select form-select-sm w-auto" id="evpDivision">
        ${divisions().map((d) => `<option value="${esc(d.id)}" ${d.id === state.division ? "selected" : ""}>${esc(d.name)}</option>`).join("")}
      </select>
    </div>`;
}

function standingsTab() {
  const teams = state.teams.filter(inDivision(state.division));
  const games = state.games.filter(inDivision(state.division)).filter((g) => !g.phase); // fase de grupos
  const pools = [...new Set(teams.map((t) => (t.pool || "").toUpperCase()))].sort();
  const table = (pool) => {
    const ts = teams.filter((t) => (t.pool || "").toUpperCase() === pool);
    const ids = new Set(ts.map((t) => t.id));
    const rows = standings(ts, games.filter((g) => ids.has(g.teamA?.id) && ids.has(g.teamB?.id)));
    return `
      <div class="ev-card p-0 overflow-hidden mb-3">
        ${pool ? `<div class="px-3 pt-3 fw-bold">${esc(exf(EX.phasePool, { pool }))}</div>` : ""}
        <div class="table-responsive">
          <table class="table table-sm mb-0 ev-table">
            <thead><tr><th class="ps-3">#</th><th>${esc(EX.standTeam)}</th><th class="num">${esc(EX.standPlayed)}</th><th class="num">${esc(EX.standW)}</th><th class="num">${esc(EX.standL)}</th><th class="num">${esc(EX.standPF)}</th><th class="num">${esc(EX.standPA)}</th><th class="num pe-3">${esc(EX.standDiff)}</th></tr></thead>
            <tbody>${rows.map((r, i) => `
              <tr><td class="ps-3 fw-bold">${i + 1}</td><td><span class="ev-team-dot" style="background:${esc(r.team.color || "#ccc")}"></span> ${esc(r.team.name)}</td>
              <td class="num">${r.played}</td><td class="num fw-bold">${r.w}</td><td class="num">${r.l}</td><td class="num">${r.pf}</td><td class="num">${r.pa}</td><td class="num pe-3">${r.diff > 0 ? "+" : ""}${r.diff}</td></tr>`).join("")}
            </tbody>
          </table>
        </div>
      </div>`;
  };
  return divisionPicker() + (teams.length ? pools.map(table).join("") : `<div class="ev-card ev-muted">${esc(EX.noStats)}</div>`);
}

function statsTab() {
  const teams = state.teams.filter(inDivision(state.division));
  const teamIds = new Set(teams.map((t) => t.id));
  const games = state.games.filter((g) => g.status !== GAME_STATUS.SCHEDULED && (teamIds.has(g.teamA?.id) || teamIds.has(g.teamB?.id)));
  const totals = playerTotals(games, teams, state.rules).filter((p) => p.teamId && teamIds.has(p.teamId));
  if (!totals.length) return divisionPicker() + `<div class="ev-card ev-muted">${esc(EX.noStats)}</div>`;
  const card = (title, key) => {
    const rows = leaders(totals, key, 10);
    return `
      <div class="col-12 col-md-6 col-lg-4">
        <div class="ev-leader-card h-100">
          <h3>${esc(title)}</h3>
          ${rows.map((p, i) => `
            <div class="ev-leader-row">
              <div class="ev-leader-row__pos">${i + 1}</div>
              <div class="min-w-0"><div class="fw-semibold text-truncate">${esc(playerLabel(p))}</div><div class="small ev-muted text-truncate">${esc(p.teamName || "")}</div></div>
              <div class="ev-leader-row__val">${p[key]}</div>
            </div>`).join("") || `<div class="small ev-muted">—</div>`}
        </div>
      </div>`;
  };
  return `
    ${divisionPicker()}
    <div class="row g-3">
      ${card(EX.leaderMvp, "mvp")}
      ${card(EX.leaderGoals, "goals")}
      ${card(EX.leaderAssists, "assists")}
      ${card(EX.leaderBlocks, "blocks")}
      ${card(EX.leaderTurns, "turns")}
    </div>
    <div class="small ev-muted mt-2">${esc(EX.mvpHint)}</div>`;
}

function teamsTab() {
  const teams = state.teams.filter(inDivision(state.division));
  return `
    ${divisionPicker()}
    <div class="row g-3">
      ${teams.map((t) => `
        <div class="col-12 col-md-6">
          <div class="ev-card h-100">
            <div class="fw-bold"><span class="ev-team-dot" style="background:${esc(t.color || "#ccc")}"></span> ${esc(t.name)}</div>
            <div class="small ev-muted mb-2">${esc([t.city, t.pool ? exf(EX.phasePool, { pool: t.pool }) : ""].filter(Boolean).join(" · "))} · ${esc(exf(EX.playersCount, { n: (t.players || []).length }))}</div>
            <div class="small">${(t.players || []).map((p) => esc(playerLabel(p))).join(" · ") || "—"}</div>
          </div>
        </div>`).join("") || `<div class="col-12"><div class="ev-card ev-muted">${esc(EX.noTeams)}</div></div>`}
    </div>`;
}

function gamesTab() {
  const games = state.games.filter(inDivision(state.division));
  if (!games.length) return divisionPicker() + `<div class="ev-card ev-muted">${esc(EX.noGames)}</div>`;
  const byDay = new Map();
  games.forEach((g) => {
    const day = toMillis(g.startAt) ? fmtDayOnly(g.startAt) : "";
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day).push(g);
  });
  return divisionPicker() + [...byDay.entries()].map(([day, list]) => `
    ${day ? `<h2 class="h6 mt-3 mb-2">${esc(day.charAt(0).toUpperCase() + day.slice(1))}</h2>` : ""}
    <div class="d-grid gap-2">${list.map((g) => gameRowHtml(g, { href: gameUrl(state.event.id, g.id) })).join("")}</div>`).join("");
}

function spiritTab() {
  const teams = state.teams.filter(inDivision(state.division));
  const rows = spiritTable(teams, state.games).filter((r) => r.count > 0);
  if (!rows.length) return divisionPicker() + `<div class="ev-card ev-muted">${esc(EX.noStats)}</div>`;
  const short = { rules: "R", fouls: "F", fair: "I", attitude: "A", comm: "C" };
  const titles = { rules: EX.spiritRules, fouls: EX.spiritFouls, fair: EX.spiritFair, attitude: EX.spiritAttitude, comm: EX.spiritComm };
  return `
    ${divisionPicker()}
    <div class="ev-card p-0 overflow-hidden">
      <div class="table-responsive">
        <table class="table table-sm mb-0 ev-table">
          <thead><tr><th class="ps-3">#</th><th>${esc(EX.standTeam)}</th><th class="num">${esc(EX.spiritAvg)}</th>
            ${SPIRIT_KEYS.map((k) => `<th class="num" title="${esc(titles[k])}">${short[k]}</th>`).join("")}
            <th class="num pe-3">${esc(EX.spiritCount)}</th></tr></thead>
          <tbody>${rows.map((r, i) => `
            <tr><td class="ps-3 fw-bold">${i + 1}</td><td>${esc(r.team.name)}</td><td class="num fw-bold">${r.avg.toFixed(1)}</td>
            ${SPIRIT_KEYS.map((k) => `<td class="num">${r.catAvg[k].toFixed(1)}</td>`).join("")}
            <td class="num pe-3">${r.count}</td></tr>`).join("")}
          </tbody>
        </table>
      </div>
    </div>
    <div class="small ev-muted mt-2">${SPIRIT_KEYS.map((k) => `${short[k]}: ${esc(titles[k])}`).join(" · ")}</div>`;
}

/* =========================
   Render
========================= */
const TABS = [
  ["overview", () => EX.tabOverview, overview],
  ["standings", () => EX.tabStandings, standingsTab],
  ["stats", () => EX.tabStats, statsTab],
  ["games", () => EX.tabGamesPublic, gamesTab],
  ["teams", () => EX.tabTeamsPublic, teamsTab],
  ["spirit", () => EX.tabSpirit, spiritTab],
];

function render() {
  const e = state.event;
  const tab = TABS.find((t) => t[0] === state.tab) || TABS[0];
  document.title = e.name || EX.appTitle;
  $("tnRoot").innerHTML = `
    <section class="ev-hero mb-3">
      <h1>${esc(e.name || "")}</h1>
      <div class="ev-hero__meta">
        ${e.startDate ? `<span><i class="bi bi-calendar-event"></i> ${esc(fmtDateRange(e.startDate, e.endDate))}</span>` : ""}
        ${e.venue ? `<span><i class="bi bi-geo-alt"></i> ${esc(e.venue)}</span>` : ""}
        ${e.mapsUrl ? `<a class="text-white" href="${esc(e.mapsUrl)}" target="_blank" rel="noopener"><i class="bi bi-map"></i></a>` : ""}
      </div>
    </section>
    <ul class="nav nav-pills mb-3 ev-tabs">
      ${TABS.map(([id, label]) => `<li class="nav-item"><button class="nav-link ${tab[0] === id ? "active" : ""}" data-tab="${id}">${esc(label())}</button></li>`).join("")}
    </ul>
    <div id="evpTab">${tab[2]()}</div>`;
}

$("tnRoot").addEventListener("click", (ev) => {
  const btn = ev.target.closest("[data-tab]");
  if (!btn) return;
  state.tab = btn.dataset.tab;
  history.replaceState(null, "", `#${state.tab}`);
  render();
});

$("tnRoot").addEventListener("change", (ev) => {
  if (ev.target.id !== "evpDivision") return;
  state.division = ev.target.value;
  render();
});

(async function init() {
  showLoader();
  try {
    renderNav({ active: "dir", user: await waitForUser() });
    // público por link; el organizador también puede verlo antes de publicarlo (por id)
    const event = (await loadPublicEventBySlug(KEY).catch(() => null)) || (await loadEvent(KEY).catch(() => null));
    if (!event) {
      $("tnAlert").className = "alert alert-warning";
      $("tnAlert").textContent = EX.eventNotFound;
      return;
    }
    state.event = event;
    state.rules = eventRules(event);
    state.division = divisions().length > 1 ? divisions()[0].id : "";
    state.teams = await listTeams(event.id);
    render();
    subscribeGames(event.id, (games) => {
      state.games = games;
      render();
    });
  } catch (err) {
    console.error("[event_view]", err);
    $("tnAlert").className = "alert alert-warning";
      $("tnAlert").textContent = EX.error;
  } finally {
    hideLoader();
  }
})();
