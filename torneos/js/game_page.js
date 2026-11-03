// /torneos/js/game_page.js
// Partido en vivo (público): marcador, reloj, jugadas, estadísticas por jugador y resumen por equipo.
import { EX, exf } from "/torneos/js/strings.js";
import {
  GAME_STATUS,
  clockView,
  computeGameState,
  eventRules,
  mvpScore,
} from "/torneos/js/model.js";
import { listTeams, loadEvent, subscribeGame, subscribePlays } from "/torneos/js/services.js";
import { esc, eventUrl, feedItemHtml, fmtWhen, hideLoader, phaseLabel, playerLabel, renderNav, showLoader, statusChip, waitForUser } from "/torneos/js/ui.js";

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const EID = params.get("event") || "";
const GID = params.get("game") || "";

const state = { event: null, rules: eventRules({}), teams: [], game: null, plays: [], playersById: new Map() };

const teamName = (side) => (side === "A" ? state.game?.teamA?.name : state.game?.teamB?.name) || side;
const teamColor = (side) => (side === "A" ? state.game?.teamA?.color : state.game?.teamB?.color) || "#888";
const teamDoc = (side) => state.teams.find((t) => t.id === (side === "A" ? state.game?.teamA?.id : state.game?.teamB?.id));

function boxScore(side, calc) {
  const players = (teamDoc(side)?.players || [])
    .map((p) => ({ ...p, ...(calc.players[p.id] || {}) }))
    .map((p) => ({ ...p, mvp: mvpScore(p, state.rules) }))
    .filter((p) => (p.goals || 0) + (p.assists || 0) + (p.blocks || 0) + (p.turns || 0) > 0)
    .sort((a, b) => b.mvp - a.mvp || (b.goals || 0) - (a.goals || 0));
  return `
    <div class="ev-card p-0 overflow-hidden">
      <div class="px-3 pt-3 fw-bold"><span class="ev-team-dot" style="background:${esc(teamColor(side))}"></span> ${esc(teamName(side))}</div>
      <div class="table-responsive">
        <table class="table table-sm mb-0 ev-table">
          <thead><tr><th class="ps-3">${esc(EX.statPlayer)}</th><th class="num">${esc(EX.statGoals)}</th><th class="num">${esc(EX.statAssists)}</th><th class="num">${esc(EX.statBlocks)}</th><th class="num">${esc(EX.statTurns)}</th><th class="num pe-3">${esc(EX.statMvp)}</th></tr></thead>
          <tbody>
            ${players.length ? players.map((p) => `
              <tr><td class="ps-3">${esc(playerLabel(p))}</td><td class="num">${p.goals || 0}</td><td class="num">${p.assists || 0}</td><td class="num">${p.blocks || 0}</td><td class="num">${p.turns || 0}</td><td class="num pe-3 fw-bold">${p.mvp}</td></tr>`).join("")
              : `<tr><td colspan="6" class="ps-3 ev-muted small">${esc(EX.noEventsYet)}</td></tr>`}
          </tbody>
        </table>
      </div>
    </div>`;
}

function compareRow(label, a, b) {
  return `<div class="ev-compare__a">${esc(a)}</div><div class="ev-compare__label">${esc(label)}</div><div class="ev-compare__b">${esc(b)}</div>`;
}

function teamSummary(calc) {
  const t = calc.teams;
  const eff = (x) => (x.breakChances ? `${Math.round((x.breaks / x.breakChances) * 100)}%` : "—");
  const hold = (x) => (x.oPoints ? `${x.holds}/${x.oPoints}` : "—");
  return `
    <div class="ev-card">
      <h2 class="h6 mb-3">${esc(EX.teamSummary)}</h2>
      <div class="ev-compare">
        <div class="ev-compare__a fw-bold">${esc(teamName("A"))}</div><div></div><div class="ev-compare__b fw-bold">${esc(teamName("B"))}</div>
        ${compareRow(EX.turnovers, t.A.turns, t.B.turns)}
        ${compareRow(EX.evBlock, t.A.blocks, t.B.blocks)}
        ${compareRow(EX.holdRate, hold(t.A), hold(t.B))}
        ${compareRow(EX.breaks, `${t.A.breaks}/${t.A.breakChances}`, `${t.B.breaks}/${t.B.breakChances}`)}
        ${compareRow(EX.breakEfficiency, eff(t.A), eff(t.B))}
      </div>
    </div>`;
}

