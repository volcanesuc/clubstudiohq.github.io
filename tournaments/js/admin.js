// /tournaments/js/admin.js
// Admin de la plataforma: aprobar torneos (prueba gratis o pagado), rechazar y desactivar.
// Un admin es quien tenga un doc en platform_admins/{uid} (se crea a mano en la consola de Firebase).
import { EX, exf } from "/tournaments/js/strings.js";
import { APPROVAL, isPlatformAdmin, listApprovalRequests, listApprovedEvents, listTeams, setApproval } from "/tournaments/js/services.js";
import {
  assignPlayerAccount,
  importPreview,
  importTournament,
  linkTeamToSquad,
  listAllProfiles,
  listAllSquads,
  listBundledImports,
  loadBundledImport,
  unassignPlayerAccount,
  unlinkTeamFromSquad,
  validateImport,
} from "/tournaments/js/imports.js";
import { profileUrl } from "/tournaments/js/squads.js";
import { avatarHtml, esc, eventUrl, fmtDateRange, fmtWhen, hideLoader, isGoogleUser, playerLabel, renderNav, showLoader, teamBadge, toMillis, waitForUser } from "/tournaments/js/ui.js";

const root = document.getElementById("tnRoot");
const TABS = ["pending", "active", "import", "players"];
const HASH_TAB = TABS.includes(location.hash.slice(1)) ? location.hash.slice(1) : "";
const state = {
  pending: [],
  active: [],
  tab: HASH_TAB,
  search: "",
  // importar
  bundled: null,
  imp: null, // { data, preview, exists, label }
  progress: "",
  done: null, // { eventId, slug }
  // jugadores sin cuenta
  pl: { eventId: "", event: null, teams: [], onlyFree: true, search: "" },
  profiles: null,
  squads: null,
  pick: null, // { team, player }
};
const DAY = 86400000;

function alertBox(msg, kind = "success") {
  const el = document.getElementById("tnAlert");
  el.className = `alert alert-${kind}`;
  el.textContent = msg;
  el.classList.toggle("d-none", !msg);
  if (kind === "success") setTimeout(() => el.classList.add("d-none"), 2500);
}

// "hace 3 h", "hace 2 días"
function ago(v) {
  const ms = toMillis(v);
  if (!ms) return "";
  const min = Math.round((Date.now() - ms) / 60000);
  if (min < 1) return EX.adAgoNow;
  if (min < 60) return exf(EX.adAgoMin, { n: min });
  const h = Math.round(min / 60);
  if (h < 24) return exf(EX.adAgoHours, { n: h });
  return exf(EX.adAgoDays, { n: Math.round(h / 24) });
}

const daysLeft = (v) => {
  const ms = toMillis(v);
  return ms ? Math.ceil((ms - Date.now()) / DAY) : null;
};

const isoIn = (days) => new Date(Date.now() + days * DAY).toISOString().slice(0, 10);

const thumb = (e, size = 64) => (e.image
  ? `<div class="pa-thumb" style="width:${size}px;height:${size}px;background-image:url('${esc(e.image)}')"></div>`
  : `<div class="pa-thumb pa-thumb--plain" style="width:${size}px;height:${size}px">🏆</div>`);

function ownerLine(e) {
  return `
    <div class="pa-owner">
      ${avatarHtml({ name: e.ownerName || e.ownerEmail || "?" }, 26)}
      <span class="fw-semibold">${esc(e.ownerName || EX.sqUnnamed)}</span>
      ${e.ownerEmail ? `<a class="ev-muted" href="mailto:${esc(e.ownerEmail)}">${esc(e.ownerEmail)}</a>` : ""}
    </div>`;
}

