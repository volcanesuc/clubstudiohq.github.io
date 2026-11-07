// /tournaments/js/game_page.js
// Partido en vivo (público): marcador, reloj, jugadas, estadísticas por jugador y resumen por equipo.
import { EX, exf, withDivisionNames } from "/tournaments/js/strings.js";
import {
  GAME_STATUS,
  clockView,
  computeGameState,
  eventRules,
  feedPlays,
  mvpScore,
  findDivision,
  needsRatio,
  pointRatio,
  ratioLabel,
} from "/tournaments/js/model.js";
import { isPlatformAdmin, listTeams, loadEvent, subscribeGame, subscribePlays, updateGame } from "/tournaments/js/services.js";
import { askConfirm, esc, eventUrl, feedItemHtml, fmtWhen, hideLoader, isGoogleUser, isVideoUrl, phaseLabel, playerLabel, renderNav, showLoader, statusChip, teamBadge, videoEmbedUrl, waitForUser, possessionDot, downloadIcs, googleCalendarUrl, toMillis } from "/tournaments/js/ui.js";

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const EID = params.get("event") || "";
const GID = params.get("game") || "";

const state = { event: null, rules: eventRules({}), teams: [], game: null, plays: [], playersById: new Map(), canEdit: false, videoForm: false, videoMsg: "" };

// Video del partido: embebido si es YouTube / Vimeo / Drive; si no, un botón al link.
// El organizador del torneo (o un admin de la plataforma) lo agrega, cambia o quita.
function videoCard(g) {
  const url = g.videoUrl || "";
  if (!url && !state.canEdit) return "";
  const form = state.videoForm ? `
    <form class="mt-2" data-video-form>
      <div class="input-group">
        <input class="form-control" type="url" name="url" value="${esc(url)}" placeholder="${esc(EX.vidPlaceholder)}" required>
        <button class="btn btn-primary" type="submit">${esc(EX.vidSave)}</button>
        <button class="btn btn-outline-secondary" type="button" data-video-cancel>${esc(EX.vidCancel)}</button>
      </div>
      <div class="form-text">${esc(EX.vidHint)}</div>
    </form>` : "";
  const msg = state.videoMsg ? `<div class="small mt-2 ${state.videoMsg === EX.vidSaved ? "text-success" : "text-danger"}">${esc(state.videoMsg)}</div>` : "";
  if (!url) {
    return `<div class="ev-card mt-3">${state.videoForm ? `<h2 class="h6 mb-0">${esc(EX.vidAdd)}</h2>${form}` : `<button class="btn btn-sm btn-outline-primary" data-video-edit><i class="bi bi-camera-video me-1"></i>${esc(EX.vidAdd)}</button>`}${msg}</div>`;
  }
  const embed = videoEmbedUrl(url);
  const tools = state.canEdit && !state.videoForm ? `
    <div class="d-flex gap-1">
      <button class="btn btn-sm btn-outline-secondary" data-video-edit><i class="bi bi-pencil me-1"></i>${esc(EX.vidEdit)}</button>
      <button class="btn btn-sm btn-outline-danger" data-video-remove title="${esc(EX.vidRemove)}"><i class="bi bi-trash"></i><span class="visually-hidden">${esc(EX.vidRemove)}</span></button>
    </div>` : "";
  return `
    <div class="ev-card mt-3">
      <div class="d-flex justify-content-between align-items-center gap-2 flex-wrap mb-2">
        <h2 class="h6 mb-0"><i class="bi bi-camera-video-fill text-danger me-1"></i>${esc(EX.vidTitle)}</h2>
        ${tools}
      </div>
      ${embed ? `
        <div class="ratio ratio-16x9 rounded overflow-hidden bg-dark">
          <iframe src="${esc(embed)}" title="${esc(EX.vidTitle)}" loading="lazy" allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe>
        </div>
        <a class="small d-inline-block mt-2" href="${esc(url)}" target="_blank" rel="noopener">${esc(EX.vidOpen)} <i class="bi bi-box-arrow-up-right"></i></a>` : `
        <a class="btn btn-outline-primary" href="${esc(url)}" target="_blank" rel="noopener"><i class="bi bi-play-circle me-1"></i>${esc(EX.vidOpen)}</a>`}
      ${form}${msg}
    </div>`;
}

