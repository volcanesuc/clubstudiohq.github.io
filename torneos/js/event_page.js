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
import { REG, listTeams, loadEvent, loadPublicEventBySlug, subscribeGames, withdrawRegistration } from "/torneos/js/services.js";
import { myRegistrationsFor } from "/torneos/js/squads.js";
import { esc, fmtDateRange, fmtDayOnly, gameRowHtml, gameUrl, hideLoader, isGoogleUser, playerLabel, regChip, renderNav, showLoader, teamBadge, toMillis, waitForUser } from "/torneos/js/ui.js";

const $ = (id) => document.getElementById(id);
const KEY = new URLSearchParams(location.search).get("e") || "";

const state = { event: null, rules: eventRules({}), teams: [], games: [], tab: location.hash.replace("#", "") || "overview", division: "", user: null, myRegs: [] };

// fila de partido con nombre, color y logo actuales del equipo
const row = (g) => gameRowHtml(g, { href: gameUrl(state.event.id, g.id), teams: state.teams });

// Consulta para el mapa: coordenadas o lugar del link de Google Maps; si no, sede + dirección
function mapQuery(e) {
  const url = e.mapsUrl || "";
  const at = url.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
  if (at) return `${at[1]},${at[2]}`;
  const q = url.match(/[?&](?:q|query|destination)=([^&]+)/);
  if (q) return decodeURIComponent(q[1].replace(/\+/g, " "));
  const place = url.match(/\/place\/([^/@?]+)/);
  if (place) return decodeURIComponent(place[1].replace(/\+/g, " "));
  return [e.venue, e.address].filter(Boolean).join(", ");
}

function venueCard() {
  const e = state.event;
  if (!e.mapsUrl && !e.address) return "";
  const q = mapQuery(e);
  return `
    <div class="ev-card mt-3">
      <div class="d-flex justify-content-between align-items-start gap-2 flex-wrap mb-2">
        <div>
          <div class="fw-bold"><i class="bi bi-geo-alt-fill text-danger me-1"></i>${esc(e.venue || EX.venueTitle)}</div>
          ${e.address ? `<div class="small ev-muted">${esc(e.address)}</div>` : ""}
        </div>
        ${e.mapsUrl ? `<a class="btn btn-sm btn-outline-primary" href="${esc(e.mapsUrl)}" target="_blank" rel="noopener"><i class="bi bi-map me-1"></i>${esc(EX.openMaps)}</a>` : ""}
      </div>
      ${q ? `<iframe class="tn-map" loading="lazy" referrerpolicy="no-referrer-when-downgrade" title="${esc(EX.venueTitle)}" src="https://maps.google.com/maps?q=${encodeURIComponent(q)}&z=15&output=embed"></iframe>` : ""}
    </div>`;
}