/* =========================
   Solicitudes pendientes
========================= */
function pendingCard(e) {
  const id = e.id;
  return `
    <form class="pa-card" data-event="${esc(id)}">
      <div class="pa-card__top">
        ${thumb(e, 72)}
        <div class="flex-grow-1 min-w-0">
          <div class="d-flex justify-content-between align-items-start gap-2 flex-wrap">
            <a class="pa-card__name" href="${esc(eventUrl({ id }))}" target="_blank" rel="noopener">${esc(e.name || "—")} <i class="bi bi-box-arrow-up-right small"></i></a>
            <span class="pa-pill pa-pill--wait"><i class="bi bi-hourglass-split"></i> ${esc(ago(e.approval?.requestedAt) || EX.adminPending)}</span>
          </div>
          <div class="small ev-muted">${esc([fmtDateRange(e.startDate, e.endDate), e.venue].filter(Boolean).join(" · "))}</div>
          ${(e.divisions || []).length ? `<div class="d-flex flex-wrap gap-1 mt-1">${e.divisions.map((d) => `<span class="ev-chip">${esc(d.name)}</span>`).join("")}</div>` : ""}
          ${ownerLine(e)}
          ${e.approval?.note ? `<div class="pa-note"><i class="bi bi-chat-left-quote me-1"></i>${esc(e.approval.note)}</div>` : ""}
        </div>
      </div>
      <div class="pa-card__form">
        <div>
          <div class="pa-label">${esc(EX.adminPlan)}</div>
          <div class="pa-seg">
            <input type="radio" class="btn-check" name="plan-${esc(id)}" id="pt-${esc(id)}" value="trial" checked />
            <label class="btn" for="pt-${esc(id)}"><i class="bi bi-gift me-1"></i>${esc(EX.planTrial)}</label>
            <input type="radio" class="btn-check" name="plan-${esc(id)}" id="pp-${esc(id)}" value="paid" />
            <label class="btn" for="pp-${esc(id)}"><i class="bi bi-credit-card me-1"></i>${esc(EX.planPaid)}</label>
          </div>
        </div>
        <div>
          <div class="pa-label">${esc(EX.adminExpires)}</div>
          <div class="d-flex flex-wrap gap-1 align-items-center">
            <button type="button" class="pa-preset" data-days="14">${esc(exf(EX.adDays, { n: 14 }))}</button>
            <button type="button" class="pa-preset" data-days="30">${esc(exf(EX.adDays, { n: 30 }))}</button>
            <button type="button" class="pa-preset is-active" data-days="">${esc(EX.adNoExpiry)}</button>
            <input class="form-control form-control-sm" style="width:auto" type="date" data-f="expires" aria-label="${esc(EX.adminExpires)}" />
          </div>
        </div>
        <div class="flex-grow-1" style="min-width:14rem">
          <div class="pa-label">${esc(EX.adminNote)}</div>
          <input class="form-control form-control-sm" data-f="note" maxlength="500" placeholder="${esc(EX.adNotePh)}" />
        </div>
        <div class="d-flex gap-2 ms-auto align-self-end">
          <button type="button" class="btn btn-outline-danger" data-act="reject"><i class="bi bi-x-lg me-1"></i>${esc(EX.adminReject)}</button>
          <button type="submit" class="btn btn-success"><i class="bi bi-check-lg me-1"></i>${esc(EX.adminApprove)}</button>
        </div>
      </div>
    </form>`;
}

/* =========================
   Torneos activos
========================= */
function expiryPill(a) {
  if (!a.expiresAt) return `<span class="pa-pill">${esc(EX.adNoExpiry)}</span>`;
  const d = daysLeft(a.expiresAt);
  const date = fmtWhen(a.expiresAt, { day: "numeric", month: "short", year: "numeric" });
  if (d < 0) return `<span class="pa-pill pa-pill--bad"><i class="bi bi-exclamation-triangle"></i> ${esc(exf(EX.adExpired, { date }))}</span>`;
  if (d <= 7) return `<span class="pa-pill pa-pill--warn"><i class="bi bi-clock"></i> ${esc(exf(EX.adExpiresIn, { n: d }))}</span>`;
  return `<span class="pa-pill">${esc(exf(EX.approvalExpires, { date }))}</span>`;
}

function activeRow(e) {
  const a = e.approval || {};
  return `
    <div class="pa-row" data-event="${esc(e.id)}">
      ${thumb(e, 52)}
      <div class="flex-grow-1 min-w-0">
        <a class="fw-bold text-decoration-none" href="${esc(eventUrl({ id: e.id }))}" target="_blank" rel="noopener">${esc(e.name || "—")}</a>
        <div class="small ev-muted text-truncate">${esc([fmtDateRange(e.startDate, e.endDate), e.ownerName || e.ownerEmail].filter(Boolean).join(" · "))}</div>
        <div class="d-flex flex-wrap gap-1 mt-1">
          <span class="pa-pill ${a.plan === "paid" ? "pa-pill--paid" : "pa-pill--trial"}"><i class="bi ${a.plan === "paid" ? "bi-credit-card" : "bi-gift"}"></i> ${esc(a.plan === "paid" ? EX.planPaid : EX.planTrial)}</span>
          ${expiryPill(a)}
          <span class="pa-pill ${e.isPublic ? "pa-pill--ok" : ""}"><i class="bi ${e.isPublic ? "bi-globe2" : "bi-eye-slash"}"></i> ${esc(e.isPublic ? EX.adPublic : EX.adPrivate)}</span>
        </div>
      </div>
      <div class="d-flex gap-1 flex-shrink-0">
        <a class="btn btn-sm btn-light" href="${esc(eventUrl({ id: e.id }))}" target="_blank" rel="noopener" title="${esc(EX.openPublic)}"><i class="bi bi-eye"></i></a>
        <button class="btn btn-sm btn-outline-danger" data-act="revoke">${esc(EX.adminRevoke)}</button>
      </div>
    </div>`;
}