// mixto: proporción del punto en juego (FMP / MMP)
const ratioChip = (letter) => (letter ? `<div class="ev-chip ev-chip--ok mt-1">${esc(letter === "F" ? EX.skFmp : EX.skMmp)} · ${esc(ratioLabel(letter, state.rules.playersOnField))}</div>` : "");
const teamDoc = (side) => state.teams.find((t) => t.id === (side === "A" ? state.game?.teamA?.id : state.game?.teamB?.id));
// datos actuales del equipo (si lo renombraron o cambió de color después de crear el partido)
const teamName = (side) => teamDoc(side)?.name || (side === "A" ? state.game?.teamA?.name : state.game?.teamB?.name) || side;
const teamColor = (side) => teamDoc(side)?.color || (side === "A" ? state.game?.teamA?.color : state.game?.teamB?.color) || "#888";

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
  // partido importado solo con el marcador final (sin jugadas): se usa el marcador guardado
  const score = started && state.plays.length ? calc.score : { A: g.scoreA || 0, B: g.scoreB || 0 };
  document.title = `${teamName("A")} ${score.A}–${score.B} ${teamName("B")}`;

  const side = (k) => `
    <div class="ev-score__team">
      <div class="d-flex justify-content-center mb-1">${teamBadge({ ...(teamDoc(k) || {}), name: teamName(k), color: teamColor(k) }, 44)}</div>
      <div class="ev-score__name">${esc(teamName(k))}</div>
      <div class="ev-score__pts">${score[k]}</div>
      ${live ? `<div class="ev-score__disc">${possessionDot(14, calc.possession === k)}</div>` : ""}
    </div>`;
  const ctx = { playersById: state.playersById, teamName, teamColor };
  const feed = feedPlays(state.plays, state.rules).reverse();

  $("tnRoot").innerHTML = `
    <div class="d-flex justify-content-between align-items-center flex-wrap gap-2">
      <a class="small ev-muted text-decoration-none" href="${esc(eventUrl(state.event))}"><i class="bi bi-arrow-left"></i> ${esc(state.event.name || "")}</a>
      ${g.status === GAME_STATUS.SCHEDULED && toMillis(g.startAt) > Date.now() ? `
        <div class="dropdown">
          <button class="btn btn-sm btn-outline-primary dropdown-toggle" data-bs-toggle="dropdown"><i class="bi bi-calendar-plus me-1"></i>${esc(EX.icsGame)}</button>
          <ul class="dropdown-menu dropdown-menu-end">
            <li><a class="dropdown-item" target="_blank" rel="noopener" href="${esc(googleCalendarUrl(g, state.event))}"><i class="bi bi-google me-2"></i>${esc(EX.icsGoogle)}</a></li>
            <li><button class="dropdown-item" data-ics-game><i class="bi bi-calendar-event me-2"></i>${esc(EX.icsFile)}</button></li>
          </ul>
        </div>` : ""}
    </div>
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
        ${live && needsRatio(findDivision(state.event, g.divisionId), state.rules) ? ratioChip(pointRatio(state.rules, g, state.plays, calc.points.length)) : ""}
      </div>
      ${side("B")}
    </div>
    ${videoCard(g)}

    <div class="row g-3 mt-1">
      <div class="col-12 col-lg-5 order-lg-2">
        ${started ? teamSummary(calc) : ""}
      </div>
      <div class="col-12 col-lg-7">
        <h2 class="h6 mb-2">${esc(EX.skFeed)}</h2>
        <div class="ev-feed">${feed.length ? feed.map((p) => feedItemHtml(p, ctx, { audit: state.rules.auditLog })).join("") : `<div class="ev-card ev-muted small">${esc(started ? EX.noEventsYet : exf(EX.scheduledFor, { when: fmtWhen(g.startAt) || "—" }))}</div>`}</div>
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
    const user = await waitForUser();
    renderNav({ active: "dir", user });
    const [event, teams] = await Promise.all([loadEvent(EID), listTeams(EID)]);
    // quién puede agregar el video: organizador del torneo o admin de la plataforma
    if (event && isGoogleUser(user)) {
      const email = (user.email || "").toLowerCase();
      state.canEdit = (event.organizerUids || []).includes(user.uid) || (!!email && (event.organizerEmails || []).includes(email))
        || (await isPlatformAdmin(user.uid).catch(() => false));
    }
    if (!event || !GID) {
      $("tnAlert").className = "alert alert-warning";
      $("tnAlert").textContent = EX.eventNotFound;
        return;
    }
    state.event = withDivisionNames(event);
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

// partido › video: agregar, cambiar o quitar el link
document.addEventListener("click", async (ev) => {
  if (!state.canEdit || !state.game) return;
  if (ev.target.closest("[data-video-edit]")) {
    state.videoForm = true;
    state.videoMsg = "";
    render();
    document.querySelector("[data-video-form] input")?.focus();
  } else if (ev.target.closest("[data-video-cancel]")) {
    state.videoForm = false;
    state.videoMsg = "";
    render();
  } else if (ev.target.closest("[data-video-remove]")) {
    if (!(await askConfirm(EX.vidRemoveAsk, { ok: EX.vidRemove, danger: true }))) return;
    await saveVideo("");
  }
});
document.addEventListener("submit", async (ev) => {
  const form = ev.target.closest("[data-video-form]");
  if (!form) return;
  ev.preventDefault();
  const url = form.url.value.trim();
  if (!isVideoUrl(url)) {
    state.videoMsg = EX.vidInvalid;
    render();
    return;
  }
  await saveVideo(url);
});
async function saveVideo(url) {
  try {
    await updateGame(EID, GID, { videoUrl: url });
    state.videoForm = false;
    state.videoMsg = url ? EX.vidSaved : "";
  } catch (err) {
    console.error("[game_view] video", err);
    state.videoMsg = `${EX.error} ${err?.code || ""}`;
  }
  render();
}

// partido › agregar al calendario (.ics)
document.addEventListener("click", (ev) => {
  if (!ev.target.closest("[data-ics-game]") || !state.game) return;
  downloadIcs([state.game], state.event, "partido.ics");
});
