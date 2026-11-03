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
        ${link("team", "/torneos/equipo.html", EX.navTeam)}
        ${link("org", "/torneos/organizar.html", EX.navOrganize)}
        ${isAdmin ? link("admin", "/torneos/admin.html", EX.navAdmin) : ""}
      </div>
      ${google
        ? `<div class="d-flex align-items-center gap-2">
            <a href="/torneos/perfil.html" title="${esc(EX.navProfile)}" class="${active === "profile" ? "is-active" : ""}">${user.photoURL ? `<img class="tn-nav__avatar" src="${esc(user.photoURL)}" alt="${esc(EX.navProfile)}" referrerpolicy="no-referrer" />` : `<i class="bi bi-person-circle text-white fs-5"></i>`}</a>
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

export function regChip(status) {
  if (status === "approved") return `<span class="ev-chip ev-chip--ok">${esc(EX.regApproved)}</span>`;
  if (status === "rejected") return `<span class="ev-chip ev-chip--bad">${esc(EX.regRejected)}</span>`;
  return `<span class="ev-chip ev-chip--wait">${esc(EX.regPending)}</span>`;
}

// Foto del jugador, o un círculo con sus iniciales
export function avatarHtml(person = {}, size = 32) {
  const style = `width:${size}px;height:${size}px`;
  const src = String(person.photoURL || "");
  if (src.startsWith("data:image/") || src.startsWith("https://")) {
    return `<img class="tn-avatar" src="${esc(src)}" alt="" style="${style}" referrerpolicy="no-referrer" />`;
  }
  const initials = String(person.name || "?").trim().split(/\s+/).slice(0, 2).map((w) => w.charAt(0).toUpperCase()).join("") || "?";
  return `<span class="tn-avatar tn-avatar--empty" style="${style};font-size:${Math.round(size * 0.38)}px">${esc(initials)}</span>`;
}

// Reduce una imagen en el navegador (logo o foto) y la devuelve como data URL chica
export async function shrinkImage(file, max = 256) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = reject;
      i.src = url;
    });
    const scale = Math.min(1, max / Math.max(img.width, img.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
    const webp = canvas.toDataURL("image/webp", 0.85);
    return webp.startsWith("data:image/webp") ? webp : canvas.toDataURL("image/png");
  } finally {
    URL.revokeObjectURL(url);
  }
}

// Logo del equipo, o un círculo con su color e inicial
export function teamBadge(team = {}, size = 32) {
  const style = `width:${size}px;height:${size}px`;
  if (team.logo && String(team.logo).startsWith("data:image/")) {
    return `<img class="tn-team-logo" src="${esc(team.logo)}" alt="" style="${style}" />`;
  }
  const initial = String(team.name || "?").trim().charAt(0).toUpperCase() || "?";
  return `<span class="tn-team-logo tn-team-logo--empty" style="${style};background:${esc(team.color || "#19473f")};font-size:${Math.round(size * 0.45)}px">${esc(initial)}</span>`;
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
    case PLAY.CLOCK_ADJUST:
      return { cls: "audit", type: EX.evClockAdjust, text: exf(EX.evClockAdjustText, { delta: `${play.deltaSec > 0 ? "+" : ""}${play.deltaSec}` }) };
    case PLAY.BREAK_END:
      return { cls: "audit", type: EX.evBreakEnd, text: play.breakType === "halftime" ? EX.evHalftime : `${EX.evTimeout}${play.team ? ` · ${team}` : ""}` };
    case PLAY.REOPEN:
      return { cls: "audit", type: EX.evReopen, text: "" };
    default:
      return { cls: "meta", type: play.type, text: "" };
  }
}

const roleLabel = (role) => (role === "organizer" ? EX.byOrganizer : role === "scorekeeper" ? EX.byScorekeeper : "");