/* =========================
   Importar torneo
========================= */
function importTab() {
  const { bundled, imp, done } = state;
  const stat = (n, label) => `<div class="pa-stat pa-stat--light"><div><div class="pa-stat__n">${esc(n)}</div><div class="pa-stat__l">${esc(label)}</div></div></div>`;
  const preview = imp ? `
    <div class="pa-card mt-3">
      <div class="pa-card__top">
        <div class="pa-thumb pa-thumb--plain" style="width:64px;height:64px">🥏</div>
        <div class="flex-grow-1 min-w-0">
          <div class="pa-card__name">${esc(imp.data.event.name)}</div>
          <div class="small ev-muted">${esc([fmtDateRange(imp.data.event.startDate, imp.data.event.endDate), imp.data.event.venue, (imp.data.event.divisions || []).map((d) => d.name).join(", ")].filter(Boolean).join(" · "))}</div>
          ${imp.data.source?.url ? `<div class="small mt-1">${esc(EX.imSource)}: <a href="${esc(imp.data.source.url)}" target="_blank" rel="noopener">${esc(imp.data.source.url)}</a></div>` : ""}
          <div class="pa-stats mt-2">
            ${stat(imp.preview.teams, EX.imTeams)}${stat(imp.preview.players, EX.imPlayers)}${stat(imp.preview.games, EX.imGames)}
            ${stat(imp.preview.goals, EX.imGoals)}${stat(imp.preview.plays, EX.imPlays)}${stat(imp.preview.spirit, EX.imSpirit)}
          </div>
          ${imp.exists ? `<div class="pa-note"><i class="bi bi-info-circle me-1"></i>${esc(EX.imExists)}</div>` : ""}
        </div>
      </div>
      <div class="pa-card__form">
        <div class="small ev-muted align-self-center" id="imProgress">${esc(state.progress)}</div>
        <div class="d-flex gap-2 ms-auto">
          ${done ? `
            <a class="btn btn-light" href="${esc(eventUrl({ slug: done.slug }))}" target="_blank" rel="noopener"><i class="bi bi-eye me-1"></i>${esc(EX.imOpen)}</a>
            <button class="btn btn-primary" data-act="goAssign" data-id="${esc(done.eventId)}"><i class="bi bi-person-check me-1"></i>${esc(EX.imAssign)}</button>`
            : `<button class="btn btn-success" data-act="runImport"><i class="bi bi-cloud-upload me-1"></i>${esc(imp.exists ? EX.imRerun : EX.imRun)}</button>`}
        </div>
      </div>
    </div>` : "";
  return `
    <section class="ev-card">
      <h2 class="h5 fw-bold mb-1"><i class="bi bi-cloud-download me-1"></i>${esc(EX.imTitle)}</h2>
      <p class="small ev-muted">${esc(EX.imSub)}</p>
      <div class="pa-label">${esc(EX.imBundled)}</div>
      ${bundled === null ? `<div class="small ev-muted">${esc(EX.loading)}</div>`
        : bundled.length ? `<div class="d-flex flex-wrap gap-2">${bundled.map((b) => `
            <button class="pa-preset ${imp?.label === b.file ? "is-active" : ""}" data-act="pickBundled" data-file="${esc(b.file)}"><i class="bi bi-file-earmark-zip me-1"></i>${esc(b.name || b.file)}</button>`).join("")}</div>`
        : `<div class="small ev-muted">${esc(EX.imNone)}</div>`}
      <div class="pa-label mt-3">${esc(EX.imFile)}</div>
      <input type="file" class="form-control form-control-sm" accept="application/json,.json" id="imFile" style="max-width:24rem" />
      <div class="form-text">${esc(EX.imFileHint)}</div>
    </section>
    ${preview}`;
}

