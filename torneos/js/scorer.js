// /torneos/js/scorer.js
// Planillaje en vivo con link de planillero (?event=&game=&key=). Pensado para el teléfono en la cancha.
// Cada jugada se guarda como documento propio (funciona sin señal y se puede corregir/borrar);
// el marcador y las estadísticas del partido se recalculan desde las jugadas.
import { EX, exf } from "/torneos/js/strings.js";
import {
  AUDIT_PLAYS,
  GAME_STATUS,
  PLAY,
  SPIRIT_KEYS,
  clockView,
  computeGameState,
  endBreak,
  eventRules,
  feedPlays,
  findDivision,
  needsRatio,
  pointRatio,
  ratioChosenAtStart,
  ratioLabel,
  ratioPerPoint,
  startBreak,
  sortPlays,
  gameElapsedMs,
  gameSummary,
  other,
  spiritTotal,
} from "/torneos/js/model.js";
import { auth } from "/torneos/js/firebase.js";
import {
  addPlay,
  claimScorekeeper,
  isPlatformAdmin,
  listTeams,
  loadEvent,
  subscribeGame,
  subscribePlays,
  updateGame,
  updatePlay,
} from "/torneos/js/services.js";
import { possessionDot, esc, feedItemHtml, playerLabel } from "/torneos/js/ui.js";

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const EID = params.get("event") || "";
const GID = params.get("game") || "";
const KEY = params.get("key") || "";

const state = {
  event: null,
  rules: eventRules({}),
  teams: { A: null, B: null },
  playersById: new Map(),
  game: null,
  plays: [],
  calc: null,
  pickSide: "A",
  offenseChoice: "", // se elige antes de empezar (quién recibe el primer pull)
  ratioChoice: "", // mixto: "F" (FMP) o "M" (MMP) en el primer punto
  // organizador o admin de la plataforma (cuenta de Google) -> puede ajustar el reloj
  isOrganizer: false,
};

const byRole = () => (state.isOrganizer ? "organizer" : "scorekeeper");
const byInfo = () => ({ by: auth.currentUser?.uid || "", byRole: byRole() });

const picker = new bootstrap.Modal($("skPicker"));

/* =========================
   Helpers
========================= */
// datos actuales del equipo (si lo renombraron o cambió de color después de crear el partido)
const teamName = (side) => state.teams[side]?.name || (side === "A" ? state.game?.teamA?.name : state.game?.teamB?.name) || side;
const teamColor = (side) => state.teams[side]?.color || (side === "A" ? state.game?.teamA?.color : state.game?.teamB?.color) || "#888";
const mixedRatio = () => needsRatio(findDivision(state.event, state.game?.divisionId), state.rules);
// mixto y la regla pide elegir al iniciar (ABBA o por punto); con proporción fija no se pregunta
const ratioAtStart = () => mixedRatio() && ratioChosenAtStart(state.rules);
const ratioHint = () => (state.rules.ratioRule === "offense" ? EX.skFirstRatioHintOffense : EX.skFirstRatioHint);
const ratioText = (letter) => `${letter === "F" ? EX.skFmp : EX.skMmp} · ${ratioLabel(letter, state.rules.playersOnField)}`;
const roster = (side) => state.teams[side]?.players || [];
const elapsedSec = () => Math.floor(gameElapsedMs(state.game?.clock) / 1000);
const isLive = () => state.game?.status === GAME_STATUS.LIVE;
const isFinal = () => state.game?.status === GAME_STATUS.FINAL;

function showError(msg) {
  $("tnAlert").className = "alert alert-danger";
  $("tnAlert").textContent = msg;
  $("tnRoot").innerHTML = "";
}

function recompute() {
  state.calc = computeGameState(state.plays, state.game || {}, state.rules);
}

