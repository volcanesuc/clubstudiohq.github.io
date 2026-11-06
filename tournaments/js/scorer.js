// /tournaments/js/scorer.js
// Planillaje en vivo con link de planillero (?event=&game=&key=). Pensado para el teléfono en la cancha.
// Cada jugada se guarda como documento propio (funciona sin señal y se puede corregir/borrar);
// el marcador y las estadísticas del partido se recalculan desde las jugadas.
import { EX, exf } from "/tournaments/js/strings.js";
import {
  AUDIT_PLAYS,
  GAME_STATUS,
  PLAY,
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
} from "/tournaments/js/model.js";
import { auth } from "/tournaments/js/firebase.js";
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
} from "/tournaments/js/services.js";
import { askConfirm, possessionDot, esc, feedItemHtml, playerLabel, showNotice, teamBadge, textOn } from "/tournaments/js/ui.js";

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
// equipo para el escudo (logo o letra con su color)
const teamObj = (side) => state.teams[side] || { id: side, name: teamName(side), color: teamColor(side) };
// colores del equipo para su columna: fondo y texto legible encima
const teamVars = (side) => `--tc:${esc(teamColor(side))};--tt:${textOn(teamColor(side))}`;
// Durante un timeout / medio tiempo, o con el marcador al objetivo, no se registran jugadas.
const onBreak = () => !!state.game?.clock?.break;
const gameOver = () => !!state.calc?.reachedGameTo;
const playsLocked = () => onBreak() || gameOver();

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
  if (playsLocked()) return;
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
  if (assist === null || playsLocked()) return;
  record({
    type: PLAY.GOAL,
    team: side,
    scorerId: scorer,
    assistId: assist.startsWith("__") ? "" : assist,
    callahan: assist === "__callahan",
  });
}

async function onTurn(side, type) {
  if (playsLocked()) return;
  const pid = await pickPlayer({ side, title: type === PLAY.DROP ? EX.skDrop : EX.skThrowaway, extra: [{ value: "__none", label: EX.skUnknownPlayer }] });
  if (pid === null) return;
  record({ type, team: side, playerId: pid === "__none" ? "" : pid });
}

async function onBlock(side) {
  if (playsLocked()) return;
  const pid = await pickPlayer({ side, title: EX.skBlock, extra: [{ value: "__none", label: EX.skUnknownPlayer }] });
  if (pid === null) return;
  record({ type: PLAY.BLOCK, team: side, playerId: pid === "__none" ? "" : pid });
}