async function pickImport(data, label) {
  validateImport(data);
  const exists = state.active.some((e) => e.id === data.event.id) || state.pending.some((e) => e.id === data.event.id);
  state.imp = { data, preview: importPreview(data), exists, label };
  state.done = null;
  state.progress = "";
  render();
}

/* =========================
   Jugadores sin cuenta
========================= */
const norm = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
const tokens = (s) => norm(s).split(/[^a-z0-9]+/).filter((w) => w.length > 1);

// parecido entre el nombre del jugador y el de la cuenta: palabras en común
function nameScore(a, b) {
  const ta = tokens(a);
  const tb = new Set(tokens(b));
  if (!ta.length || !tb.size) return 0;
  return ta.filter((w) => tb.has(w) || [...tb].some((x) => x.length > 3 && (x.startsWith(w) || w.startsWith(x)))).length / Math.max(ta.length, tb.size);
}

const linkedProfile = (uid) => (state.profiles || []).find((p) => p.id === uid) || null;

function playersTab() {
  const events = [...state.active, ...state.pending];
  if (!events.length) return `<div class="pa-empty small ev-muted">${esc(EX.plNoEvents)}</div>`;
  const { event, teams, onlyFree, search } = state.pl;
  const q = norm(search);
  const all = teams.flatMap((t) => t.players || []);
  const free = all.filter((p) => !p.uid).length;
  const rows = (t) => (t.players || [])
    .filter((p) => (!onlyFree || !p.uid) && (!q || norm(p.name).includes(q)))
    .map((p) => {
      const prof = p.uid ? linkedProfile(p.uid) : null;
      return `
        <div class="pa-row" data-team="${esc(t.id)}" data-player="${esc(p.id)}">
          ${avatarHtml(prof || p, 36)}
          <div class="flex-grow-1 min-w-0">
            <div class="fw-semibold text-truncate">${esc(playerLabel(p))}${p.gender ? ` <span class="ev-muted small">${esc(p.gender)}</span>` : ""}</div>
            ${p.uid
              ? `<a class="small text-decoration-none" href="${esc(profileUrl(p.uid))}" target="_blank" rel="noopener"><i class="bi bi-person-check me-1"></i>${esc(prof?.name || p.uid)}</a>`
              : `<span class="pa-pill pa-pill--wait">${esc(EX.plFree)}</span>`}
          </div>
          ${p.uid
            ? `<button class="btn btn-sm btn-outline-danger" data-act="unassign">${esc(EX.plUnassign)}</button>`
            : `<button class="btn btn-sm btn-primary" data-act="assign"><i class="bi bi-person-plus me-1"></i>${esc(EX.plAssign)}</button>`}
        </div>`;
    }).join("");
  const teamBlocks = teams.map((t) => {
    const r = rows(t);
    if (!r) return "";
    const tFree = (t.players || []).filter((p) => !p.uid).length;
    return `
      <section class="pa-list mb-3">
        <div class="pa-row" style="background:#faf9fe">
          ${teamBadge(t, 32)}
          <div class="flex-grow-1 fw-bold">${esc(t.name)}</div>
          <span class="pa-pill">${esc(exf(EX.plCount, { free: tFree, total: (t.players || []).length }))}</span>
        </div>
        <div class="pa-row small" data-team="${esc(t.id)}" style="background:#faf9fe">${squadLink(t)}</div>
        ${r}
      </section>`;
  }).join("");
  return `
    <section class="ev-card mb-3">
      <h2 class="h5 fw-bold mb-1"><i class="bi bi-person-badge me-1"></i>${esc(EX.plTitle)}</h2>
      <p class="small ev-muted mb-2">${esc(EX.plSub)}</p>
      <div class="d-flex flex-wrap gap-2 align-items-end">
        <div style="min-width:16rem;flex:1 1 16rem">
          <div class="pa-label">${esc(EX.plEvent)}</div>
          <select class="form-select" id="plEvent">${events.map((e) => `<option value="${esc(e.id)}" ${e.id === state.pl.eventId ? "selected" : ""}>${esc(e.name || e.id)}${e.imported ? " · importado" : ""}</option>`).join("")}</select>
        </div>
        <div class="pa-seg">
          <input type="radio" class="btn-check" name="plFilter" id="plFree" value="free" ${onlyFree ? "checked" : ""} />
          <label class="btn" for="plFree">${esc(EX.plOnlyFree)}</label>
          <input type="radio" class="btn-check" name="plFilter" id="plAllP" value="all" ${onlyFree ? "" : "checked"} />
          <label class="btn" for="plAllP">${esc(EX.plAll)}</label>
        </div>
      </div>
      ${event ? `<div class="small ev-muted mt-2">${esc(exf(EX.plCount, { free, total: all.length }))}</div>` : ""}
    </section>
    <div class="pa-search"><i class="bi bi-search"></i><input class="form-control" id="plSearch" placeholder="${esc(EX.plSearch)}" value="${esc(search)}" /></div>
    ${teamBlocks || `<div class="pa-empty small ev-muted">${esc(EX.plNoPlayers)}</div>`}`;
}