// Guarda en el partido el marcador y estadísticas que salen de las jugadas (si cambiaron).
let lastSummary = "";
function syncSummary() {
  if (!state.calc || !state.game) return;
  const summary = gameSummary(state.calc);
  const key = JSON.stringify(summary);
  if (key === lastSummary) return;
  lastSummary = key;
  updateGame(EID, GID, summary).catch((err) => console.warn("[score] resumen:", err?.code || err));
}

function record(play) {
  const t = elapsedSec();
  // marcador después de la jugada (para el feed)
  const extra = {};
  if (play.type === PLAY.GOAL) {
    const next = { ...state.calc.score };
    next[play.team] += 1;
    extra.scoreA = next.A;
    extra.scoreB = next.B;
  }
  const at = Date.now();
  const full = { ...play, ...extra, t, at, ...byInfo() };
  const id = addPlay(EID, GID, full);
  // pinta ya, sin esperar a Firestore
  state.plays = [...state.plays.filter((p) => p.id !== id), { id, ...full }];
  recompute();
  render();
  syncSummary();
}

/* =========================
   Selector de jugador
========================= */
function pickPlayer({ side, title, exclude = [], extra = [] }) {
  return new Promise((resolve) => {
    $("skPickerTitle").textContent = `${title} · ${teamName(side)}`;
    const players = roster(side).filter((p) => !exclude.includes(p.id));
    $("skPickerList").innerHTML = [
      ...players.map((p) => `<button type="button" class="sk-player" data-pid="${esc(p.id)}">${p.number !== null && p.number !== undefined && p.number !== "" ? `#${esc(p.number)}` : ""}<small>${esc(p.name)}</small></button>`),
      ...extra.map((x) => `<button type="button" class="sk-player sk-player--other" data-pid="${esc(x.value)}">${esc(x.label)}</button>`),
    ].join("");
    let chosen = null;
    $("skPickerList").onclick = (ev) => {
      const btn = ev.target.closest("[data-pid]");
      if (!btn) return;
      chosen = btn.dataset.pid;
      picker.hide();
    };
    // se resuelve cuando el modal terminó de cerrarse: así el siguiente selector abre bien
    $("skPicker").addEventListener("hidden.bs.modal", () => resolve(chosen), { once: true });
    picker.show();
  });
}

async function onGoal(side) {
  const scorerId = await pickPlayer({ side, title: EX.skPickScorer, extra: [{ value: "__none", label: EX.skUnknownPlayer }] });
  if (scorerId === null) return;
  const scorer = scorerId === "__none" ? "" : scorerId;
  // si el que anota estaba en defensa sin el disco, puede ser Callahan
  const assist = await pickPlayer({
    side,
    title: EX.skPickAssist,
    exclude: scorer ? [scorer] : [],
    extra: [{ value: "__none", label: EX.skNoAssist }, { value: "__callahan", label: EX.skCallahan }],
  });
  if (assist === null) return;
  record({
    type: PLAY.GOAL,
    team: side,
    scorerId: scorer,
    assistId: assist.startsWith("__") ? "" : assist,
    callahan: assist === "__callahan",
  });
}

async function onTurn(side, type) {
  const pid = await pickPlayer({ side, title: type === PLAY.DROP ? EX.skDrop : EX.skThrowaway, extra: [{ value: "__none", label: EX.skUnknownPlayer }] });
  if (pid === null) return;
  record({ type, team: side, playerId: pid === "__none" ? "" : pid });
}

async function onBlock(side) {
  const pid = await pickPlayer({ side, title: EX.skBlock, extra: [{ value: "__none", label: EX.skUnknownPlayer }] });
  if (pid === null) return;
  record({ type: PLAY.BLOCK, team: side, playerId: pid === "__none" ? "" : pid });
}

function onTimeout(side) {
  if ((state.calc.timeoutsLeft[side] ?? 0) <= 0) return alert(EX.skNoTimeouts);
  record({ type: PLAY.TIMEOUT, team: side });
  beginBreak({ type: "timeout", team: side, seconds: state.rules.timeoutSeconds });
}

function onHalftime() {
  record({ type: PLAY.HALFTIME });
  beginBreak({ type: "halftime", seconds: state.rules.halftimeMinutes * 60 });
}

function beginBreak(opts) {
  const clock = state.game.clock || {};
  // si ya había un descanso, se cierra primero
  setClock(startBreak(clock.break ? endBreak(clock) : clock, opts, state.rules), { replace: true });
}

function finishBreak({ early = false } = {}) {
  const brk = state.game?.clock?.break;
  if (!brk) return;
  if (early) record({ type: PLAY.BREAK_END, breakType: brk.type, team: brk.team || "" });
  setClock(endBreak(state.game.clock), { replace: true });
}

// Solo organizadores: queda registrado en Jugadas
function adjustClock(deltaSec) {
  if (!state.isOrganizer) return;
  record({ type: PLAY.CLOCK_ADJUST, deltaSec });
  setClock({ offsetMs: (state.game.clock?.offsetMs || 0) + deltaSec * 1000 });
}

/* =========================
   Reloj / estado del partido
========================= */
async function startGame() {
  if (!state.offenseChoice) return alert(EX.skPickOffense);
  if (ratioAtStart() && !state.ratioChoice) return alert(EX.skPickRatio);
  const now = Date.now();
  const ratio = ratioAtStart() ? { ratioFirst: state.ratioChoice } : {};
  await updateGame(EID, GID, {
    status: GAME_STATUS.LIVE,
    offenseFirst: state.offenseChoice,
    ...ratio,
    startedAt: new Date(now),
    clock: { startedAt: now, pausedMs: 0, pausedAt: null, offsetMs: 0 },
  });
  state.game = { ...state.game, status: GAME_STATUS.LIVE, offenseFirst: state.offenseChoice, ...ratio, clock: { startedAt: now, pausedMs: 0, pausedAt: null, offsetMs: 0 } };
  record({ type: PLAY.START, team: state.offenseChoice });
}

function setClock(patch, { replace = false } = {}) {
  const clock = replace ? patch : { ...(state.game.clock || {}), ...patch };
  state.game.clock = clock;
  updateGame(EID, GID, { clock }).catch((err) => console.warn("[score] reloj:", err?.code || err));
  render();
}

function togglePause() {
  const c = state.game.clock || {};
  if (c.pausedAt) {
    setClock({ pausedMs: (c.pausedMs || 0) + (Date.now() - c.pausedAt), pausedAt: null });
    record({ type: PLAY.RESUME });
  } else {
    record({ type: PLAY.PAUSE });
    setClock({ pausedAt: Date.now() });
  }
}

function undoLast() {
  const last = sortPlays(state.plays.filter((p) => !p.deleted && p.type !== PLAY.START && !AUDIT_PLAYS.includes(p.type))).pop();
  if (last) removePlay(last.id);
}

function removePlay(id) {
  const play = state.plays.find((p) => p.id === id);
  if (play && (play.type === PLAY.TIMEOUT || play.type === PLAY.HALFTIME)) finishBreak();
  const voided = { deleted: true, deletedAt: elapsedSec(), deletedBy: auth.currentUser?.uid || "", deletedByRole: byRole() };
  updatePlay(EID, GID, id, voided);
  state.plays = state.plays.map((p) => (p.id === id ? { ...p, ...voided } : p));
  recompute();
  render();
  syncSummary();
}

async function finishGame() {
  if (!confirm(exf(EX.skFinishConfirm, { a: state.calc.score.A, b: state.calc.score.B }))) return;
  record({ type: PLAY.END });
  const clock = { ...endBreak(state.game.clock || {}), endedAt: Date.now() };
  await updateGame(EID, GID, { status: GAME_STATUS.FINAL, finishedAt: new Date(), clock });
  state.game = { ...state.game, status: GAME_STATUS.FINAL, clock };
  render();
}

async function reopenGame() {
  state.plays.filter((p) => p.type === PLAY.END && !p.deleted).forEach((p) => removePlay(p.id));
  record({ type: PLAY.REOPEN });
  const clock = { ...(state.game.clock || {}), endedAt: null };
  await updateGame(EID, GID, { status: GAME_STATUS.LIVE, clock });
  state.game = { ...state.game, status: GAME_STATUS.LIVE, clock };
  render();
}

/* =========================
   Render
========================= */
function scoreHeader() {
  const s = state.calc.score;
  const off = state.calc.possession;
  const clock = state.game.clock || {};
  const view = clockView(clock, state.rules);
  const elapsed = view.elapsedMs;
  const r = state.rules;
  const caps = [];
  if (r.softCapMin && elapsed >= r.softCapMin * 60000) caps.push(EX.skCapSoft);
  if (r.hardCapMin && elapsed >= r.hardCapMin * 60000) caps.push(EX.skCapHard);
  if (view.timeUp) caps.push(EX.skTimeUp);
  const side = (k) => `
    <div class="ev-score__team">
      <div class="ev-score__name"><span class="ev-team-dot" style="background:${esc(teamColor(k))}"></span> ${esc(teamName(k))}</div>
      <div class="ev-score__pts">${s[k]}</div>
      <div class="small opacity-75">${esc(exf(EX.skTimeoutsLeft, { n: state.calc.timeoutsLeft[k] }))}</div>
      ${isLive() ? `<div class="ev-score__disc" title="${esc(off === k ? EX.skOffense : EX.skNoDisc)}">${possessionDot(14, off === k)}</div>` : ""}
    </div>`;
  return `
    <div class="ev-score">
      ${side("A")}
      <div class="ev-score__mid">
        <div class="ev-score__clock" id="skClock">${view.text}</div>
        ${clock.pausedAt && !clock.break ? `<div class="ev-chip mt-1">${esc(EX.evPause)}</div>` : ""}
        ${caps.map((c) => `<div class="ev-chip mt-1 ${c === EX.skTimeUp || c === EX.skCapHard ? "ev-chip--alert" : ""}">${esc(c)}</div>`).join("")}
        ${isFinal() ? `<div class="ev-chip ev-chip--final mt-1">${esc(EX.gameFinal)}</div>` : ""}
      </div>
      ${side("B")}
    </div>`;
}

function renderPreGame() {
  const mixed = ratioAtStart();
  const ready = !!state.offenseChoice && (!mixed || !!state.ratioChoice);
  return `
    ${scoreHeader()}
    <div class="ev-card mt-3">
      <div class="fw-bold">${esc(EX.skWhoStarts)}</div>
      <div class="small ev-muted mb-2">${esc(EX.skWhoStartsHint)}</div>
      <div class="sk-choice mb-3">
        ${["A", "B"].map((k) => `<button type="button" class="btn ${state.offenseChoice === k ? "btn-primary" : "btn-outline-primary"}" data-offense="${k}"><span class="ev-team-dot me-1" style="background:${esc(teamColor(k))}"></span>${esc(teamName(k))}</button>`).join("")}
      </div>
      ${mixed ? `
        <div class="fw-bold">⚥ ${esc(EX.skFirstRatio)}</div>
        <div class="small ev-muted mb-2">${esc(ratioHint())}</div>
        <div class="sk-choice mb-3">
          ${["F", "M"].map((k) => `<button type="button" class="btn sk-ratio-btn ${state.ratioChoice === k ? "btn-primary" : "btn-outline-primary"}" data-ratio="${k}"><b>${esc(k === "F" ? EX.skFmp : EX.skMmp)}</b><small>${esc(ratioLabel(k, state.rules.playersOnField))}</small></button>`).join("")}
        </div>` : ""}
      <button class="btn btn-primary btn-lg w-100" id="skStart" ${ready ? "" : "disabled"}><i class="bi bi-play-fill me-1"></i>${esc(EX.skStart)}</button>
    </div>`;
}

// Punto en juego: número, proporción (mixto) y quién tiene el disco
function pointInfo() {
  const n = state.calc.points.length;
  const letter = mixedRatio() ? pointRatio(state.rules, state.game, state.plays, n) : "";
  // la ofensiva elige: se marca la proporción de cada punto
  const perPoint = mixedRatio() && ratioPerPoint(state.rules) && isLive();
  return `
    <div class="sk-point-info">
      <span class="ev-chip">${esc(exf(EX.skPointN, { n: n + 1 }))}</span>
      ${perPoint ? `
        <span class="sk-ratio-pick ${letter ? "" : "is-missing"}" title="${esc(EX.skPointRatio)}">
          ${letter ? "" : `<span class="small fw-semibold">${esc(EX.skPointRatioPick)}</span>`}
          ${["F", "M"].map((k) => `<button type="button" class="btn btn-sm ${letter === k ? "btn-success" : "btn-outline-secondary"}" data-point-ratio="${k}">${esc(ratioText(k))}</button>`).join("")}
        </span>`
      : letter ? `<span class="ev-chip ev-chip--ok">${esc(ratioText(letter))}</span>` : ""}
      <span class="ev-chip">${possessionDot(10, true)} ${esc(exf(EX.skDiscWith, { team: teamName(state.calc.possession) }))}</span>
    </div>`;
}

function sideButtons(k) {
  const off = state.calc.possession === k;
  return `
    <div class="sk-side">
      <div class="sk-side__title"><span class="ev-team-dot" style="background:${esc(teamColor(k))}"></span> ${esc(teamName(k))}</div>
      <button class="sk-btn sk-btn--goal" data-act="goal" data-side="${k}"><i class="bi bi-trophy"></i>${esc(EX.skGoal)}</button>
      <div class="d-grid gap-2" style="grid-template-columns:1fr 1fr">
        <button class="sk-btn sk-btn--turn" data-act="drop" data-side="${k}" ${off ? "" : "data-dim"}>${esc(EX.skDrop)}</button>
        <button class="sk-btn sk-btn--turn" data-act="throwaway" data-side="${k}" ${off ? "" : "data-dim"}>${esc(EX.skThrowaway)}</button>
      </div>
      <button class="sk-btn sk-btn--block" data-act="block" data-side="${k}" ${off ? "data-dim" : ""}><i class="bi bi-shield"></i>${esc(EX.skBlock)}</button>
      <button class="sk-btn sk-btn--to" data-act="timeout" data-side="${k}" ${state.calc.timeoutsLeft[k] > 0 ? "" : "disabled"}><i class="bi bi-stopwatch"></i>${esc(EX.skTimeout)} (${state.calc.timeoutsLeft[k]})</button>
    </div>`;
}

function breakBanner() {
  const view = clockView(state.game.clock || {}, state.rules);
  if (!view.brk) return "";
  const label = view.brk.type === "halftime" ? EX.skBreakHalftime : exf(EX.skBreakTimeout, { team: teamName(view.brk.team) });
  return `
    <div class="sk-break mt-2">
      <div>
        <div class="sk-break__label">${esc(label)}</div>
        ${state.game.clock?.break?.stopsClock ? `<div class="small opacity-75">${esc(EX.skClockStopped)}</div>` : ""}
        <div class="small fw-bold d-flex align-items-center gap-1">${possessionDot(10, true)} ${esc(exf(EX.skDiscWith, { team: teamName(state.calc.possession) }))}</div>
      </div>
      <div class="sk-break__time" id="skBreakClock">${view.brk.text}</div>
      <button class="btn btn-sm btn-light" data-act="break-end">${esc(EX.skBreakEnd)}</button>
    </div>`;
}

function renderLive() {
  const paused = !!state.game.clock?.pausedAt;
  const feed = feedPlays(state.plays, state.rules).reverse().slice(0, 60);
  const ctx = { playersById: state.playersById, teamName };
  return `
    ${scoreHeader()}
    ${pointInfo()}
    ${breakBanner()}
    ${state.calc.suggestHalftime && !state.game.clock?.break ? `<div class="sk-banner alert-info mt-2 d-flex justify-content-between align-items-center gap-2"><span>${esc(exf(EX.skHalftimeSuggest, { n: state.rules.halftimeAt }))}</span><button class="btn btn-sm btn-primary" data-act="halftime">${esc(EX.skHalftime)}</button></div>` : ""}
    <div class="sk-actions">${sideButtons("A")}${sideButtons("B")}</div>
    <div class="sk-bar">
      <button class="btn btn-outline-secondary" data-act="undo"><i class="bi bi-arrow-counterclockwise me-1"></i>${esc(EX.skUndo)}</button>
      <button class="btn btn-outline-secondary" data-act="pause" ${state.game.clock?.break ? "disabled" : ""}><i class="bi ${paused ? "bi-play" : "bi-pause"} me-1"></i>${esc(paused ? EX.skResume : EX.skPause)}</button>
      ${state.calc.halftimeDone ? "" : `<button class="btn btn-outline-secondary" data-act="halftime">${esc(EX.skHalftime)}</button>`}
      <button class="btn btn-outline-danger" data-act="finish"><i class="bi bi-flag me-1"></i>${esc(EX.skFinish)}</button>
    </div>
    ${state.isOrganizer ? `<details class="mt-2 small">
      <summary class="ev-muted">${esc(EX.skClockAdjust)}</summary>
      <div class="d-flex gap-2 mt-2">
        ${[-30, -1, 1, 30].map((s) => `<button class="btn btn-sm btn-light" data-clock="${s}">${s > 0 ? "+" : ""}${s}s</button>`).join("")}
      </div>
    </details>` : ""}
    <h2 class="h6 mt-3 mb-2">${esc(EX.skFeed)}</h2>
    <div class="ev-feed">
      ${feed.length ? feed.map((p) => feedItemHtml(p, ctx, {
        audit: state.rules.auditLog,
        actions: p.type === PLAY.START || AUDIT_PLAYS.includes(p.type) ? "" : `<button class="btn btn-sm btn-light text-danger" data-del-play="${esc(p.id)}" title="${esc(EX.delete)}"><i class="bi bi-x-lg"></i></button>`,
      })).join("") : `<div class="ev-muted small">${esc(EX.noEventsYet)}</div>`}
    </div>`;
}

function spiritForm(giver) {
  const receiver = other(giver);
  const card = state.game.spirit?.[giver] || {};
  const labels = { rules: EX.spiritRules, fouls: EX.spiritFouls, fair: EX.spiritFair, attitude: EX.spiritAttitude, comm: EX.spiritComm };
  return `
    <form class="ev-card" data-spirit="${giver}">
      <div class="fw-bold mb-1">${esc(exf(EX.spiritFrom, { team: teamName(giver), other: teamName(receiver) }))}</div>
      ${SPIRIT_KEYS.map((k) => `
        <div class="sk-spirit-row">
          <div class="small">${esc(labels[k])}</div>
          <div class="btn-group btn-group-sm" role="group">
            ${[0, 1, 2, 3, 4].map((n) => `
              <input type="radio" class="btn-check" name="${giver}-${k}" id="${giver}-${k}-${n}" value="${n}" ${Number(card[k] ?? 2) === n ? "checked" : ""} />
              <label class="btn btn-outline-primary" for="${giver}-${k}-${n}">${n}</label>`).join("")}
          </div>
        </div>`).join("")}
      <input class="form-control form-control-sm mt-2" name="comment" maxlength="300" placeholder="${esc(EX.spiritComment)}" value="${esc(card.comment || "")}" />
      <div class="d-flex justify-content-between align-items-center mt-2">
        <span class="small fw-bold" data-spirit-total>${esc(exf(EX.spiritTotal, { n: spiritTotal(card.rules !== undefined ? card : { rules: 2, fouls: 2, fair: 2, attitude: 2, comm: 2 }) }))}</span>
        <button class="btn btn-sm btn-primary" type="submit">${esc(card.rules !== undefined ? EX.saved : EX.spiritSave)}</button>
      </div>
    </form>`;
}

function renderFinal() {
  return `
    ${scoreHeader()}
    <div class="d-flex justify-content-end mt-2"><button class="btn btn-sm btn-outline-secondary" data-act="reopen">${esc(EX.skReopen)}</button></div>
    <h2 class="h5 mt-3 mb-1">${esc(EX.spiritTitle)}</h2>
    <div class="small ev-muted mb-2">${esc(EX.spiritHint)}</div>
    ${spiritForm("A")}
    ${spiritForm("B")}`;
}

let renderedMode = "";

function render() {
  if (!state.game || !state.calc) return;
  document.title = `${teamName("A")} ${state.calc.score.A}–${state.calc.score.B} ${teamName("B")} · ${EX.skTitle}`;
  const notStarted = state.game.status === GAME_STATUS.SCHEDULED || !state.game.status;
  const mode = notStarted ? "pre" : isFinal() ? "final" : "live";
  // en el final hay formularios de espíritu: no se repintan (se perdería lo que están marcando)
  if (mode === "final" && renderedMode === "final") {
    const header = $("tnRoot").querySelector(".ev-score");
    if (header) header.outerHTML = scoreHeader();
    return;
  }
  renderedMode = mode;
  $("tnRoot").innerHTML = mode === "pre" ? renderPreGame() : mode === "final" ? renderFinal() : renderLive();
}

/* =========================
   Eventos de la UI
========================= */
$("tnRoot").addEventListener("click", (ev) => {
  const off = ev.target.closest("[data-offense]");
  if (off) {
    state.offenseChoice = off.dataset.offense;
    return render();
  }
  const ratio = ev.target.closest("[data-ratio]");
  if (ratio) {
    state.ratioChoice = ratio.dataset.ratio;
    return render();
  }
  const pr = ev.target.closest("[data-point-ratio]");
  if (pr) {
    const n = state.calc.points.length;
    if (pointRatio(state.rules, state.game, state.plays, n) === pr.dataset.pointRatio) return;
    return record({ type: PLAY.RATIO, point: n, letter: pr.dataset.pointRatio });
  }
  if (ev.target.closest("#skStart")) return startGame().catch((err) => alert(`${EX.error} ${err?.code || ""}`));

  const del = ev.target.closest("[data-del-play]");
  if (del) return confirm(EX.confirmDelete) && removePlay(del.dataset.delPlay);

  const clockBtn = ev.target.closest("[data-clock]");
  if (clockBtn) return adjustClock(Number(clockBtn.dataset.clock));

  const btn = ev.target.closest("[data-act]");
  if (!btn) return;
  const side = btn.dataset.side;
  if (btn.hasAttribute("data-dim") && !confirm(exf(btn.dataset.act === "block" ? EX.skDimBlock : EX.skDimTurn, { team: teamName(side) }))) return;
  switch (btn.dataset.act) {
    case "goal": return onGoal(side);
    case "drop": return onTurn(side, PLAY.DROP);
    case "throwaway": return onTurn(side, PLAY.THROWAWAY);
    case "block": return onBlock(side);
    case "timeout": return onTimeout(side);
    case "halftime": return onHalftime();
    case "break-end": return finishBreak({ early: true });
    case "pause": return togglePause();
    case "undo": return undoLast();
    case "finish": return finishGame();
    case "reopen": return reopenGame();
    default:
  }
});

$("tnRoot").addEventListener("change", (ev) => {
  const form = ev.target.closest("[data-spirit]");
  if (!form) return;
  const card = readSpirit(form);
  form.querySelector("[data-spirit-total]").textContent = exf(EX.spiritTotal, { n: spiritTotal(card) });
});

$("tnRoot").addEventListener("submit", (ev) => {
  const form = ev.target.closest("[data-spirit]");
  if (!form) return;
  ev.preventDefault();
  const giver = form.dataset.spirit;
  const spirit = { ...(state.game.spirit || {}), [giver]: readSpirit(form) };
  state.game.spirit = spirit;
  updateGame(EID, GID, { spirit })
    .then(() => {
      form.querySelector("[type=submit]").textContent = EX.spiritSaved;
    })
    .catch((err) => alert(`${EX.error} ${err?.code || ""}`));
});

function readSpirit(form) {
  const card = {};
  SPIRIT_KEYS.forEach((k) => {
    card[k] = Number(form.querySelector(`input[name="${form.dataset.spirit}-${k}"]:checked`)?.value ?? 2);
  });
  card.comment = form.querySelector("[name=comment]").value.trim();
  return card;
}

// reloj en vivo
setInterval(() => {
  if (!state.game) return;
  const view = clockView(state.game.clock || {}, state.rules);
  const el = $("skClock");
  if (el) el.textContent = view.text;
  const brkEl = $("skBreakClock");
  if (brkEl && view.brk) brkEl.textContent = view.brk.text;
  // el descanso llegó a 0: se reanuda el reloj solo
  if (view.brk?.done && isLive()) finishBreak();
}, 500);

// sin señal
function updateOnline() {
  let el = $("skOffline");
  if (!el) {
    el = document.createElement("div");
    el.id = "skOffline";
    el.className = "sk-banner alert-warning mb-2";
    $("tnRoot").before(el);
  }
  el.textContent = EX.skOffline;
  el.classList.toggle("d-none", navigator.onLine);
}
window.addEventListener("online", updateOnline);
window.addEventListener("offline", updateOnline);

/* =========================
   Inicio
========================= */
(async function init() {
  updateOnline();
  $("tnRoot").innerHTML = `<div class="text-center ev-muted py-5">${EX.loading}</div>`;
  if (!EID || !GID || !KEY) return showError(EX.skNoAccess);
  try {
    await claimScorekeeper(EID, GID, KEY);
  } catch (err) {
    console.warn("[score] link:", err?.code || err);
    return showError(EX.skNoAccess);
  }

  const [event, teams] = await Promise.all([loadEvent(EID), listTeams(EID)]);
  if (!event) return showError(EX.skNoAccess);
  state.event = event;
  state.rules = eventRules(event);
  const u = auth.currentUser;
  const email = (u?.email || "").toLowerCase();
  state.isOrganizer = !!u && !u.isAnonymous && (
    (event.organizerUids || []).includes(u.uid)
    || (!!email && (event.organizerEmails || []).includes(email))
    || (await isPlatformAdmin(u.uid))
  );

  subscribeGame(EID, GID, (game) => {
    if (!game) return showError(EX.skNoAccess);
    state.game = { ...game, clock: game.clock || state.game?.clock };
    state.teams.A = teams.find((t) => t.id === game.teamA?.id) || null;
    state.teams.B = teams.find((t) => t.id === game.teamB?.id) || null;
    state.playersById = new Map([...roster("A"), ...roster("B")].map((p) => [p.id, p]));
    if (!state.calc) recompute();
    render();
  });

  subscribePlays(EID, GID, (plays) => {
    // conserva las jugadas locales que todavía no llegaron
    const ids = new Set(plays.map((p) => p.id));
    state.plays = [...plays, ...state.plays.filter((p) => !ids.has(p.id))];
    recompute();
    render();
    if (isLive() || isFinal()) syncSummary();
  });
})();