function render() {
  if (!state.game) return;
  const g = state.game;
  const calc = computeGameState(state.plays, g, state.rules);
  const live = g.status === GAME_STATUS.LIVE;
  const started = g.status !== GAME_STATUS.SCHEDULED && g.status;
  const score = started ? calc.score : { A: g.scoreA || 0, B: g.scoreB || 0 };
  document.title = `${teamName("A")} ${score.A}–${score.B} ${teamName("B")}`;

  const side = (k) => `
    <div class="ev-score__team">
      <div class="ev-score__name"><span class="ev-team-dot" style="background:${esc(teamColor(k))}"></span> ${esc(teamName(k))}</div>
      <div class="ev-score__pts">${score[k]}</div>
      ${live && calc.possession === k ? `<div class="ev-score__disc">🥏</div>` : ""}
    </div>`;
  const ctx = { playersById: state.playersById, teamName };
  const feed = [...calc.feed].reverse();

  $("tnRoot").innerHTML = `
    <a class="small ev-muted text-decoration-none" href="${esc(eventUrl(state.event))}"><i class="bi bi-arrow-left"></i> ${esc(state.event.name || "")}</a>
    <div class="d-flex justify-content-between align-items-center mt-1 mb-2 flex-wrap gap-2">
      <div class="small ev-muted">${esc([phaseLabel(g), g.field, fmtWhen(g.startAt)].filter(Boolean).join(" · "))}</div>
      ${statusChip(g.status)}
    </div>
    <div class="ev-score">
      ${side("A")}
      <div class="ev-score__mid">
        <div class="ev-score__clock" id="gvClock">${started ? clockView(g.clock || {}, state.rules).text : esc(fmtWhen(g.startAt, { hour: "2-digit", minute: "2-digit" }) || EX.vs)}</div>
        ${live && g.clock?.pausedAt && !g.clock?.break ? `<div class="ev-chip mt-1">${esc(EX.evPause)}</div>` : ""}
        ${live && g.clock?.break ? `<div class="ev-chip mt-1" id="gvBreak">${esc(g.clock.break.type === "halftime" ? EX.skBreakHalftime : exf(EX.skBreakTimeout, { team: teamName(g.clock.break.team) }))} · <span id="gvBreakClock">${clockView(g.clock, state.rules).brk?.text || ""}</span></div>` : ""}
      </div>
      ${side("B")}
    </div>

    <div class="row g-3 mt-1">
      <div class="col-12 col-lg-5 order-lg-2">
        ${started ? teamSummary(calc) : ""}
      </div>
      <div class="col-12 col-lg-7">
        <h2 class="h6 mb-2">${esc(EX.skFeed)}</h2>
        <div class="ev-feed">${feed.length ? feed.map((p) => feedItemHtml(p, ctx)).join("") : `<div class="ev-card ev-muted small">${esc(started ? EX.noEventsYet : exf(EX.scheduledFor, { when: fmtWhen(g.startAt) || "—" }))}</div>`}</div>
      </div>
    </div>

    ${started ? `
      <h2 class="h6 mt-4 mb-2">${esc(EX.boxScore)}</h2>
      <div class="row g-3">
        <div class="col-12 col-md-6">${boxScore("A", calc)}</div>
        <div class="col-12 col-md-6">${boxScore("B", calc)}</div>
      </div>` : ""}`;
}

setInterval(() => {
  if (state.game?.status !== GAME_STATUS.LIVE) return;
  const view = clockView(state.game.clock || {}, state.rules);
  const el = $("gvClock");
  if (el) el.textContent = view.text;
  const b = $("gvBreakClock");
  if (b && view.brk) b.textContent = view.brk.text;
}, 500);

(async function init() {
  showLoader();
  try {
    renderNav({ active: "dir", user: await waitForUser() });
    const [event, teams] = await Promise.all([loadEvent(EID), listTeams(EID)]);
    if (!event || !GID) {
      $("tnAlert").className = "alert alert-warning";
      $("tnAlert").textContent = EX.eventNotFound;
        return;
    }
    state.event = event;
    state.rules = eventRules(event);
    state.teams = teams;
    state.playersById = new Map(teams.flatMap((t) => (t.players || []).map((p) => [p.id, p])));

    subscribeGame(EID, GID, (game) => {
      state.game = game;
      render();
    });
    subscribePlays(EID, GID, (plays) => {
      state.plays = plays;
      render();
    });
  } catch (err) {
    console.error("[game_view]", err);
    $("tnAlert").className = "alert alert-warning";
      $("tnAlert").textContent = EX.error;
  } finally {
    hideLoader();
  }
})();
