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
import { esc, fmtDateRange, fmtDayOnly, fmtTimeOnly, fmtWhen, gameRowHtml, gameUrl, hideLoader, isGoogleUser, phaseLabel, playerLabel, regChip, renderNav, revealActiveTab, showLoader, teamBadge, toMillis, waitForUser, withLiveTeams } from "/torneos/js/ui.js";

const $ = (id) => document.getElementById(id);
const KEY = new URLSearchParams(location.search).get("e") || "";

const state = { event: null, rules: eventRules({}), teams: [], games: [], tab: location.hash.replace("#", "") || "overview", division: "", user: null, myRegs: [], gameFilter: "all", gameDay: "" };

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

/* ---------- Posiciones (tabla tipo transmisión deportiva) ---------- */
// Últimos resultados de un equipo (más reciente al final): "W" / "L" / "E"
function recentResults(teamId, games, n = 5) {
  return games
    .filter((g) => g.status === GAME_STATUS.FINAL && (g.teamA?.id === teamId || g.teamB?.id === teamId))
    .sort((a, b) => toMillis(a.startAt) - toMillis(b.startAt))
    .slice(-n)
    .map((g) => {
      const us = g.teamA?.id === teamId ? g.scoreA || 0 : g.scoreB || 0;
      const them = g.teamA?.id === teamId ? g.scoreB || 0 : g.scoreA || 0;
      return us > them ? "W" : us < them ? "L" : "E";
    });
}

const streakDots = (res) => `<span class="st-streak">${res.map((r) => `<i class="st-dot st-dot--${r}" title="${esc(r === "W" ? EX.resWin : r === "L" ? EX.resLoss : EX.resTie)}">${esc(r === "W" ? "G" : r === "L" ? "P" : "E")}</i>`).join("") || "<span class=\"ev-muted\">—</span>"}</span>`;

