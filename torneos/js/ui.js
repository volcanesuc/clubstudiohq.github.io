// /torneos/js/ui.js
// UI compartida: barra superior de la plataforma, sesión con Google, loader, escape, fechas,
// descripción de jugadas y filas de partidos.
import { auth } from "/torneos/js/firebase.js";
import {
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { EX, exf } from "/torneos/js/strings.js";
import { GAME_STATUS, PLAY, fmtClock } from "/torneos/js/model.js";

export function esc(v) {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export const toMillis = (v) => v?.toMillis?.() ?? (v instanceof Date ? v.getTime() : typeof v === "number" ? v : v ? Date.parse(v) || 0 : 0);

/* =========================
   Sesión
========================= */
// Usuario con cuenta de Google (no la sesión anónima del planillero)
export const isGoogleUser = (u) => !!u && !u.isAnonymous;

export function waitForUser() {
  return new Promise((resolve) => {
    const unsub = onAuthStateChanged(auth, (u) => {
      unsub();
      resolve(u || null);
    });
  });
}

export async function signInGoogle() {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  const cred = await signInWithPopup(auth, provider);
  return cred.user;
}

export async function signOutUser() {
  await signOut(auth);
}

/* =========================
   Barra superior
========================= */
/**
 * @param {{ active?: string, isAdmin?: boolean, user?: object|null, onSignIn?: Function }} opts
 */
export function renderNav({ active = "", isAdmin = false, user = null } = {}) {
  let nav = document.getElementById("tnNav");
  if (!nav) {
    nav = document.createElement("nav");
    nav.id = "tnNav";
    nav.className = "tn-nav";
    document.body.prepend(nav);
  }
  const link = (id, href, label) => `<a class="tn-nav__link ${active === id ? "is-active" : ""}" href="${href}">${esc(label)}</a>`;
  const google = isGoogleUser(user);
  nav.innerHTML = `
    <div class="container d-flex align-items-center gap-3 py-2">
      <a class="tn-nav__brand" href="/">ClubStudioHQ</a>
      <div class="d-flex gap-1 flex-grow-1 overflow-auto">
        ${link("dir", "/torneos/", EX.navTournaments)}
        ${link("org", "/torneos/organizar.html", EX.navOrganize)}
        ${isAdmin ? link("admin", "/torneos/admin.html", EX.navAdmin) : ""}
      </div>
      ${google
        ? `<div class="d-flex align-items-center gap-2">
            ${user.photoURL ? `<img class="tn-nav__avatar" src="${esc(user.photoURL)}" alt="" referrerpolicy="no-referrer" />` : ""}
            <button class="btn btn-sm btn-outline-light" id="tnSignOut">${esc(EX.signOut)}</button>
          </div>`
        : `<button class="btn btn-sm tn-btn-grad" id="tnSignIn">${esc(EX.signIn)}</button>`}
    </div>`;
  nav.querySelector("#tnSignOut")?.addEventListener("click", async () => {
    await signOutUser();
    location.reload();
  });
  nav.querySelector("#tnSignIn")?.addEventListener("click", async () => {
    try {
      await signInGoogle();
      location.reload();
    } catch (err) {
      console.warn("[torneos] login:", err?.code || err);
    }
  });
}

/* =========================
   Loader
========================= */
export function showLoader() {
  document.body.classList.add("tn-busy");
}

export function hideLoader() {
  document.body.classList.remove("tn-busy");
}

/* =========================
   Fechas
========================= */
const LOCALE = "es-CR";

export function fmtWhen(value, opts = { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) {
  const ms = toMillis(value);
  return ms ? new Intl.DateTimeFormat(LOCALE, opts).format(new Date(ms)).replace(/\./g, "") : "";
}

export const fmtTimeOnly = (v) => fmtWhen(v, { hour: "2-digit", minute: "2-digit" });
export const fmtDayOnly = (v) => fmtWhen(v, { weekday: "long", day: "numeric", month: "long" });

export function fmtDateRange(start, end) {
  const f = (s, o) => (s ? new Intl.DateTimeFormat(LOCALE, { ...o, timeZone: "UTC" }).format(new Date(`${s}T12:00:00Z`)).replace(/\./g, "") : "");
  if (!start) return "";
  if (!end || end === start) return f(start, { day: "numeric", month: "short", year: "numeric" });
  return `${f(start, { day: "numeric", month: "short" })} – ${f(end, { day: "numeric", month: "short", year: "numeric" })}`;
}

export function toLocalInput(value) {
  const ms = toMillis(value);
  if (!ms) return "";
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export const fromLocalInput = (value) => (value ? new Date(value) : null);

/* =========================
   Partidos y jugadas
========================= */
export function statusChip(status) {
  if (status === GAME_STATUS.LIVE) return `<span class="ev-chip ev-chip--live">${esc(EX.gameLive)}</span>`;
  if (status === GAME_STATUS.FINAL) return `<span class="ev-chip ev-chip--final">${esc(EX.gameFinal)}</span>`;
  return `<span class="ev-chip">${esc(EX.gameScheduled)}</span>`;
}

export function phaseLabel(g) {
  if (g.phase) return g.phase;
  const parts = [];
  if (g.pool) parts.push(exf(EX.phasePool, { pool: g.pool }));
  if (g.round) parts.push(exf(EX.phaseRound, { n: g.round }));
  return parts.join(" · ");
}

export function playerLabel(p) {
  if (!p) return EX.skUnknownPlayer;
  return `${p.name}${p.number !== null && p.number !== undefined && p.number !== "" ? ` #${p.number}` : ""}`;
}

export function describePlay(play, ctx) {
  const name = (id) => (id ? playerLabel(ctx.playersById.get(id)) : "");
  const team = ctx.teamName(play.team);
  switch (play.type) {
    case PLAY.GOAL:
      return {
        cls: "goal",
        type: `${EX.evGoal} · ${team}`,
        text: play.callahan
          ? `${name(play.scorerId) || EX.skUnknownPlayer} · ${EX.evCallahan}`
          : `${name(play.scorerId) || EX.skUnknownPlayer}${play.assistId ? ` · ${exf(EX.evAssistBy, { name: name(play.assistId) })}` : ""}`,
      };
    case PLAY.DROP:
    case PLAY.THROWAWAY:
      return { cls: "turn", type: `${play.type === PLAY.DROP ? EX.evDrop : EX.evThrowaway} · ${team}`, text: name(play.playerId) };
    case PLAY.BLOCK:
      return { cls: "block", type: `${EX.evBlock} · ${team}`, text: name(play.playerId) };
    case PLAY.TIMEOUT:
      return { cls: "meta", type: EX.evTimeout, text: team };
    case PLAY.HALFTIME:
      return { cls: "meta", type: EX.evHalftime, text: "" };
    case PLAY.PAUSE:
      return { cls: "meta", type: EX.evPause, text: "" };
    case PLAY.RESUME:
      return { cls: "meta", type: EX.evResume, text: "" };
    case PLAY.START:
      return { cls: "meta", type: EX.evStart, text: "" };
    case PLAY.END:
      return { cls: "meta", type: EX.evEnd, text: "" };
    default:
      return { cls: "meta", type: play.type, text: "" };
  }
}

export function feedItemHtml(play, ctx, { actions = "" } = {}) {
  const d = describePlay(play, ctx);
  const score = play.type === PLAY.GOAL && play.scoreA !== undefined ? `<span class="ev-feed__score">${play.scoreA}–${play.scoreB}</span>` : "";
  return `
    <div class="ev-feed__item ev-feed__item--${d.cls}" data-play="${esc(play.id)}">
      <div class="ev-feed__time">${esc(fmtClock(play.t || 0))}</div>
      <div class="min-w-0">
        <div class="ev-feed__type">${esc(d.type)}</div>
        ${d.text ? `<div class="small text-truncate">${esc(d.text)}</div>` : ""}
      </div>
      <div class="d-flex align-items-center gap-2">${score}${actions}</div>
    </div>`;
}

export function gameRowHtml(g, { href = "" } = {}) {
  const final = g.status === GAME_STATUS.FINAL;
  const live = g.status === GAME_STATUS.LIVE;
  const aWin = final && (g.scoreA || 0) > (g.scoreB || 0);
  const bWin = final && (g.scoreB || 0) > (g.scoreA || 0);
  const tag = href ? "a" : "div";
  return `
    <${tag} class="ev-game-row" ${href ? `href="${esc(href)}"` : ""}>
      <div class="ev-game-row__team ${aWin ? "is-winner" : ""}">
        <span class="ev-team-dot" style="background:${esc(g.teamA?.color || "#ccc")}"></span> ${esc(g.teamA?.name || "—")}
      </div>
      <div class="ev-game-row__mid">
        ${final || live ? `<div class="ev-game-row__score">${g.scoreA || 0} – ${g.scoreB || 0}</div>` : `<div class="fw-bold">${esc(fmtTimeOnly(g.startAt) || EX.vs)}</div>`}
        <div class="ev-game-row__meta">${live ? statusChip(g.status) : esc([g.field, phaseLabel(g)].filter(Boolean).join(" · "))}</div>
      </div>
      <div class="ev-game-row__team ev-game-row__team--b ${bWin ? "is-winner" : ""}">
        ${esc(g.teamB?.name || "—")} <span class="ev-team-dot" style="background:${esc(g.teamB?.color || "#ccc")}"></span>
      </div>
    </${tag}>`;
}

export const gameUrl = (eventId, gameId) => `/torneos/partido.html?event=${encodeURIComponent(eventId)}&game=${encodeURIComponent(gameId)}`;
export const eventUrl = (event) => `/torneos/evento.html?e=${encodeURIComponent(event.slug || event.id)}`;
