// /tournaments/js/ui.js
// UI compartida: barra superior de la plataforma, sesión con Google, loader, escape, fechas,
// descripción de jugadas y filas de partidos.
import { auth } from "/tournaments/js/firebase.js";
import {
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { EX, exf } from "/tournaments/js/strings.js";
import { GAME_STATUS, PLAY, fmtClock } from "/tournaments/js/model.js";

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
// En celular las barras de tabs se desplazan de lado: deja visible el tab activo (sin mover la página).
export function revealActiveTab(bar, selector = ".is-active, .active") {
  const el = bar?.querySelector(selector);
  if (!el || bar.scrollWidth <= bar.clientWidth) return;
  bar.scrollLeft = Math.max(0, el.offsetLeft - (bar.clientWidth - el.offsetWidth) / 2);
}

// Celular: los tabs van en una barra fija abajo (íconos + texto), como en la app de clubes.
function renderBottomNav({ active, isAdmin, google }) {
  let bar = document.getElementById("tnBottomNav");
  if (!bar) {
    bar = document.createElement("nav");
    bar.id = "tnBottomNav";
    bar.className = "tn-bnav";
    bar.setAttribute("aria-label", EX.navTournaments);
    document.body.appendChild(bar);
    document.body.classList.add("has-bnav");
  }
  const item = (id, href, icon, label) => `
    <a class="tn-bnav__item ${active === id ? "is-active" : ""}" href="${href}" ${active === id ? 'aria-current="page"' : ""}>
      <i class="bi ${icon}"></i><span>${esc(label)}</span>
    </a>`;
  bar.innerHTML = [
    item("dir", "/tournaments/", "bi-trophy", EX.navTournaments),
    item("clubs", "/tournaments/clubs.html", "bi-shield", EX.navClubs),
    item("team", "/tournaments/team.html", "bi-people", EX.navTeam),
    item("org", "/tournaments/organize.html", "bi-clipboard-check", EX.navOrganize),
    // el perfil queda en la foto de arriba (la barra tiene lugar para 5)
    isAdmin ? item("admin", "/tournaments/admin.html", "bi-shield-check", EX.navAdminShort) : "",
  ].join("");
}

// Cache de "es admin de la plataforma" por uid (para no consultar en cada página).
const adminCache = new Map();

export function renderNav({ active = "", isAdmin, user = null } = {}) {
  let nav = document.getElementById("tnNav");
  if (!nav) {
    nav = document.createElement("nav");
    nav.id = "tnNav";
    nav.className = "tn-nav";
    document.body.prepend(nav);
  }
  const link = (id, href, label) => `<a class="tn-nav__link ${active === id ? "is-active" : ""}" href="${href}">${esc(label)}</a>`;
  const google = isGoogleUser(user);
  // Si la página no lo dijo, se averigua acá: el tab Admin sale igual en todas las páginas.
  if (isAdmin === undefined) {
    isAdmin = google ? adminCache.get(user.uid) === true : false;
    if (google && !adminCache.has(user.uid)) {
      import("/tournaments/js/services.js")
        .then((m) => m.isPlatformAdmin(user.uid))
        .then((yes) => {
          adminCache.set(user.uid, yes);
          if (yes) renderNav({ active, isAdmin: true, user });
        })
        .catch(() => adminCache.set(user.uid, false));
    }
  } else if (google) {
    adminCache.set(user.uid, isAdmin === true);
  }
  nav.innerHTML = `
    <div class="container d-flex align-items-center gap-3 py-2">
      <a class="tn-nav__brand" href="/tournaments/"><img src="/assets/favicon.svg" width="30" height="30" alt="ClubStudioHQ" /><span class="tn-nav__name">ClubStudio<span class="tn-nav__hq">HQ</span></span></a>
      <div class="d-flex gap-1 flex-grow-1 overflow-auto tn-nav__tabs">
        ${link("dir", "/tournaments/", EX.navTournaments)}
        ${link("clubs", "/tournaments/clubs.html", EX.navClubs)}
        ${link("team", "/tournaments/team.html", EX.navTeam)}
        ${google ? link("profile", "/tournaments/profile.html", EX.navProfile).replace("tn-nav__link", "tn-nav__link tn-nav__link--profile") : ""}
        ${link("org", "/tournaments/organize.html", EX.navOrganize)}
        ${isAdmin ? link("admin", "/tournaments/admin.html", EX.navAdmin) : ""}
      </div>
      ${google
        ? `<div class="d-flex align-items-center gap-2">
            <a href="/tournaments/profile.html" title="${esc(EX.navProfile)}" class="${active === "profile" ? "is-active" : ""}">${user.photoURL ? `<img class="tn-nav__avatar" src="${esc(user.photoURL)}" alt="${esc(EX.navProfile)}" referrerpolicy="no-referrer" />` : `<i class="bi bi-person-circle text-white fs-5"></i>`}</a>
            <button class="btn btn-sm btn-outline-light" id="tnSignOut" title="${esc(EX.signOut)}"><i class="bi bi-box-arrow-right tn-nav__out-icon"></i><span class="tn-nav__out-text">${esc(EX.signOut)}</span></button>
          </div>`
        : `<button class="btn btn-sm tn-btn-grad text-nowrap" id="tnSignIn"><span class="tn-nav__out-text">${esc(EX.signIn)}</span><span class="tn-nav__in-short">${esc(EX.signInShort)}</span></button>`}
    </div>`;
  revealActiveTab(nav.querySelector(".tn-nav__tabs"));
  renderBottomNav({ active, isAdmin, google });
  if (!renderNav.spiritChecked && isGoogleUser(user)) {
    renderNav.spiritChecked = true;
    maybeSpiritPopup(user).catch(() => {});
  }
  nav.querySelector("#tnSignOut")?.addEventListener("click", async () => {
    // en celular "Salir" es un ícono al lado de la foto: se confirma para no salir sin querer
    if (!(await askConfirm(EX.signOutConfirm, { ok: EX.signOut }))) return;
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

// Estado del pago de la inscripción (cuota de equipo)
export function paymentChip(reg = {}) {
  const st = reg.paymentStatus || "none";
  const map = {
    none: ["ev-chip--wait", EX.payNone],
    submitted: ["ev-chip--wait", EX.paySubmitted],
    approved: ["ev-chip--ok", EX.payApproved],
    rejected: ["ev-chip--alert", EX.payRejected],
  };
  const [cls, label] = map[st] || map.none;
  return `<span class="ev-chip ${cls}"><i class="bi bi-cash-coin me-1"></i>${esc(label)}</span>`;
}

// Aviso: partidos terminados donde mi equipo tiene que evaluar el espíritu del rival
export function spiritPendingHtml(list = []) {
  if (!list.length) return "";
  return `
    <section class="sp-pending">
      <div class="sp-pending__head">
        <span class="sp-pending__icon"><i class="bi bi-heart-fill"></i></span>
        <div>
          <div class="fw-bold">${esc(exf(EX.spPendingTitle, { n: list.length }))}</div>
          <div class="small opacity-75">${esc(EX.spPendingSub)}</div>
        </div>
      </div>
      ${list.map((x) => {
        const g = x.game;
        const us = x.side === "A" ? g.scoreA || 0 : g.scoreB || 0;
        const them = x.side === "A" ? g.scoreB || 0 : g.scoreA || 0;
        return `
          <a class="sp-pending__row" href="/tournaments/spirit.html?${new URLSearchParams({ event: x.eventId, game: g.id, side: x.side })}">
            ${teamBadge(x.opp, 34)}
            <div class="flex-grow-1 min-w-0">
              <div class="fw-semibold text-truncate">${esc(exf(EX.spVs, { team: x.opp?.name || "—" }))}</div>
              <div class="small ev-muted text-truncate">${esc([x.team?.name, `${us}–${them}`, x.eventName].filter(Boolean).join(" · "))}</div>
            </div>
            <span class="btn btn-sm sp-btn">${esc(EX.spRate)} <i class="bi bi-chevron-right"></i></span>
          </a>`;
      }).join("")}
    </section>`;
}

// Quién tiene el disco: punto verde encendido (lo tiene) o gris (no lo tiene)
export function possessionDot(size = 12, active = true) {
  return `<span class="tn-pos-dot ${active ? "is-on" : "is-off"}" style="width:${size}px;height:${size}px" aria-hidden="true"></span>`;
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
// Texto legible sobre un color de fondo: blanco u oscuro (contraste WCAG)
const DARK_TEXT = "#1f1446";
export function textOn(color) {
  let hex = String(color || "").trim().replace(/^#/, "");
  if (/^[0-9a-f]{3}$/i.test(hex)) hex = hex.split("").map((c) => c + c).join("");
  if (!/^[0-9a-f]{6}$/i.test(hex)) return "#fff";
  const lum = (h) => {
    const [r, g, b] = [0, 2, 4].map((i) => {
      const v = parseInt(h.slice(i, i + 2), 16) / 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const bg = lum(hex);
  const contrast = (l) => (Math.max(bg, l) + 0.05) / (Math.min(bg, l) + 0.05);
  // blanco mientras se lea bien (3:1, letra grande en negrita); en colores claros (amarillo, celeste…) texto oscuro
  return contrast(1) >= 3 || contrast(1) >= contrast(lum(DARK_TEXT.slice(1))) ? "#fff" : DARK_TEXT;
}

export function teamBadge(team = {}, size = 32) {
  const style = `width:${size}px;height:${size}px`;
  // llave sin definir ("Ganador de Semifinal 1"): círculo gris con "?"
  if (team.placeholder || (!team.id && !team.name && !team.logo)) {
    return `<span class="tn-team-badge tn-team-badge--tbd" style="${style};font-size:${Math.round(size * 0.45)}px">?</span>`;
  }
  if (team.logo && String(team.logo).startsWith("data:image/")) {
    return `<img class="tn-team-logo" src="${esc(team.logo)}" alt="" style="${style}" />`;
  }
  const initial = String(team.name || "?").trim().charAt(0).toUpperCase() || "?";
  return `<span class="tn-team-logo tn-team-logo--empty" style="${style};background:${esc(team.color || "#19473f")};color:${textOn(team.color || "#19473f")};font-size:${Math.round(size * 0.45)}px">${esc(initial)}</span>`;
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
    case PLAY.RATIO:
      return { cls: "audit", type: EX.evRatio, text: `${play.letter === "F" ? EX.skFmp : EX.skMmp} · ${exf(EX.skPointN, { n: (play.point || 0) + 1 })}` };
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
      <div class="ev-game-row__team ${aWin ? "is-winner" : bWin ? "is-loser" : ""}">
        ${teamBadge(g.teamA || {}, 34)}<span class="ev-game-row__name">${esc(g.teamA?.name || "—")}</span>
      </div>
      <div class="ev-game-row__mid">
        ${final || live ? `<div class="ev-game-row__score"><span class="${bWin ? "is-loser" : ""}">${g.scoreA || 0}</span> – <span class="${aWin ? "is-loser" : ""}">${g.scoreB || 0}</span></div>` : `<div class="fw-bold">${esc(fmtTimeOnly(g.startAt) || EX.vs)}</div>`}
        <div class="ev-game-row__meta">${live ? statusChip(g.status) : esc([g.field, phaseLabel(g)].filter(Boolean).join(" · "))}</div>
      </div>
      <div class="ev-game-row__team ev-game-row__team--b ${bWin ? "is-winner" : aWin ? "is-loser" : ""}">
        <span class="ev-game-row__name">${esc(g.teamB?.name || "—")}</span>${teamBadge(g.teamB || {}, 34)}
      </div>
    </${tag}>`;
}

export const gameUrl = (eventId, gameId) => `/tournaments/game.html?event=${encodeURIComponent(eventId)}&game=${encodeURIComponent(gameId)}`;
export const eventUrl = (event) => `/tournaments/event.html?e=${encodeURIComponent(event.slug || event.id)}`;

/* =========================
   Diálogo propio (los confirm()/alert() nativos los bloquean algunos navegadores y apps)
========================= */
/**
 * @param {string} message
 * @param {{ title?: string, ok?: string, cancel?: string|false, danger?: boolean, html?: string }} opts
 * @returns {Promise<boolean>} true si tocaron el botón principal
 */
export function askConfirm(message, { title = "", ok = EX.ok || "OK", cancel = EX.cancel || "Cancelar", danger = false, html = "", onOpen = null, read = null } = {}) {
  return new Promise((resolve) => {
    const wrap = document.createElement("div");
    wrap.className = "tn-dialog";
    wrap.innerHTML = `
      <div class="tn-dialog__box" role="dialog" aria-modal="true">
        ${title ? `<div class="tn-dialog__title">${esc(title)}</div>` : ""}
        ${message ? `<div class="tn-dialog__msg">${esc(message)}</div>` : ""}
        ${html}
        <div class="tn-dialog__actions">
          ${cancel === false ? "" : `<button type="button" class="btn btn-light" data-dlg="no">${esc(cancel)}</button>`}
          <button type="button" class="btn ${danger ? "btn-danger" : "btn-primary"}" data-dlg="yes">${esc(ok)}</button>
        </div>
      </div>`;
    const close = (val) => {
      // con read(): devuelve los datos del formulario del diálogo (o false si cancelaron)
      if (val && read) val = read(wrap) || false;
      wrap.remove();
      document.removeEventListener("keydown", onKey);
      resolve(val);
    };
    const onKey = (e) => { if (e.key === "Escape") close(false); };
    wrap.addEventListener("click", (e) => {
      if (e.target === wrap) return close(false);
      const b = e.target.closest("[data-dlg]");
      if (b) close(b.dataset.dlg === "yes");
    });
    document.addEventListener("keydown", onKey);
    document.body.appendChild(wrap);
    wrap.querySelector('[data-dlg="yes"]').focus();
    onOpen?.(wrap);
  });
}

export const showNotice = (message, opts = {}) => askConfirm(message, { cancel: false, ...opts });

/* =========================
   Popup: evaluaciones de espíritu pendientes (capitanes / admins del equipo)
   Sale una vez por sesión al entrar, en cualquier página, hasta que las hagan.
========================= */
async function maybeSpiritPopup(user) {
  if (!isGoogleUser(user) || location.pathname.endsWith("/spirit.html")) return;
  const key = `tnSpiritPopup:${user.uid}`;
  try { if (sessionStorage.getItem(key)) return; } catch { /* sin storage: igual se muestra */ }
  const { pendingSpirit } = await import("/tournaments/js/squads.js");
  const list = await pendingSpirit(user).catch(() => []);
  if (!list.length) return;
  try { sessionStorage.setItem(key, "1"); } catch { /* nada */ }
  const go = await askConfirm("", {
    title: exf(EX.spPendingTitle, { n: list.length }),
    html: `<div class="small ev-muted mb-2">${esc(EX.spPopupSub)}</div><div class="tn-dialog__list">${spiritPendingHtml(list.slice(0, 5))}</div>`,
    ok: EX.spRate,
    cancel: EX.spLater,
  });
  if (go) {
    const x = list[0];
    location.href = `/tournaments/spirit.html?${new URLSearchParams({ event: x.eventId, game: x.game.id, side: x.side })}`;
  }
}

/* =========================
   Calendario por horas (canchas en columnas, horas en filas)
========================= */
const pad2 = (n) => String(n).padStart(2, "0");
export const localDay = (value) => {
  const ms = toMillis(value);
  if (!ms) return "";
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
};
const minutesOfDay = (value) => {
  const d = new Date(toMillis(value));
  return d.getHours() * 60 + d.getMinutes();
};
export const atMinutes = (day, min) => {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d, Math.floor(min / 60), min % 60);
};

/**
 * Grilla de un día: una columna por cancha y una fila por franja (duración del partido + descanso).
 * @param {{ games: object[], fields: string[], day: string, stepMin: number, editable?: boolean,
 *           href?: (g) => string, picked?: string }} opts
 */
export function scheduleGridHtml({ games = [], fields = [], day = "", stepMin = 100, editable = false, href = null, picked = "" }) {
  const step = Math.max(15, Number(stepMin) || 100);
  const dayGames = games.filter((g) => localDay(g.startAt) === day);
  // canchas del torneo + las que usen los partidos; "Sin cancha" solo si algún partido no tiene
  const cols = [...new Set([...fields, ...dayGames.map((g) => g.field).filter(Boolean)])];
  if (!cols.length || dayGames.some((g) => !g.field)) cols.push("");
  const columns = cols;
  const starts = dayGames.map((g) => minutesOfDay(g.startAt));
  // arranca a la hora del primer partido (o 08:00 si el día está vacío)
  const first = starts.length ? Math.min(...starts) : 8 * 60;
  const from = first;
  const last = Math.max(from + step * 4, ...starts.map((m) => m + step));
  const rows = [];
  for (let m = from; m < Math.min(last, 24 * 60); m += step) rows.push(m);
  const rowOf = (g) => Math.floor((minutesOfDay(g.startAt) - from) / step);

  const chip = (g) => {
    const live = g.status === GAME_STATUS.LIVE;
    const final = g.status === GAME_STATUS.FINAL;
    const inner = `
      <span class="sg-chip__time">${pad2(Math.floor(minutesOfDay(g.startAt) / 60))}:${pad2(minutesOfDay(g.startAt) % 60)}${g.phase ? ` · ${esc(g.phase)}` : g.pool ? ` · ${esc(exf(EX.phasePool, { pool: g.pool }))}` : ""}</span>
      <span class="sg-chip__team">${teamBadge(g.teamA || {}, 16)}<span class="text-truncate">${esc(g.teamA?.name || "—")}</span>${final || live ? `<b>${g.scoreA || 0}</b>` : ""}</span>
      <span class="sg-chip__team">${teamBadge(g.teamB || {}, 16)}<span class="text-truncate">${esc(g.teamB?.name || "—")}</span>${final || live ? `<b>${g.scoreB || 0}</b>` : ""}</span>`;
    const cls = `sg-chip ${live ? "is-live" : ""} ${final ? "is-final" : ""} ${picked === g.id ? "is-picked" : ""}`;
    if (editable) return `<div class="${cls}" draggable="${final || live ? "false" : "true"}" data-sg-game="${esc(g.id)}" ${final || live ? 'data-locked="1"' : ""}>${inner}</div>`;
    return href ? `<a class="${cls}" href="${esc(href(g))}">${inner}</a>` : `<div class="${cls}">${inner}</div>`;
  };

  return `
    <div class="sg-wrap">
      <table class="sg">
        <thead><tr><th class="sg-time"></th>${columns.map((f) => `<th>${esc(f || EX.noField)}</th>`).join("")}</tr></thead>
        <tbody>
          ${rows.map((m, ri) => `
            <tr>
              <th class="sg-time">${pad2(Math.floor(m / 60))}:${pad2(m % 60)}</th>
              ${columns.map((f) => {
                const here = dayGames.filter((g) => rowOf(g) === ri && (g.field || "") === f);
                const clash = here.length > 1;
                return `<td class="sg-cell ${clash ? "is-clash" : ""}" ${editable ? `data-sg-slot="${esc(atMinutes(day, m).toISOString())}" data-sg-field="${esc(f)}"` : ""}>${here.map(chip).join("")}</td>`;
              }).join("")}
            </tr>`).join("")}
        </tbody>
      </table>
    </div>`;
}

// Días del torneo con partidos (y las fechas del evento), en orden
export function scheduleDays(games = [], event = {}) {
  const days = new Set(games.map((g) => localDay(g.startAt)).filter(Boolean));
  if (event.startDate) {
    const end = event.endDate || event.startDate;
    for (let d = new Date(`${event.startDate}T12:00`); localDay(d) <= end && days.size < 40; d.setDate(d.getDate() + 1)) days.add(localDay(d));
  }
  return [...days].sort();
}

/* =========================
   Agregar al calendario (.ics para Apple/Outlook/Google y link directo a Google Calendar)
========================= */
const icsDate = (d) => new Date(d).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const icsText = (s) => String(s || "").replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/[,;]/g, (c) => `\\${c}`);

function gameEventInfo(g, event = {}) {
  const start = new Date(toMillis(g.startAt));
  const minutes = Number(event.rules?.gameMinutes) || 90;
  const end = new Date(start.getTime() + minutes * 60000);
  const title = `${g.teamA?.name || "?"} vs ${g.teamB?.name || "?"} · ${event.name || "ClubStudioHQ"}`;
  const where = [event.venue, g.field].filter(Boolean).join(" · ");
  const url = `${location.origin}${gameUrl(event.id, g.id)}`;
  const details = [phaseLabel(g), url].filter(Boolean).join("\n");
  return { start, end, title, where, details, url };
}

export function icsForGames(games = [], event = {}) {
  const now = icsDate(Date.now());
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//ClubStudioHQ//Torneos//ES", "CALSCALE:GREGORIAN", "METHOD:PUBLISH", `X-WR-CALNAME:${icsText(event.name || "Torneo")}`];
  games.filter((g) => toMillis(g.startAt)).forEach((g) => {
    const x = gameEventInfo(g, event);
    lines.push("BEGIN:VEVENT", `UID:${g.id}@clubstudiohq.com`, `DTSTAMP:${now}`, `DTSTART:${icsDate(x.start)}`, `DTEND:${icsDate(x.end)}`,
      `SUMMARY:${icsText(x.title)}`, `LOCATION:${icsText(x.where)}`, `DESCRIPTION:${icsText(x.details)}`, `URL:${x.url}`, "END:VEVENT");
  });
  lines.push("END:VCALENDAR");
  return lines.join("\r\n");
}

export function downloadIcs(games, event, filename = "partidos.ics") {
  const blob = new Blob([icsForGames(games, event)], { type: "text/calendar;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

export function googleCalendarUrl(g, event = {}) {
  const x = gameEventInfo(g, event);
  const q = new URLSearchParams({ action: "TEMPLATE", text: x.title, dates: `${icsDate(x.start)}/${icsDate(x.end)}`, details: x.details, location: x.where });
  return `https://calendar.google.com/calendar/render?${q}`;
}