function onTimeout(side) {
  if (playsLocked()) return;
  if ((state.calc.timeoutsLeft[side] ?? 0) <= 0) return showNotice(EX.skNoTimeouts);
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
  // partido de llave que todavía no tiene sus dos equipos (falta terminar el anterior)
  if (!state.game?.teamA?.id || !state.game?.teamB?.id) return showNotice(EX.skTeamsPending);
  if (!state.offenseChoice) return showNotice(EX.skPickOffense);
  if (ratioAtStart() && !state.ratioChoice) return showNotice(EX.skPickRatio);
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
  const ok = await askConfirm(exf(EX.skFinishConfirm, { a: state.calc.score.A, b: state.calc.score.B }), { ok: EX.skFinish, danger: true });
  if (!ok) return;
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
      <div class="sk-crest">${teamBadge(teamObj(k), 46)}</div>
      <div class="ev-score__name">${esc(teamName(k))}</div>
      <div class="ev-score__pts">${s[k]}</div>
      <div class="small opacity-75">${esc(exf(EX.skTimeoutsLeft, { n: state.calc.timeoutsLeft[k] }))}</div>
      ${isLive() ? `<div class="ev-score__disc" title="${esc(off === k ? EX.skOffense : EX.skNoDisc)}">${possessionDot(14, off === k)}</div>` : ""}
    </div>`;
  return `
    <div class="ev-score sk-score" style="--ca:${esc(teamColor("A"))};--cb:${esc(teamColor("B"))}">
      ${side("A")}
      <div class="ev-score__mid">
        <div class="ev-score__clock" id="skClock">${view.text}</div>
        ${isLive() ? pointMeta() : ""}
        ${clock.pausedAt && !clock.break ? `<div class="ev-chip mt-1">${esc(EX.evPause)}</div>` : ""}
        ${caps.map((c) => `<div class="ev-chip mt-1 ${c === EX.skTimeUp || c === EX.skCapHard ? "ev-chip--alert" : ""}">${esc(c)}</div>`).join("")}
        ${isFinal() ? `<div class="ev-chip ev-chip--final mt-1">${esc(EX.gameFinal)}</div>` : ""}
      </div>
      ${side("B")}
    </div>`;
}

// Antes de empezar: quién ataca primero (tarjetas con el escudo y color de cada equipo)
// y, en mixto, la proporción del primer punto.
function renderPreGame() {
  const mixed = ratioAtStart();
  const ready = !!state.offenseChoice && (!mixed || !!state.ratioChoice);
  const step = (n, title, hint, done) => `
    <div class="sk-step">
      <span class="sk-step__n ${done ? "is-done" : ""}">${done ? `<i class="bi bi-check-lg"></i>` : n}</span>
      <div class="min-w-0"><div class="sk-step__title">${esc(title)}</div><div class="sk-step__hint">${esc(hint)}</div></div>
    </div>`;
  const teamCard = (k) => {
    const on = state.offenseChoice === k;
    const off = !!state.offenseChoice && !on;
    return `
      <button type="button" class="sk-pick sk-pick--team ${on ? "is-on" : ""} ${off ? "is-off" : ""}" style="${teamVars(k)}" data-offense="${k}" aria-pressed="${on}">
        ${on ? `<span class="sk-pick__check"><i class="bi bi-check-lg"></i></span>` : ""}
        ${teamBadge(teamObj(k), 56)}
        <span class="sk-pick__name">${esc(teamName(k))}</span>
        <span class="sk-pick__tag">${on ? `${possessionDot(9, true)} ${esc(EX.skAttacksFirst)}` : esc(EX.skTapToPick)}</span>
      </button>`;
  };
  const ratioCard = (k) => {
    const on = state.ratioChoice === k;
    const off = !!state.ratioChoice && !on;
    return `
      <button type="button" class="sk-pick sk-pick--ratio sk-pick--${k} ${on ? "is-on" : ""} ${off ? "is-off" : ""}" data-ratio="${k}" aria-pressed="${on}">
        ${on ? `<span class="sk-pick__check"><i class="bi bi-check-lg"></i></span>` : ""}
        <span class="sk-pick__icon"><i class="bi ${k === "F" ? "bi-gender-female" : "bi-gender-male"}"></i></span>
        <span class="sk-pick__name">${esc(k === "F" ? EX.skFmp : EX.skMmp)}</span>
        <span class="sk-pick__tag">${esc(ratioLabel(k, state.rules.playersOnField))}</span>
      </button>`;
  };
  const missing = !state.offenseChoice ? EX.skPickStarter : mixed && !state.ratioChoice ? EX.skPickRatio : "";
  return `
    ${scoreHeader()}
    <div class="ev-card mt-3 sk-setup">
      ${step(1, EX.skWhoStarts, EX.skWhoStartsHint, !!state.offenseChoice)}
      <div class="sk-pick-grid">${teamCard("A")}${teamCard("B")}</div>
      ${mixed ? `
        ${step(2, EX.skFirstRatio, ratioHint(), !!state.ratioChoice)}
        <div class="sk-pick-grid">${ratioCard("F")}${ratioCard("M")}</div>` : ""}
      <button class="btn btn-primary btn-lg w-100 sk-start" id="skStart" ${ready ? "" : "disabled"}><i class="bi bi-play-fill me-1"></i>${esc(EX.skStart)}</button>
      ${missing ? `<div class="sk-start__hint">${esc(missing)}</div>` : ""}
    </div>`;
}

// Punto en juego (dentro del marcador): número y proporción del mixto.
// El disco se ve con el puntito y el borde de la columna del equipo que ataca.
const pointLetter = () => (mixedRatio() ? pointRatio(state.rules, state.game, state.plays, state.calc.points.length) : "");
function pointMeta() {
  const letter = pointLetter();
  return `
    <div class="sk-score__point">${esc(exf(EX.skPointN, { n: state.calc.points.length + 1 }))}</div>
    ${letter ? `<div class="sk-score__ratio">${esc(ratioText(letter))}</div>` : ""}`;
}

// La ofensiva elige la proporción de cada punto: botones para marcarla (solo en ese modo)
function pointInfo() {
  if (!(mixedRatio() && ratioPerPoint(state.rules) && isLive())) return "";
  const letter = pointLetter();
  return `
    <div class="sk-point-info">
      <span class="sk-ratio-pick ${letter ? "" : "is-missing"}" title="${esc(EX.skPointRatio)}">
        ${letter ? "" : `<span class="small fw-semibold">${esc(EX.skPointRatioPick)}</span>`}
        ${["F", "M"].map((k) => `<button type="button" class="btn btn-sm ${letter === k ? "btn-success" : "btn-outline-secondary"}" data-point-ratio="${k}">${esc(ratioText(k))}</button>`).join("")}
      </span>
    </div>`;
}

function sideButtons(k) {
  const off = state.calc.possession === k;
  const lock = playsLocked() ? "disabled" : "";
  return `
    <div class="sk-side sk-col ${off && isLive() ? "is-offense" : ""}" style="${teamVars(k)}">
      <div class="sk-col__head">
        ${teamBadge(teamObj(k), 22)}
        <span class="sk-col__name">${esc(teamName(k))}</span>
        <span class="sk-col__role">${off ? `${possessionDot(9, true)} ${esc(EX.skOffense)}` : esc(EX.skDefense)}</span>
      </div>
      <button class="sk-btn sk-btn--goal" data-act="goal" data-side="${k}" ${lock}><i class="bi bi-trophy"></i>${esc(EX.skGoal)}</button>
      <div class="d-grid gap-2" style="grid-template-columns:1fr 1fr">
        <button class="sk-btn sk-btn--turn" data-act="drop" data-side="${k}" ${off ? "" : "data-dim"} ${lock}>${esc(EX.skDrop)}</button>
        <button class="sk-btn sk-btn--turn" data-act="throwaway" data-side="${k}" ${off ? "" : "data-dim"} ${lock}>${esc(EX.skThrowaway)}</button>
      </div>
      <button class="sk-btn sk-btn--block" data-act="block" data-side="${k}" ${off ? "data-dim" : ""} ${lock}><i class="bi bi-shield"></i>${esc(EX.skBlock)}</button>
      <button class="sk-btn sk-btn--to" data-act="timeout" data-side="${k}" ${state.calc.timeoutsLeft[k] > 0 && !playsLocked() ? "" : "disabled"}><i class="bi bi-stopwatch"></i>${esc(EX.skTimeout)} (${state.calc.timeoutsLeft[k]})</button>
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
  const ctx = { playersById: state.playersById, teamName, teamColor };
  return `
    ${scoreHeader()}
    ${pointInfo()}
    ${breakBanner()}
    ${onBreak() ? `<div class="sk-banner alert-warning mt-2 small">${esc(EX.skLockedBreak)}</div>` : ""}
    ${gameOver() ? `<div class="sk-banner alert-success mt-2 d-flex justify-content-between align-items-center gap-2 flex-wrap"><span>${esc(exf(EX.skGameOver, { n: state.rules.gameTo, a: state.calc.score.A, b: state.calc.score.B }))}</span><button class="btn btn-sm btn-danger" data-act="finish"><i class="bi bi-flag me-1"></i>${esc(EX.skFinish)}</button></div>` : ""}
    <div class="sk-actions">${sideButtons("A")}${sideButtons("B")}</div>
    <div class="sk-bar">
      <button class="btn btn-outline-secondary" data-act="undo"><i class="bi bi-arrow-counterclockwise me-1"></i>${esc(EX.skUndo)}</button>
      <button class="btn btn-outline-secondary" data-act="pause" ${state.game.clock?.break ? "disabled" : ""}><i class="bi ${paused ? "bi-play" : "bi-pause"} me-1"></i>${esc(paused ? EX.skResume : EX.skPause)}</button>
      ${state.calc.halftimeDone ? "" : `<button class="btn btn-outline-secondary" data-act="halftime"><i class="bi bi-hourglass-split me-1"></i>${esc(EX.skHalftime)}</button>`}
    </div>
    <button class="btn btn-outline-danger w-100 mt-2 sk-finish" data-act="finish"><i class="bi bi-flag me-1"></i>${esc(EX.skFinish)}</button>
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

function renderFinal() {
  return `
    ${scoreHeader()}
    <div class="d-flex justify-content-end mt-2"><button class="btn btn-sm btn-outline-secondary" data-act="reopen">${esc(EX.skReopen)}</button></div>
    <div class="ev-card mt-3 small ev-muted"><i class="bi bi-heart me-1"></i>${esc(EX.skSpiritByCaptains)}</div>`;
}

let renderedMode = "";

// Medio tiempo: popup cuando un equipo llega a "medio tiempo a" (ej. 7) o se cumple la mitad del tiempo.
// Cada motivo se pregunta una sola vez; si siguen jugando queda el botón "Medio tiempo" abajo.
const halftimeAsked = new Set();
let halftimeDialog = false;
function maybeHalftimePrompt() {
  if (!isLive() || !state.calc || state.calc.halftimeDone || onBreak() || gameOver() || halftimeDialog) return;
  const r = state.rules;
  const s = state.calc.score;
  const byScore = state.calc.suggestHalftime;
  const halfMs = r.gameMinutes ? r.gameMinutes * 30000 : 0;
  const byTime = !!halfMs && clockView(state.game.clock || {}, r).elapsedMs >= halfMs;
  const reason = byScore ? "score" : byTime ? "time" : "";
  if (!reason || halftimeAsked.has(reason)) return;
  halftimeAsked.add(reason);
  halftimeDialog = true;
  const leader = s.A >= s.B ? "A" : "B";
  const msg = reason === "score"
    ? exf(EX.skHalftimeByScore, { team: teamName(leader), n: Math.max(s.A, s.B), a: s.A, b: s.B })
    : exf(EX.skHalftimeByTime, { min: r.gameMinutes / 2, a: s.A, b: s.B });
  askConfirm(msg, { title: EX.skHalftimeTitle, ok: EX.skHalftimeStart, cancel: EX.skKeepPlaying }).then((ok) => {
    halftimeDialog = false;
    if (ok && isLive() && !state.calc.halftimeDone && !onBreak()) onHalftime();
  });
}

function render() {
  if (!state.game || !state.calc) return;
  document.title = `${teamName("A")} ${state.calc.score.A}–${state.calc.score.B} ${teamName("B")} · ${EX.skTitle}`;
  const notStarted = state.game.status === GAME_STATUS.SCHEDULED || !state.game.status;
  const mode = notStarted ? "pre" : isFinal() ? "final" : "live";
  renderedMode = mode;
  $("tnRoot").innerHTML = mode === "pre" ? renderPreGame() : mode === "final" ? renderFinal() : renderLive();
  if (mode === "live") maybeHalftimePrompt();
}

/* =========================
   Eventos de la UI
========================= */
$("tnRoot").addEventListener("click", async (ev) => {
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
  if (ev.target.closest("#skStart")) return startGame().catch((err) => showNotice(`${EX.error} ${err?.code || ""}`));

  const del = ev.target.closest("[data-del-play]");
  if (del) return askConfirm(EX.confirmDelete, { danger: true }).then((ok) => ok && removePlay(del.dataset.delPlay));

  const clockBtn = ev.target.closest("[data-clock]");
  if (clockBtn) return adjustClock(Number(clockBtn.dataset.clock));

  const btn = ev.target.closest("[data-act]");
  if (!btn) return;
  const side = btn.dataset.side;
  if (btn.disabled) return;
  if (btn.hasAttribute("data-dim")) {
    const ok = await askConfirm(exf(btn.dataset.act === "block" ? EX.skDimBlock : EX.skDimTurn, { team: teamName(side) }));
    if (!ok) return;
  }
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
  // la mitad del tiempo se cumple con el reloj corriendo, sin que nadie toque nada
  maybeHalftimePrompt();
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