function standingsTab() {
  const teams = state.teams.filter(inDivision(state.division));
  const games = state.games.filter(inDivision(state.division)).filter((g) => !g.phase); // fase de grupos
  const pools = [...new Set(teams.map((t) => (t.pool || "").toUpperCase()))].sort();
  const divName = divisions().find((d) => d.id === state.division)?.name || divisions()[0]?.name || "";
  const table = (pool) => {
    const ts = teams.filter((t) => (t.pool || "").toUpperCase() === pool);
    const ids = new Set(ts.map((t) => t.id));
    const poolGames = games.filter((g) => ids.has(g.teamA?.id) && ids.has(g.teamB?.id));
    const rows = standings(ts, poolGames);
    const played = poolGames.filter((g) => g.status === GAME_STATUS.FINAL).length;
    return `
      <section class="st-card">
        <header class="st-card__head">
          <div>
            <div class="st-card__title">${esc(pool ? exf(EX.phasePool, { pool }) : divName || EX.tabStandings)}</div>
            <div class="st-card__sub">${esc(exf(EX.standGamesPlayed, { n: played, total: poolGames.length }))}</div>
          </div>
          <span class="st-live"><i class="bi bi-broadcast"></i> ${esc(EX.standUpdated)}</span>
        </header>
        <div class="table-responsive">
          <table class="st-table">
            <thead><tr>
              <th class="st-pos">#</th>
              <th class="st-team">${esc(EX.standTeam)}</th>
              <th class="num" title="${esc(EX.standPlayedLong)}">${esc(EX.standPlayed)}</th>
              <th class="num" title="${esc(EX.standWLong)}">${esc(EX.standW)}</th>
              <th class="num" title="${esc(EX.standLLong)}">${esc(EX.standL)}</th>
              <th class="num d-none d-md-table-cell" title="${esc(EX.standPctLong)}">${esc(EX.standPct)}</th>
              <th class="num d-none d-sm-table-cell" title="${esc(EX.standPFLong)}">${esc(EX.standPF)}</th>
              <th class="num d-none d-sm-table-cell" title="${esc(EX.standPALong)}">${esc(EX.standPA)}</th>
              <th class="num" title="${esc(EX.standDiffLong)}">${esc(EX.standDiff)}</th>
              <th class="d-none d-md-table-cell">${esc(EX.standStreak)}</th>
            </tr></thead>
            <tbody>${rows.map((r, i) => {
              const pct = r.played ? (r.w / r.played).toFixed(3).replace(/^0/, "") : ".000";
              return `
              <tr class="${i === 0 && r.played ? "is-leader" : ""}">
                <td class="st-pos"><span class="st-rank">${i + 1}</span></td>
                <td class="st-team">
                  <div class="d-flex align-items-center gap-2">
                    ${teamBadge(r.team, 30)}
                    <div class="min-w-0">
                      <div class="st-team__name">${esc(r.team.name)}</div>
                      ${r.team.city ? `<div class="st-team__sub d-none d-sm-block">${esc(r.team.city)}</div>` : ""}
                    </div>
                  </div>
                </td>
                <td class="num">${r.played}</td>
                <td class="num fw-bold">${r.w}</td>
                <td class="num">${r.l}</td>
                <td class="num d-none d-md-table-cell">${pct}</td>
                <td class="num d-none d-sm-table-cell">${r.pf}</td>
                <td class="num d-none d-sm-table-cell">${r.pa}</td>
                <td class="num"><span class="st-diff ${r.diff > 0 ? "is-pos" : r.diff < 0 ? "is-neg" : ""}">${r.diff > 0 ? "+" : ""}${r.diff}</span></td>
                <td class="d-none d-md-table-cell">${streakDots(recentResults(r.team.id, poolGames))}</td>
              </tr>`;
            }).join("")}
            </tbody>
          </table>
        </div>
      </section>`;
  };
  return `
    <div class="sb-toolbar">${divisionPicker()}</div>
    ${teams.length ? pools.map(table).join("") : `<div class="ev-card ev-muted">${esc(EX.noStats)}</div>`}
    ${teams.length ? `<div class="st-legend">${esc(EX.standLegend)}</div>` : ""}`;
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
      ${teams.map((t) => {
        // con equipo en ClubStudioHQ: abre su página (jugadores, torneos, resultados)
        const href = t.squadId ? `/torneos/club.html?s=${encodeURIComponent(t.squadId)}` : "";
        const tag = href ? "a" : "div";
        return `
        <div class="col-12 col-md-6">
          <${tag} class="ev-card ev-team-card h-100 ${href ? "is-link" : ""}" ${href ? `href="${esc(href)}"` : ""}>
            <div class="d-flex align-items-center gap-2">
              ${teamBadge(t, 40)}
              <div class="min-w-0 flex-grow-1">
                <div class="fw-bold text-truncate">${esc(t.name)}</div>
                <div class="small ev-muted">${esc([t.city, t.pool ? exf(EX.phasePool, { pool: t.pool }) : ""].filter(Boolean).join(" · "))}${t.city || t.pool ? " · " : ""}${esc(exf(EX.playersSummary, {
                  n: (t.players || []).length,
                  f: (t.players || []).filter((p) => p.gender === "F").length,
                  m: (t.players || []).filter((p) => p.gender === "M").length,
                }))}</div>
              </div>
              ${href ? `<i class="bi bi-chevron-right ev-muted"></i>` : ""}
            </div>
          </${tag}>
        </div>`;
      }).join("") || `<div class="col-12"><div class="ev-card ev-muted">${esc(EX.noTeams)}</div></div>`}
    </div>`;
}

/* ---------- Partidos (marcadores tipo transmisión deportiva) ---------- */
const dayKey = (v) => {
  const ms = toMillis(v);
  if (!ms) return "";
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

// Récord G-P de cada equipo (partidos finalizados)
function teamRecords(games) {
  const rec = new Map();
  const add = (id, k) => {
    const r = rec.get(id) || { w: 0, l: 0 };
    r[k] += 1;
    rec.set(id, r);
  };
  games.filter((g) => g.status === GAME_STATUS.FINAL).forEach((g) => {
    const a = g.scoreA || 0;
    const b = g.scoreB || 0;
    if (a > b) { add(g.teamA?.id, "w"); add(g.teamB?.id, "l"); }
    if (b > a) { add(g.teamB?.id, "w"); add(g.teamA?.id, "l"); }
  });
  return rec;
}

function scoreCard(game, records) {
  const g = withLiveTeams(game, state.teams);
  const live = g.status === GAME_STATUS.LIVE;
  const final = g.status === GAME_STATUS.FINAL;
  const started = live || final;
  const a = g.scoreA || 0;
  const b = g.scoreB || 0;
  const status = live
    ? `<span class="sb-pill sb-pill--live"><i></i>${esc(EX.gameLive)}</span>`
    : final
      ? `<span class="sb-pill sb-pill--final">${esc(EX.gameFinal)}</span>`
      : `<span class="sb-pill">${esc(fmtTimeOnly(g.startAt) || EX.vs)}</span>`;
  const team = (t, score, other) => {
    const r = records.get(t?.id);
    const cls = final ? (score > other ? "is-winner" : score < other ? "is-loser" : "") : "";
    return `
      <div class="sb-team ${cls}">
        ${teamBadge(t || {}, 36)}
        <div class="sb-team__info">
          <div class="sb-team__name">${esc(t?.name || "—")}</div>
          ${r ? `<div class="sb-team__rec">${r.w}-${r.l}</div>` : ""}
        </div>
        <div class="sb-team__score">${started ? score : ""}${final && score > other ? `<i class="bi bi-caret-left-fill sb-win-mark"></i>` : ""}</div>
      </div>`;
  };
  return `
    <a class="sb-card ${live ? "is-live" : ""}" href="${esc(gameUrl(state.event.id, g.id))}">
      <div class="sb-card__head">
        ${status}
        <span class="sb-card__meta">${esc([g.field, phaseLabel(g)].filter(Boolean).join(" · "))}</span>
      </div>
      ${team(g.teamA, a, b)}
      ${team(g.teamB, b, a)}
      <div class="sb-card__foot">${esc(live ? EX.sbFollow : final ? EX.sbRecap : EX.sbPreview)} <i class="bi bi-chevron-right"></i></div>
    </a>`;
}

function gamesTab() {
  const all = state.games.filter(inDivision(state.division));
  if (!all.length) return `<div class="sb-toolbar">${divisionPicker()}</div><div class="ev-card ev-muted">${esc(EX.noGames)}</div>`;
  const records = teamRecords(all);

  // días con partidos
  const days = [...new Set(all.map((g) => dayKey(g.startAt)).filter(Boolean))].sort();
  if (state.gameDay && !days.includes(state.gameDay)) state.gameDay = "";
  const byStatus = (s) => all.filter((g) => (s === "all" ? true : s === "upcoming" ? g.status === GAME_STATUS.SCHEDULED || !g.status : g.status === s));
  const filters = [
    ["all", EX.filterAll, all.length],
    [GAME_STATUS.LIVE, EX.filterLive, byStatus(GAME_STATUS.LIVE).length],
    ["upcoming", EX.filterUpcoming, byStatus("upcoming").length],
    [GAME_STATUS.FINAL, EX.filterFinal, byStatus(GAME_STATUS.FINAL).length],
  ];
  const games = byStatus(state.gameFilter)
    .filter((g) => !state.gameDay || dayKey(g.startAt) === state.gameDay)
    .sort((x, y) => toMillis(x.startAt) - toMillis(y.startAt));

  const grouped = new Map();
  games.forEach((g) => {
    const k = dayKey(g.startAt);
    if (!grouped.has(k)) grouped.set(k, []);
    grouped.get(k).push(g);
  });

  const dayLabel = (k) => {
    const sample = all.find((g) => dayKey(g.startAt) === k);
    return sample ? fmtWhen(sample.startAt, { weekday: "short", day: "numeric", month: "short" }) : EX.noSchedule;
  };

  return `
    <div class="sb-toolbar">
      ${divisionPicker()}
      <div class="sb-filters" role="tablist">
        ${filters.map(([id, label, n]) => `<button class="sb-filter ${state.gameFilter === id ? "is-active" : ""} ${id === GAME_STATUS.LIVE && n ? "has-live" : ""}" data-gfilter="${id}">${id === GAME_STATUS.LIVE && n ? "<i class=\"sb-live-dot\"></i>" : ""}${esc(label)} <span>${n}</span></button>`).join("")}
      </div>
    </div>
    ${days.length > 1 ? `
      <div class="sb-days">
        <button class="sb-day sb-day--all ${!state.gameDay ? "is-active" : ""}" data-gday="">${esc(EX.allDays)}</button>
        ${days.map((k) => `<button class="sb-day ${state.gameDay === k ? "is-active" : ""}" data-gday="${k}">${esc(dayLabel(k))}<span>${all.filter((g) => dayKey(g.startAt) === k).length}</span></button>`).join("")}
      </div>` : ""}
    ${games.length ? [...grouped.entries()].map(([k, list]) => `
      <div class="tn-day-title">${esc(k ? fmtDayOnly(list[0].startAt).replace(/^./, (c) => c.toUpperCase()) : EX.noSchedule)}</div>
      <div class="row g-3">${list.map((g) => `<div class="col-12 col-md-6 col-xl-4">${scoreCard(g, records)}</div>`).join("")}</div>`).join("")
      : `<div class="ev-card ev-muted text-center">${esc(EX.sbNoGamesFilter)}</div>`}`;
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
  revealActiveTab(document.querySelector(".ev-tabs"));
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
  const gf = ev.target.closest("[data-gfilter]");
  if (gf) {
    state.gameFilter = gf.dataset.gfilter;
    return render();
  }
  const gd = ev.target.closest("[data-gday]");
  if (gd) {
    state.gameDay = gd.dataset.gday;
    return render();
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
    let firstLoad = true;
    subscribeGames(event.id, (games) => {
      state.games = games;
      if (firstLoad) {
        firstLoad = false;
        const today = dayKey(Date.now());
        if (games.some((g) => dayKey(g.startAt) === today)) state.gameDay = today;
      }
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