export function feedItemHtml(play, ctx, { actions = "", audit = false } = {}) {
  const d = describePlay(play, ctx);
  const voided = !!play.deleted;
  const score = play.type === PLAY.GOAL && play.scoreA !== undefined && !voided ? `<span class="ev-feed__score">${play.scoreA}–${play.scoreB}</span>` : "";
  // historial: quién lo hizo y, si se anuló, cuándo y quién
  const who = audit ? roleLabel(play.byRole) : "";
  const voidNote = voided
    ? [play.deletedAt !== undefined ? exf(EX.evVoidedAt, { time: fmtClock((play.deletedAt || 0) * 1000) }) : "", roleLabel(play.deletedByRole)].filter(Boolean).join(" · ")
    : "";
  return `
    <div class="ev-feed__item ev-feed__item--${d.cls} ${voided ? "is-voided" : ""}" data-play="${esc(play.id)}">
      <div class="ev-feed__time">${esc(fmtClock((play.t || 0) * 1000))}</div>
      <div class="min-w-0">
        <div class="ev-feed__type">${voided ? `<span class="ev-chip ev-chip--void me-1">${esc(EX.evVoided)}</span>` : ""}<span class="ev-feed__what">${esc(d.type)}</span></div>
        ${d.text ? `<div class="small text-truncate ev-feed__what">${esc(d.text)}</div>` : ""}
        ${who || voidNote ? `<div class="ev-feed__by">${esc([who, voidNote].filter(Boolean).join(" · "))}</div>` : ""}
      </div>
      <div class="d-flex align-items-center gap-2">${score}${voided ? "" : actions}</div>
    </div>`;
}

// Los partidos guardan una copia del nombre/color del equipo al crearse; esto usa los datos actuales
// (nombre, color y logo) si se pasan los equipos del torneo.
export function withLiveTeams(g, teams) {
  if (!g || !teams) return g;
  const byId = teams instanceof Map ? teams : new Map(teams.map((t) => [t.id, t]));
  const live = (ref) => {
    const t = ref?.id ? byId.get(ref.id) : null;
    return t ? { ...ref, name: t.name || ref.name, color: t.color || ref.color, logo: t.logo || "" } : ref;
  };
  return { ...g, teamA: live(g.teamA), teamB: live(g.teamB) };
}

export function gameRowHtml(game, { href = "", teams = null } = {}) {
  const g = withLiveTeams(game, teams);
  const final = g.status === GAME_STATUS.FINAL;
  const live = g.status === GAME_STATUS.LIVE;
  const aWin = final && (g.scoreA || 0) > (g.scoreB || 0);
  const bWin = final && (g.scoreB || 0) > (g.scoreA || 0);
  const tag = href ? "a" : "div";
  return `
    <${tag} class="ev-game-row" ${href ? `href="${esc(href)}"` : ""}>
      <div class="ev-game-row__team ${aWin ? "is-winner" : ""}">
        ${teamBadge(g.teamA || {}, 34)}<span class="ev-game-row__name">${esc(g.teamA?.name || "—")}</span>
      </div>
      <div class="ev-game-row__mid">
        ${final || live ? `<div class="ev-game-row__score">${g.scoreA || 0} – ${g.scoreB || 0}</div>` : `<div class="fw-bold">${esc(fmtTimeOnly(g.startAt) || EX.vs)}</div>`}
        <div class="ev-game-row__meta">${live ? statusChip(g.status) : esc([g.field, phaseLabel(g)].filter(Boolean).join(" · "))}</div>
      </div>
      <div class="ev-game-row__team ev-game-row__team--b ${bWin ? "is-winner" : ""}">
        <span class="ev-game-row__name">${esc(g.teamB?.name || "—")}</span>${teamBadge(g.teamB || {}, 34)}
      </div>
    </${tag}>`;
}

export const gameUrl = (eventId, gameId) => `/torneos/partido.html?event=${encodeURIComponent(eventId)}&game=${encodeURIComponent(gameId)}`;
export const eventUrl = (event) => `/torneos/evento.html?e=${encodeURIComponent(event.slug || event.id)}`;