// Mis inscripciones en este torneo (si soy admin de un equipo) o el botón para inscribirme
function myRegistrationHtml() {
  const e = state.event;
  const items = state.myRegs.map(({ squad, reg }) => {
    const edit = `/torneos/equipo.html?${new URLSearchParams({ e: e.id, r: reg.id })}`;
    return `
      <div class="tn-my-reg">
        ${teamBadge(squad, 26)}<span class="fw-bold">${esc(squad.name)}</span>${regChip(reg.status)}
        <a class="btn btn-light btn-sm fw-bold" href="${esc(edit)}"><i class="bi bi-pencil me-1"></i>${esc(EX.regEditMine)}</a>
        ${reg.status !== REG.APPROVED ? `<button class="btn btn-outline-light btn-sm" data-withdraw="${esc(reg.id)}" data-squad="${esc(squad.id)}">${esc(EX.regWithdrawMine)}</button>` : ""}
      </div>`;
  }).join("");
  // "inscribir otro" solo si me queda algún equipo sin inscribir
  const register = e.registrationOpen && (!state.myRegs.length || state.myRegs.freeSquads > 0)
    ?`<a class="btn btn-light btn-sm fw-bold" href="/torneos/equipo.html?e=${encodeURIComponent(e.id)}"><i class="bi bi-person-plus me-1"></i>${esc(state.myRegs.length ? EX.registerAnother : EX.registerTeam)}</a>`
    : "";
  if (!items && !register) return "";
  return `<div class="d-flex flex-wrap gap-2 mt-3">${items}${register}</div>`;
}

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
  const list = (title, arr) => (arr.length ? `<h2 class="h6 mt-4 mb-2">${esc(title)}</h2><div class="d-grid gap-2">${arr.map(row).join("")}</div>` : "");
  return `
    ${state.event.description ? `<div class="ev-card mb-3" style="white-space:pre-line">${esc(state.event.description)}</div>` : ""}
    <div class="ev-stat-grid">
      ${tile(state.teams.length, EX.overviewTeams)}
      ${tile(players, EX.overviewPlayers)}
      ${tile(`${finals.length}/${games.length}`, EX.overviewGames)}
      ${tile(goals, EX.overviewGoals)}
    </div>
    ${venueCard()}
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
            <div class="d-flex align-items-center gap-2 mb-1">
              ${teamBadge(t, 40)}
              <div class="min-w-0">
                <div class="fw-bold text-truncate">${esc(t.name)}</div>
                <div class="small ev-muted">${esc([t.city, t.pool ? exf(EX.phasePool, { pool: t.pool }) : ""].filter(Boolean).join(" · "))}${t.city || t.pool ? " · " : ""}${esc(exf(EX.playersSummary, {
                  n: (t.players || []).length,
                  f: (t.players || []).filter((p) => p.gender === "F").length,
                  m: (t.players || []).filter((p) => p.gender === "M").length,
                }))}</div>
              </div>
            </div>
            <div class="small">${(t.players || []).map((p) => `<span class="text-nowrap">${p.uid ? `<a class="text-decoration-none" href="/torneos/perfil.html?u=${encodeURIComponent(p.uid)}">${esc(playerLabel(p))}</a>` : esc(playerLabel(p))}${p.id === t.captainId ? `<span class="tn-cap tn-cap--c" title="${esc(EX.captain)}">C</span>` : ""}${p.id === t.spiritCaptainId ? `<span class="tn-cap tn-cap--s" title="${esc(EX.spiritCaptain)}">E</span>` : ""}</span>`).join(" · ") || "—"}</div>
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
    ${day ? `<div class="tn-day-title">${esc(day.charAt(0).toUpperCase() + day.slice(1))}</div>` : ""}
    <div class="d-grid gap-2">${list.map(row).join("")}</div>`).join("");
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
    <section class="ev-hero mb-3 ${e.image ? "ev-hero--image" : ""}" ${e.image ? `style="background: linear-gradient(to top, rgba(20, 8, 45, .92) 0%, rgba(20, 8, 45, .35) 55%, rgba(20, 8, 45, .1) 100%), url('${esc(e.image)}')"` : ""}>
      <h1>${esc(e.name || "")}</h1>
      <div class="ev-hero__meta">
        ${e.startDate ? `<span><i class="bi bi-calendar-event"></i> ${esc(fmtDateRange(e.startDate, e.endDate))}</span>` : ""}
        ${e.venue ? `<span><i class="bi bi-geo-alt"></i> ${esc(e.venue)}</span>` : ""}
        ${e.mapsUrl ? `<a class="text-white" href="${esc(e.mapsUrl)}" target="_blank" rel="noopener"><i class="bi bi-map"></i></a>` : ""}
      </div>
      ${myRegistrationHtml()}
    </section>
    <ul class="nav nav-pills mb-3 ev-tabs">
      ${TABS.map(([id, label]) => `<li class="nav-item"><button class="nav-link ${tab[0] === id ? "active" : ""}" data-tab="${id}">${esc(label())}</button></li>`).join("")}
    </ul>
    <div id="evpTab">${tab[2]()}</div>`;
}

$("tnRoot").addEventListener("click", async (ev) => {
  const wd = ev.target.closest("[data-withdraw]");
  if (wd) {
    if (!confirm(EX.regWithdrawConfirm)) return;
    showLoader();
    try {
      await withdrawRegistration(state.event.id, wd.dataset.withdraw, wd.dataset.squad);
      state.myRegs = state.myRegs.filter((x) => x.reg.id !== wd.dataset.withdraw);
      render();
    } catch (err) {
      console.error(err);
      alert(EX.error);
    } finally {
      hideLoader();
    }
    return;
  }
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
    const user = await waitForUser();
    state.user = isGoogleUser(user) ? user : null;
    renderNav({ active: "dir", user });
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
    // estado de mi inscripción (no bloquea la página)
    if (state.user) {
      myRegistrationsFor(state.user, event.id).then((regs) => {
        state.myRegs = regs;
        if (regs.length) render();
      }).catch(() => {});
    }
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