// equipo del torneo <-> equipo permanente (squad)
function squadLink(t) {
  const squads = state.squads || [];
  if (t.squadId) {
    const sq = squads.find((x) => x.id === t.squadId);
    return `
      <i class="bi bi-link-45deg"></i>
      <a class="flex-grow-1 text-decoration-none" href="/tournaments/club.html?s=${esc(encodeURIComponent(t.squadId))}" target="_blank" rel="noopener">${esc(exf(EX.plLinked, { name: sq?.name || t.squadId }))}</a>
      <button class="btn btn-sm btn-outline-secondary" data-act="unlinkSquad">${esc(EX.plUnlink)}</button>`;
  }
  if (!squads.length) return "";
  // primero los que se llaman igual
  const same = (x) => norm(x.name) === norm(t.name);
  const sorted = [...squads.filter(same), ...squads.filter((x) => !same(x))];
  return `
    <i class="bi bi-link-45deg"></i>
    <select class="form-select form-select-sm flex-grow-1" data-f="squad" style="max-width:20rem" aria-label="${esc(EX.plLinkSquad)}">
      <option value="">${esc(EX.plLinkPick)}</option>
      ${sorted.map((x) => `<option value="${esc(x.id)}" ${same(x) ? "selected" : ""}>${esc(x.name || x.id)}${x.city ? ` · ${esc(x.city)}` : ""}</option>`).join("")}
    </select>
    <button class="btn btn-sm btn-outline-primary" data-act="linkSquad">${esc(EX.plLinkSquad)}</button>`;
}

async function loadPlayersEvent(eid) {
  const events = [...state.active, ...state.pending];
  const id = eid || state.pl.eventId || (events.find((e) => e.imported) || events[0])?.id || "";
  state.pl.eventId = id;
  state.pl.event = events.find((e) => e.id === id) || null;
  const [teams, profiles, squads] = await Promise.all([
    id ? listTeams(id) : [],
    state.profiles ? state.profiles : listAllProfiles().catch(() => []),
    state.squads ? state.squads : listAllSquads().catch(() => []),
  ]);
  state.pl.teams = teams;
  state.profiles = profiles;
  state.squads = squads;
}

/* ----- selector de cuenta (modal) ----- */
let pickModal = null;
function ensurePickModal() {
  if (pickModal) return pickModal;
  document.body.insertAdjacentHTML("beforeend", `
    <div class="modal fade" id="plPick" tabindex="-1" aria-hidden="true">
      <div class="modal-dialog modal-dialog-scrollable">
        <div class="modal-content">
          <div class="modal-header"><h5 class="modal-title" id="plPickTitle"></h5><button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="${esc(EX.close)}"></button></div>
          <div class="modal-body">
            <p class="small ev-muted">${esc(EX.plPickHint)}</p>
            <div class="pa-search"><i class="bi bi-search"></i><input class="form-control" id="plPickSearch" placeholder="${esc(EX.plPickSearch)}" autocomplete="off" /></div>
            <div id="plPickList" class="pa-list"></div>
          </div>
        </div>
      </div>
    </div>`);
  const el = document.getElementById("plPick");
  pickModal = new bootstrap.Modal(el);
  el.querySelector("#plPickSearch").addEventListener("input", renderPickList);
  el.querySelector("#plPickList").addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-uid]");
    if (!b || !state.pick) return;
    const prof = state.profiles.find((p) => p.id === b.dataset.uid);
    const { team, player } = state.pick;
    if (!prof || !confirm(exf(EX.plConfirm, { profile: prof.name || prof.id, player: player.name, team: team.name }))) return;
    pickModal.hide();
    act(async () => {
      await assignPlayerAccount(state.pl.event, team, player, prof);
      await loadPlayersEvent(state.pl.eventId);
    }, exf(EX.plAssigned, { name: player.name }), { reload: false });
  });
  return pickModal;
}

function renderPickList() {
  const { team, player } = state.pick;
  const raw = document.getElementById("plPickSearch").value.trim();
  // link del perfil (…perfil.html?u=UID) o uid pegado
  const uidFromLink = (raw.match(/[?&]u=([^&#\s]+)/) || [])[1];
  const q = norm(uidFromLink ? "" : raw);
  const taken = new Set((team.players || []).filter((p) => p.uid && p.id !== player.id).map((p) => p.uid));
  let shown;
  if (uidFromLink || /^[A-Za-z0-9]{20,}$/.test(raw)) {
    const uid = decodeURIComponent(uidFromLink || raw);
    shown = state.profiles.filter((p) => p.id === uid);
  } else if (q) {
    shown = state.profiles.filter((p) => norm(p.name).includes(q)).slice(0, 40);
  } else {
    shown = state.profiles
      .map((p) => ({ p, s: nameScore(player.name, p.name) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, 8)
      .map((x) => x.p);
  }
  const list = document.getElementById("plPickList");
  list.innerHTML = `${!q && !uidFromLink && shown.length ? `<div class="pa-row pa-label mb-0">${esc(EX.plSuggested)}</div>` : ""}
    ${shown.map((p) => `
      <div class="pa-row">
        ${avatarHtml(p, 36)}
        <div class="flex-grow-1 min-w-0">
          <div class="fw-semibold text-truncate">${esc(p.name || "—")}${p.number !== null && p.number !== undefined && p.number !== "" ? ` <span class="ev-muted">#${esc(p.number)}</span>` : ""}</div>
          <div class="small ev-muted text-truncate">${esc(p.id)}${taken.has(p.id) ? ` · ${esc(EX.plTaken)}` : ""}</div>
        </div>
        <button class="btn btn-sm btn-primary" data-uid="${esc(p.id)}" ${taken.has(p.id) ? "disabled" : ""}>${esc(EX.plChoose)}</button>
      </div>`).join("") || `<div class="pa-row small ev-muted">${esc(EX.plNoProfiles)}</div>`}`;
}

function openPicker(team, player) {
  state.pick = { team, player };
  ensurePickModal();
  document.getElementById("plPickTitle").textContent = exf(EX.plPickTitle, { name: player.name });
  document.getElementById("plPickSearch").value = "";
  renderPickList();
  pickModal.show();
}

/* =========================
   Página
========================= */
function render() {
  const { pending, active } = state;
  if (!state.tab) state.tab = pending.length ? "pending" : "active";
  const trial = active.filter((e) => e.approval?.plan !== "paid").length;
  const paid = active.length - trial;
  const soon = active.filter((e) => {
    const d = daysLeft(e.approval?.expiresAt);
    return d !== null && d <= 7;
  }).length;
  const q = state.search.trim().toLowerCase();
  const shown = q ? active.filter((e) => [e.name, e.ownerName, e.ownerEmail, e.venue].join(" ").toLowerCase().includes(q)) : active;
  const stat = (n, label, icon, cls = "") => `<div class="pa-stat ${cls}"><i class="bi ${icon}"></i><div><div class="pa-stat__n">${n}</div><div class="pa-stat__l">${esc(label)}</div></div></div>`;

  root.innerHTML = `
    <section class="pa-hero">
      <div>
        <div class="pa-hero__eyebrow"><i class="bi bi-shield-lock"></i> ${esc(EX.adPlatform)}</div>
        <h1>${esc(EX.adminTitle)}</h1>
        <div class="opacity-75">${esc(EX.adminSubtitle)}</div>
      </div>
      <div class="pa-stats">
        ${stat(pending.length, EX.adminPending, "bi-hourglass-split", pending.length ? "is-hot" : "")}
        ${stat(active.length, EX.adminActive, "bi-lightning-charge")}
        ${stat(trial, EX.planTrial, "bi-gift")}
        ${stat(paid, EX.planPaid, "bi-credit-card")}
        ${stat(soon, EX.adSoon, "bi-clock", soon ? "is-warn" : "")}
      </div>
    </section>

    <nav class="tp-tabs my-3" role="tablist">
      <button class="tp-tab ${state.tab === "pending" ? "is-active" : ""}" data-pa-tab="pending"><i class="bi bi-inbox"></i> ${esc(EX.adminPending)} <span class="pa-count">${pending.length}</span></button>
      <button class="tp-tab ${state.tab === "active" ? "is-active" : ""}" data-pa-tab="active"><i class="bi bi-check2-circle"></i> ${esc(EX.adminActive)} <span class="pa-count">${active.length}</span></button>
      <button class="tp-tab ${state.tab === "import" ? "is-active" : ""}" data-pa-tab="import"><i class="bi bi-cloud-download"></i> ${esc(EX.adTabImport)}</button>
      <button class="tp-tab ${state.tab === "players" ? "is-active" : ""}" data-pa-tab="players"><i class="bi bi-person-badge"></i> ${esc(EX.adTabPlayers)}</button>
    </nav>

    ${state.tab === "import" ? importTab() : state.tab === "players" ? playersTab() : state.tab === "pending"
      ? (pending.length ? `<div class="d-grid gap-3">${pending.map(pendingCard).join("")}</div>`
        : `<div class="pa-empty"><div class="display-6">🎉</div><div class="fw-bold mt-2">${esc(EX.adminNoPending)}</div><div class="small ev-muted">${esc(EX.adAllCaughtUp)}</div></div>`)
      : `
        <div class="pa-search">
          <i class="bi bi-search"></i>
          <input class="form-control" id="paSearch" placeholder="${esc(EX.adSearch)}" value="${esc(state.search)}" />
        </div>
        ${shown.length ? `<div class="pa-list">${shown.map(activeRow).join("")}</div>` : `<div class="pa-empty small ev-muted">${esc(EX.adNoActive)}</div>`}`}`;
}

async function reload() {
  const [pending, active] = await Promise.all([listApprovalRequests(), listApprovedEvents()]);
  state.pending = pending;
  state.active = active;
  render();
}

async function act(fn, msg = EX.saved, { reload: doReload = true } = {}) {
  showLoader();
  try {
    await fn();
    alertBox(msg);
    if (doReload) await reload();
    else render();
  } catch (err) {
    console.error(err);
    alertBox(`${EX.error} ${err?.code || ""}`, "danger");
  } finally {
    hideLoader();
  }
}

root.addEventListener("submit", (ev) => {
  const form = ev.target.closest("[data-event]");
  if (!form) return;
  ev.preventDefault();
  const id = form.dataset.event;
  const f = (k) => form.querySelector(`[data-f=${k}]`).value.trim();
  const plan = form.querySelector(`input[name="plan-${CSS.escape(id)}"]:checked`)?.value || "trial";
  act(() => setApproval(id, {
    status: APPROVAL.APPROVED,
    plan,
    expiresAt: f("expires") ? new Date(`${f("expires")}T23:59:59`) : null,
    adminNote: f("note"),
  }), EX.adApproved);
});

async function openTab(tab, eventId = "") {
  state.tab = tab;
  history.replaceState(null, "", `#${tab}`);
  if (tab === "import" && state.bundled === null) {
    render();
    state.bundled = await listBundledImports().catch(() => []);
  }
  if (tab === "players" && (eventId || !state.pl.event)) {
    showLoader();
    try {
      await loadPlayersEvent(eventId);
    } finally {
      hideLoader();
    }
  }
  render();
}

root.addEventListener("click", (ev) => {
  const tab = ev.target.closest("[data-pa-tab]");
  if (tab) return openTab(tab.dataset.paTab).catch((err) => alertBox(`${EX.error} ${err?.code || err?.message || ""}`, "danger"));
  const tool = ev.target.closest("[data-act]");
  if (tool?.dataset.act === "pickBundled") {
    return act(async () => pickImport(await loadBundledImport(tool.dataset.file), tool.dataset.file), "", { reload: false });
  }
  if (tool?.dataset.act === "runImport") {
    const data = state.imp.data;
    tool.disabled = true;
    return act(async () => {
      state.done = await importTournament(data, (msg) => {
        state.progress = msg;
        const el = document.getElementById("imProgress");
        if (el) el.textContent = msg;
      });
      state.progress = EX.imDone;
      state.imp.exists = true;
      state.pl.event = null; // vuelve a leer equipos al abrir Jugadores
    }, EX.imDone);
  }
  if (tool?.dataset.act === "goAssign") return openTab("players", tool.dataset.id);
  if (tool?.dataset.act === "linkSquad" || tool?.dataset.act === "unlinkSquad") {
    const holder = tool.closest("[data-team]");
    const team = state.pl.teams.find((t) => t.id === holder.dataset.team);
    if (!team) return;
    if (tool.dataset.act === "linkSquad") {
      const squad = state.squads.find((x) => x.id === holder.querySelector("[data-f=squad]").value);
      if (!squad || !confirm(exf(EX.plLinkConfirm, { team: team.name, squad: squad.name }))) return;
      return act(async () => {
        await linkTeamToSquad(state.pl.event, team, squad);
        await loadPlayersEvent(state.pl.eventId);
      }, EX.plLinkedOk, { reload: false });
    }
    const squad = state.squads.find((x) => x.id === team.squadId);
    if (!confirm(exf(EX.plUnlinkConfirm, { team: team.name, squad: squad?.name || "" }))) return;
    return act(async () => {
      await unlinkTeamFromSquad(state.pl.event, team);
      await loadPlayersEvent(state.pl.eventId);
    }, EX.saved, { reload: false });
  }
  if (tool?.dataset.act === "assign" || tool?.dataset.act === "unassign") {
    const row = tool.closest("[data-player]");
    const team = state.pl.teams.find((t) => t.id === row.dataset.team);
    const player = team?.players.find((p) => p.id === row.dataset.player);
    if (!player) return;
    if (tool.dataset.act === "assign") return openPicker(team, player);
    if (!confirm(exf(EX.plUnassignConfirm, { name: player.name }))) return;
    return act(async () => {
      await unassignPlayerAccount(state.pl.event, team, player);
      await loadPlayersEvent(state.pl.eventId);
    }, EX.plUnassigned, { reload: false });
  }
  // vencimiento rápido: +14 / +30 días o sin vencimiento
  const preset = ev.target.closest("[data-days]");
  if (preset) {
    const form = preset.closest("[data-event]");
    form.querySelectorAll("[data-days]").forEach((b) => b.classList.toggle("is-active", b === preset));
    form.querySelector("[data-f=expires]").value = preset.dataset.days ? isoIn(Number(preset.dataset.days)) : "";
    return;
  }
  const btn = ev.target.closest("[data-act]");
  if (!btn) return;
  const holder = btn.closest("[data-event]");
  const note = holder.querySelector?.("[data-f=note]")?.value.trim() || "";
  if (btn.dataset.act === "reject" && confirm(EX.adRejectConfirm)) act(() => setApproval(holder.dataset.event, { status: APPROVAL.REJECTED, adminNote: note }));
  if (btn.dataset.act === "revoke" && confirm(EX.adRevokeConfirm)) act(() => setApproval(holder.dataset.event, { status: APPROVAL.NONE }));
});

root.addEventListener("change", (ev) => {
  if (ev.target.id === "imFile" && ev.target.files[0]) {
    const file = ev.target.files[0];
    act(async () => pickImport(JSON.parse(await file.text()), file.name), "", { reload: false });
  }
  if (ev.target.id === "plEvent") act(() => loadPlayersEvent(ev.target.value), "", { reload: false });
  if (ev.target.name === "plFilter") {
    state.pl.onlyFree = ev.target.value === "free";
    render();
  }
});

root.addEventListener("input", (ev) => {
  if (ev.target.id === "plSearch") {
    state.pl.search = ev.target.value;
    const pos = ev.target.selectionStart;
    render();
    const input = document.getElementById("plSearch");
    input.focus();
    input.setSelectionRange(pos, pos);
    return;
  }
  if (ev.target.id === "paSearch") {
    state.search = ev.target.value;
    const pos = ev.target.selectionStart;
    render();
    const input = document.getElementById("paSearch");
    input.focus();
    input.setSelectionRange(pos, pos);
  }
  if (ev.target.dataset.f === "expires") {
    ev.target.closest("[data-event]").querySelectorAll("[data-days]").forEach((b) => b.classList.remove("is-active"));
  }
});

(async function init() {
  showLoader();
  try {
    const user = await waitForUser();
    const admin = isGoogleUser(user) && (await isPlatformAdmin(user.uid));
    renderNav({ active: "admin", user, isAdmin: admin });
    if (!admin) {
      root.innerHTML = `<div class="pa-empty"><div class="display-6">🔒</div><div class="fw-bold mt-2">${esc(EX.adminOnly)}</div></div>`;
      return;
    }
    await reload();
    if (state.tab === "import" || state.tab === "players") await openTab(state.tab);
  } catch (err) {
    console.error("[admin]", err);
    alertBox(`${EX.error} ${err?.code || ""}`, "danger");
  } finally {
    hideLoader();
  }
})();
