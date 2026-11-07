// /tournaments/js/admin.js
// Admin de la plataforma: aprobar torneos (prueba gratis o pagado), rechazar y desactivar.
// Un admin es quien tenga un doc en platform_admins/{uid} (se crea a mano en la consola de Firebase).
import { EX, exf } from "/tournaments/js/strings.js";
import { APPROVAL, deleteMigrationRequest, isPlatformAdmin, listApprovalRequests, listApprovedEvents, listDraftEvents, listMigrationRequests, listTeams, setApproval, setMigrationStatus } from "/tournaments/js/services.js";
import {
  approveClaimRequest,
  assignPlayerAccount,
  importPreview,
  importTournament,
  linkTeamToSquad,
  listAllProfiles,
  listAllSquads,
  listBundledImports,
  listClaimRequests,
  loadBundledImport,
  rejectClaimRequest,
  repairEventClaims,
  unassignPlayerAccount,
  unlinkTeamFromSquad,
  validateImport,
} from "/tournaments/js/imports.js";
import { listClubDirectory, profileUrl, squadUrl } from "/tournaments/js/squads.js";
import { ORG_KINDS, SOON_DAYS, addMonths, addOrgEmail, createOrgForEmail, endOfDay, isEmail, listAllOrgs, pickupAccess, setOrgPickups } from "/tournaments/js/orgs.js";
import { PK, pkf } from "/tournaments/js/pickups_strings.js";
import { countryName, countryOptions, flagOf } from "/tournaments/js/countries.js";
import { normName } from "/tournaments/js/names.js";
import { sameName } from "/tournaments/js/names.js";
import { askConfirm, avatarHtml, esc, eventUrl, fmtDateRange, fmtWhen, hideLoader, isGoogleUser, playerLabel, renderNav, setAdminMode, showLoader, teamBadge, toMillis, waitForUser } from "/tournaments/js/ui.js";

const root = document.getElementById("tnRoot");
const TABS = ["pending", "drafts", "active", "clubs", "orgs", "migrations", "import", "players"];
const HASH_TAB = TABS.includes(location.hash.slice(1)) ? location.hash.slice(1) : "";
const state = {
  pending: [],
  drafts: [], // creados sin pedir aprobación (o rechazados): el admin los puede activar igual
  active: [],
  tab: HASH_TAB,
  search: "",
  clubs: null, // pestaña Clubes (se carga al abrirla)
  clubQ: "",
  orgs: null, // pestaña Organizaciones (permiso de pickups)
  orgQ: "",
  migrations: [], // pedidos de migración desde otras plataformas
  // importar
  bundled: null,
  imp: null, // { data, preview, exists, label }
  progress: "",
  done: null, // { eventId, slug }
  // jugadores sin cuenta
  pl: { eventId: "", event: null, teams: [], onlyFree: true, search: "", open: new Set() },
  np: { days: 7, noTeam: false, more: false }, // jugadores nuevos (registros recientes)
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
  const d = Math.round(h / 24);
  return d === 1 ? EX.adAgoDay : exf(EX.adAgoDays, { n: d });
}

const daysLeft = (v) => {
  const ms = toMillis(v);
  return ms ? Math.ceil((ms - Date.now()) / DAY) : null;
};

const isoIn = (days) => new Date(Date.now() + days * DAY).toISOString().slice(0, 10);

const thumb = (e, size = 64) => (e.image || e.logo
  ? `<div class="pa-thumb" style="width:${size}px;height:${size}px;background-image:url('${esc(e.image || e.logo)}')"></div>`
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
// panel del organizador de cualquier torneo (como admin)
const editEventUrl = (id) => `/tournaments/organize.html?${new URLSearchParams({ id })}`;

// Pestaña Clubes: todos los clubes, para entrar a editarlos como admin
function waLink(phone, text) {
  let digits = String(phone || "").replace(/\D/g, "");
  if (digits.length === 8) digits = `506${digits}`; // número tico sin código de país
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}

function migrationsTab() {
  const rows = state.migrations;
  return `
    <div class="small ev-muted mb-2">${esc(EX.adMigHint)}</div>
    ${rows.length ? `<div class="pa-list">${rows.map((r) => {
      const done = r.status === "done";
      return `
      <div class="pa-row ${done ? "opacity-50" : ""}" data-mig="${esc(r.id)}">
        <div class="flex-grow-1 min-w-0">
          <div class="d-flex align-items-center gap-2 flex-wrap">
            <span class="fw-bold">${esc(r.name || r.email || "—")}</span>
            <span class="ev-chip ${done ? "" : "dir-chip-hat"}">${esc(done ? EX.adMigDoneTag : EX.adMigNew)}</span>
            <span class="small ev-muted">${esc(ago(r.createdAt))}</span>
          </div>
          <a class="small d-block text-truncate" href="${esc(r.link)}" target="_blank" rel="noopener noreferrer">${esc(r.link)}</a>
          <div class="small"><i class="bi bi-whatsapp me-1"></i>${esc(r.phone)}${r.email ? ` · ${esc(r.email)}` : ""}</div>
          ${r.notes ? `<div class="small ev-muted mt-1">${esc(r.notes)}</div>` : ""}
        </div>
        <div class="d-flex gap-1 flex-shrink-0 flex-wrap justify-content-end">
          <a class="btn btn-sm btn-success" href="${esc(waLink(r.phone, EX.adMigWa))}" target="_blank" rel="noopener" title="WhatsApp"><i class="bi bi-whatsapp"></i></a>
          <button class="btn btn-sm ${done ? "btn-light" : "btn-admin"}" data-act="${done ? "migReopen" : "migDone"}"><i class="bi ${done ? "bi-arrow-counterclockwise" : "bi-check2"}"></i><span class="d-none d-sm-inline ms-1">${esc(done ? EX.adMigReopen : EX.adMigDone)}</span></button>
          <button class="btn btn-sm btn-light" data-act="migDelete" title="${esc(EX.delete || "Borrar")}"><i class="bi bi-trash"></i></button>
        </div>
      </div>`;
    }).join("")}</div>` : `<div class="pa-empty small ev-muted">${esc(EX.adNoMigrations)}</div>`}`;
}

// Permiso de pickups: activo hasta una fecha (se cobra por mes), con aviso cuando vence
const pad2 = (n) => String(n).padStart(2, "0");
const dateValue = (ms) => { if (!ms) return ""; const d = new Date(ms); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; };
const fmtDay = (ms) => fmtWhen(ms, { day: "numeric", month: "short", year: "numeric" });

function accessChip(acc) {
  if (acc.state === "off") return `<span class="ev-chip">${esc(PK.accOff)}</span>`;
  if (acc.state === "expired") return `<span class="ev-chip ev-chip--bad">${esc(pkf(PK.accExpired, { date: fmtDay(acc.until) }))}</span>`;
  if (acc.state === "soon") return `<span class="ev-chip ev-chip--wait">${esc(acc.days <= 0 ? PK.accToday : acc.days === 1 ? PK.accSoon1 : pkf(PK.accSoon, { n: acc.days }))}</span>`;
  return `<span class="ev-chip ev-chip--ok">${esc(acc.until ? pkf(PK.accUntil, { date: fmtDay(acc.until) }) : `${PK.accOn} · ${PK.accNoEnd}`)}</span>`;
}

function remindHref(o, acc) {
  const text = pkf(acc.state === "expired" ? PK.adRemindTextExpired : PK.adRemindText, { name: o.name || "", date: fmtDay(acc.until) });
  if (o.contactPhone) return waLink(o.contactPhone, text);
  if (o.ownerEmail) return `mailto:${encodeURIComponent(o.ownerEmail)}?subject=${encodeURIComponent(PK.adRemindSubject)}&body=${encodeURIComponent(text)}`;
  return "";
}

const orgAlerts = () => {
  const accs = (state.orgs || []).map((o) => pickupAccess(o).state);
  return { soon: accs.filter((x) => x === "soon").length, expired: accs.filter((x) => x === "expired").length };
};

function grantCard() {
  return `
    <details class="ev-card mb-3" ${state.grantOpen ? "open" : ""} id="paGrant">
      <summary class="fw-bold"><i class="bi bi-person-plus me-1"></i>${esc(PK.adGrantTitle)}</summary>
      <div class="small ev-muted mt-2 mb-3">${esc(PK.adGrantLead)}</div>
      <div class="row g-2">
        <div class="col-12 col-md-6"><label class="form-label small fw-semibold" for="grEmail">${esc(PK.adEmail)}</label><input class="form-control" id="grEmail" type="email" autocomplete="off" placeholder="nombre@gmail.com" /></div>
        <div class="col-12 col-md-6"><label class="form-label small fw-semibold" for="grName">${esc(PK.adGrantName)}</label><input class="form-control" id="grName" maxlength="80" placeholder="${esc(PK.orgNamePh)}" /></div>
        <div class="col-6 col-md-3"><label class="form-label small fw-semibold" for="grKind">${esc(PK.orgKind)}</label><select class="form-select" id="grKind">${ORG_KINDS.map((k) => `<option value="${k}">${esc(PK.orgKinds[k])}</option>`).join("")}</select></div>
        <div class="col-6 col-md-3"><label class="form-label small fw-semibold" for="grCountry">${esc(PK.orgCountry)}</label><select class="form-select" id="grCountry">${countryOptions("CR", esc(PK.orgCountryPick))}</select></div>
        <div class="col-6 col-md-3"><label class="form-label small fw-semibold" for="grPhone">${esc(PK.adGrantPhone)}</label><input class="form-control" id="grPhone" type="tel" placeholder="8888 8888" /></div>
        <div class="col-6 col-md-3"><label class="form-label small fw-semibold" for="grUntil">${esc(PK.adUntil)}</label><input class="form-control" id="grUntil" type="date" value="${dateValue(addMonths(Date.now()))}" /></div>
      </div>
      <div class="d-flex justify-content-end mt-3"><button class="btn btn-admin" data-org-grant><i class="bi bi-check2 me-1"></i>${esc(PK.adGrantBtn)}</button></div>
      ${state.grantDone ? `<div class="pk-note mt-3 d-flex align-items-center gap-2 flex-wrap"><span class="flex-grow-1">${esc(state.grantDone.msg)}</span><a class="btn btn-sm btn-light" href="${esc(state.grantDone.href)}" target="_blank" rel="noopener"><i class="bi ${state.grantDone.phone ? "bi-whatsapp" : "bi-envelope"} me-1"></i>${esc(PK.adGrantShare)}</a></div>` : ""}
    </details>`;
}

function orgsTab() {
  if (state.orgs === null) return `<div class="pa-empty small ev-muted">${esc(EX.loading)}</div>`;
  const words = normName(state.orgQ).split(/\s+/).filter(Boolean);
  const hay = (o) => normName([o.name, o.city, o.country, countryName(o.country), o.ownerEmail, ...(o.pendingEmails || [])].filter(Boolean).join(" "));
  // primero las vencidas y las que vencen pronto
  const rank = { expired: 0, soon: 1, on: 2, off: 3 };
  const shown = state.orgs
    .filter((o) => words.every((w) => hay(o).includes(w)))
    .map((o) => ({ o, acc: pickupAccess(o) }))
    .sort((a, b) => rank[a.acc.state] - rank[b.acc.state] || String(a.o.name).localeCompare(String(b.o.name)));
  const al = orgAlerts();
  return `
    ${al.soon || al.expired ? `
      <div class="pk-note pk-note--review mb-3"><i class="bi bi-bell me-1"></i><b>${esc([al.expired ? pkf(PK.adAlertExpired, { n: al.expired }) : "", al.soon ? pkf(PK.adAlertSoon, { n: al.soon }) : ""].filter(Boolean).join(" · "))}.</b> ${esc(PK.adAlertHint)}</div>` : ""}
    ${grantCard()}
    <div class="small ev-muted mb-2">${esc(PK.adOrgsHint)}</div>
    <div class="pa-search">
      <i class="bi bi-search"></i>
      <input class="form-control" id="paOrgQ" placeholder="${esc(PK.adOrgSearch)}" value="${esc(state.orgQ)}" />
    </div>
    ${shown.length ? `<div class="pa-list">${shown.map(({ o, acc }) => {
      const n = (o.ownerUids || []).length;
      const on = acc.state !== "off";
      const remind = (acc.state === "soon" || acc.state === "expired") && remindHref(o, acc);
      const pending = (o.pendingEmails || []).map((e) => pkf(PK.adPending, { email: e }));
      return `
      <div class="pa-row flex-wrap">
        ${teamBadge({ id: o.id, name: o.name, logo: o.logo, color: o.color }, 44)}
        <div class="flex-grow-1 min-w-0">
          <span class="fw-bold">${esc(o.name || "—")}</span>
          <div class="small ev-muted text-truncate">${esc([PK.orgKinds[o.kind], o.country ? `${flagOf(o.country)} ${[o.city, countryName(o.country)].filter(Boolean).join(", ")}` : o.city, n === 1 ? PK.adOrgAdmin1 : pkf(PK.adOrgAdmins, { n }), o.ownerEmail].filter(Boolean).join(" · "))}</div>
          ${pending.length ? `<div class="small text-warning-emphasis">${esc(pending.join(" · "))}</div>` : ""}
        </div>
        ${accessChip(acc)}
        <div class="w-100 d-flex align-items-center gap-2 flex-wrap ps-sm-5">
          <div class="form-check form-switch m-0" title="${esc(PK.adPickups)}">
            <input class="form-check-input" type="checkbox" role="switch" id="org-${esc(o.id)}" data-org-pk="${esc(o.id)}" ${on ? "checked" : ""} />
            <label class="form-check-label small" for="org-${esc(o.id)}">${esc(PK.adPickups)}</label>
          </div>
          <label class="small ev-muted d-flex align-items-center gap-1 m-0" title="${esc(PK.adUntilHint)}">${esc(PK.adUntil)}
            <input class="form-control form-control-sm" style="width:auto" type="date" data-org-until="${esc(o.id)}" value="${dateValue(acc.until)}" />
          </label>
          <button class="btn btn-sm btn-light" data-org-month="${esc(o.id)}"><i class="bi bi-calendar-plus me-1"></i>${esc(PK.adMonth)}</button>
          ${remind ? `<a class="btn btn-sm btn-warning" href="${esc(remind)}" target="_blank" rel="noopener"><i class="bi ${o.contactPhone ? "bi-whatsapp" : "bi-envelope"} me-1"></i>${esc(PK.adRemind)}</a>` : ""}
          <button class="btn btn-sm btn-light" data-org-email="${esc(o.id)}" title="${esc(PK.adAddEmail)}" aria-label="${esc(PK.adAddEmail)}"><i class="bi bi-person-plus"></i></button>
          <a class="btn btn-sm btn-admin" href="/pickups/organize.html?org=${esc(o.id)}&tab=profile" title="${esc(EX.edit)}"><i class="bi bi-pencil"></i><span class="d-none d-sm-inline ms-1">${esc(EX.edit)}</span></a>
        </div>
      </div>`;
    }).join("")}</div>` : `<div class="pa-empty small ev-muted">${esc(PK.adNoOrgs)}</div>`}`;
}

function clubsTab() {
  if (state.clubs === null) return `<div class="pa-empty small ev-muted">${esc(EX.loading)}</div>`;
  const words = normName(state.clubQ).split(/\s+/).filter(Boolean);
  const hay = (c) => normName([c.squad.name, c.squad.city, c.squad.country, countryName(c.squad.country)].filter(Boolean).join(" "));
  const shown = state.clubs.filter((c) => words.every((w) => hay(c).includes(w)));
  return `
    <div class="small ev-muted mb-2">${esc(EX.adClubsHint)}</div>
    <div class="pa-search">
      <i class="bi bi-search"></i>
      <input class="form-control" id="paClubQ" placeholder="${esc(EX.adClubSearch)}" value="${esc(state.clubQ)}" />
    </div>
    ${shown.length ? `<div class="pa-list">${shown.map(({ squad: q, players, tournaments }) => `
      <div class="pa-row">
        ${teamBadge(q, 44)}
        <div class="flex-grow-1 min-w-0">
          <a class="fw-bold text-decoration-none" href="${esc(squadUrl(q.id))}">${esc(q.name || "—")}</a>
          <div class="small ev-muted text-truncate">${esc([q.country ? `${flagOf(q.country)} ${[q.city, countryName(q.country)].filter(Boolean).join(", ")}` : q.city, players === 1 ? EX.clPlayer : exf(EX.clPlayers, { n: players }), tournaments === 1 ? EX.clTournament : exf(EX.clTournaments, { n: tournaments })].filter(Boolean).join(" · "))}</div>
        </div>
        <div class="d-flex gap-1 flex-shrink-0">
          <a class="btn btn-sm btn-light" href="${esc(squadUrl(q.id))}" title="${esc(EX.openPublic)}"><i class="bi bi-eye"></i></a>
          <a class="btn btn-sm btn-admin" href="${esc(`${squadUrl(q.id)}&tab=admin`)}" title="${esc(EX.adEditClub)}"><i class="bi bi-pencil"></i><span class="d-none d-sm-inline ms-1">${esc(EX.edit)}</span></a>
        </div>
      </div>`).join("")}</div>` : `<div class="pa-empty small ev-muted">${esc(EX.adNoClubs)}</div>`}`;
}

function pendingCard(e) {
  const id = e.id;
  return `
    <form class="pa-card" data-event="${esc(id)}">
      <div class="pa-card__top">
        ${thumb(e, 72)}
        <div class="flex-grow-1 min-w-0">
          <div class="d-flex justify-content-between align-items-start gap-2 flex-wrap">
            <a class="pa-card__name" href="${esc(eventUrl({ id }))}" target="_blank" rel="noopener">${esc(e.name || "—")} <i class="bi bi-box-arrow-up-right small"></i></a>
            <a class="btn btn-sm btn-admin" href="${esc(editEventUrl(id))}"><i class="bi bi-pencil me-1"></i>${esc(EX.adEditEvent)}</a>
            ${e.approval?.status === APPROVAL.REQUESTED
              ? `<span class="pa-pill pa-pill--wait"><i class="bi bi-hourglass-split"></i> ${esc(ago(e.approval?.requestedAt) || EX.adminPending)}</span>`
              : `<span class="pa-pill"><i class="bi ${e.approval?.status === APPROVAL.REJECTED ? "bi-x-circle" : "bi-pencil"}"></i> ${esc(e.approval?.status === APPROVAL.REJECTED ? EX.adDraftRejected : EX.adDraftNotRequested)}${e.createdAt ? ` · ${esc(ago(e.createdAt))}` : ""}</span>`}
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
        <a class="btn btn-sm btn-admin" href="${esc(editEventUrl(e.id))}" title="${esc(EX.adEditEvent)}"><i class="bi bi-pencil"></i><span class="d-none d-sm-inline ms-1">${esc(EX.edit)}</span></a>
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

// cuenta con el mismo nombre que todavía no juega en este torneo (sugerencia para vincular)
function suggestedProfile(player) {
  const used = new Set(state.pl.teams.flatMap((t) => (t.players || []).map((p) => p.uid)).filter(Boolean));
  return (state.profiles || []).find((prof) => !used.has(prof.id) && sameName(player.name, prof.name)) || null;
}

// pedidos "soy yo" que mandaron los jugadores desde su perfil
function claimRequestsSection() {
  const reqs = state.claimReqs || [];
  if (!reqs.length) return "";
  return `
    <section class="ev-card mb-3 cl-admin">
      <h2 class="h6 fw-bold mb-1"><i class="bi bi-person-raised-hand me-1"></i>${esc(exf(EX.clmAdminTitle, { n: reqs.length }))}</h2>
      <p class="small ev-muted mb-2">${esc(EX.clmAdminSub)}</p>
      <div class="pa-list">
        ${reqs.map((r) => `
          <div class="pa-row">
            ${avatarHtml({ name: r.profileName, photoURL: r.photoURL }, 36)}
            <div class="flex-grow-1 min-w-0">
              <div class="text-truncate">${exf(esc(EX.clmAdminLine), { profile: `<a class="fw-semibold text-decoration-none" href="${esc(profileUrl(r.uid))}" target="_blank" rel="noopener">${esc(r.profileName || r.uid)}</a>`, player: `<b>${esc(r.playerName)}</b>` })}</div>
              <div class="small ev-muted text-truncate">${esc([r.teamName, r.eventName].filter(Boolean).join(" · "))}${r.at ? ` · ${esc(fmtWhen(r.at, { day: "numeric", month: "short" }))}` : ""}</div>
            </div>
            <button class="btn btn-sm btn-primary" data-act="claimOk" data-req="${esc(r.id)}"><i class="bi bi-check-lg me-1"></i>${esc(EX.clmApprove)}</button>
            <button class="btn btn-sm btn-outline-danger" data-act="claimNo" data-req="${esc(r.id)}">${esc(EX.clmReject)}</button>
          </div>`).join("")}
      </div>
    </section>`;
}

/* ----- Jugadores nuevos: cuentas creadas hace poco ----- */
const NP_PAGE = 15;

// equipos del jugador: los de su perfil (squadIds) más los que administra (ownerUids); solo los que existen
function npTeams(prof) {
  const squads = state.squads || [];
  const ids = new Set(prof.squadIds || []);
  return squads.filter((s) => ids.has(s.id) || (s.ownerUids || []).includes(prof.id));
}

function newProfiles(days) {
  const since = days ? Date.now() - days * DAY : 0;
  return (state.profiles || [])
    .filter((p) => (days ? toMillis(p.createdAt) >= since : true))
    .sort((a, b) => (toMillis(b.createdAt) || 0) - (toMillis(a.createdAt) || 0));
}

const newThisWeek = () => (state.profiles ? newProfiles(7).length : 0);

function newPlayersSection() {
  if (!state.profiles) return "";
  const { days, noTeam, more } = state.np;
  const all = newProfiles(days).map((p) => ({ p, teams: npTeams(p) }));
  const lonely = all.filter((x) => !x.teams.length).length;
  const rows = noTeam ? all.filter((x) => !x.teams.length) : all;
  const shown = more ? rows : rows.slice(0, NP_PAGE);
  const seg = (v, label) => `
    <input type="radio" class="btn-check" name="npRange" id="npR${v}" value="${v}" ${days === v ? "checked" : ""} />
    <label class="btn" for="npR${v}">${esc(label)}</label>`;
  const row = ({ p, teams }) => {
    const made = teams.filter((s) => s.createdBy === p.id);
    const admin = teams.filter((s) => s.createdBy !== p.id && (s.ownerUids || []).includes(p.id));
    const member = teams.filter((s) => !(s.ownerUids || []).includes(p.id));
    const incomplete = !p.gender || !p.photoURL;
    const link = (s) => `<a class="text-decoration-none" href="${esc(squadUrl(s.id))}" target="_blank" rel="noopener">${esc(s.name || s.id)}</a>`;
    const when = toMillis(p.createdAt);
    return `
      <div class="pa-row">
        ${avatarHtml(p, 36)}
        <div class="flex-grow-1 min-w-0">
          <div class="d-flex align-items-center gap-2 flex-wrap">
            <a class="fw-semibold text-decoration-none text-truncate" href="${esc(profileUrl(p.id))}" target="_blank" rel="noopener">${esc(p.name || EX.npNoName)}</a>
            ${p.number != null && p.number !== "" ? `<span class="small ev-muted">#${esc(p.number)}</span>` : ""}
            ${p.gender ? `<span class="small ev-muted">${esc(p.gender)}</span>` : ""}
            <span class="small ev-muted" title="${esc(when ? fmtWhen(p.createdAt) : "")}">${esc(when ? ago(p.createdAt) : EX.npNoDate)}</span>
          </div>
          <div class="small d-flex flex-wrap gap-1 mt-1">
            ${made.map((s) => `<span class="pa-pill pa-pill--sugg"><i class="bi bi-plus-circle"></i> ${exf(esc(EX.npCreated), { team: link(s) })}</span>`).join("")}
            ${admin.map((s) => `<span class="pa-pill"><i class="bi bi-shield-check"></i> ${exf(esc(EX.npAdmin), { team: link(s) })}</span>`).join("")}
            ${member.map((s) => `<span class="pa-pill"><i class="bi bi-people"></i> ${link(s)}</span>`).join("")}
            ${teams.length ? "" : `<span class="pa-pill"><i class="bi bi-person"></i> ${esc(EX.npNoTeam)}</span>`}
            ${incomplete ? `<span class="pa-pill pa-pill--wait"><i class="bi bi-exclamation-circle"></i> ${esc(EX.npIncomplete)}</span>` : ""}
          </div>
        </div>
      </div>`;
  };
  return `
    <section class="ev-card mb-3">
      <h2 class="h5 fw-bold mb-1"><i class="bi bi-person-plus me-1"></i>${esc(EX.npTitle)}</h2>
      <p class="small ev-muted mb-2">${esc(EX.npSub)}</p>
      <div class="d-flex flex-wrap gap-2 align-items-center mb-2">
        <div class="pa-seg">${seg(7, EX.np7)}${seg(30, EX.np30)}${seg(0, EX.npAllTime)}</div>
        <div class="form-check form-switch mb-0">
          <input class="form-check-input" type="checkbox" id="npNoTeam" ${noTeam ? "checked" : ""} />
          <label class="form-check-label small" for="npNoTeam">${esc(EX.npOnlyNoTeam)}</label>
        </div>
      </div>
      <div class="small ev-muted mb-2">${esc(exf(EX.npCount, { n: all.length, none: lonely }))}</div>
      ${shown.length ? `<div class="pa-list">${shown.map(row).join("")}</div>` : `<div class="pa-empty small ev-muted">${esc(EX.npEmpty)}</div>`}
      ${rows.length > NP_PAGE ? `<div class="text-center mt-2"><button class="btn btn-sm btn-link text-decoration-none" data-act="npMore">${esc(more ? EX.npLess : exf(EX.npMore, { n: rows.length - NP_PAGE }))}</button></div>` : ""}
    </section>`;
}

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
      const guess = p.uid ? null : suggestedProfile(p);
      return `
        <div class="pa-row" data-team="${esc(t.id)}" data-player="${esc(p.id)}">
          ${avatarHtml(prof || p, 36)}
          <div class="flex-grow-1 min-w-0">
            <div class="fw-semibold text-truncate">${esc(playerLabel(p))}${p.gender ? ` <span class="ev-muted small">${esc(p.gender)}</span>` : ""}</div>
            ${p.uid
              ? `<a class="small text-decoration-none" href="${esc(profileUrl(p.uid))}" target="_blank" rel="noopener"><i class="bi bi-person-check me-1"></i>${esc(prof?.name || p.uid)}</a>`
              : `<span class="pa-pill pa-pill--wait">${esc(EX.plFree)}</span>${guess ? `
                <span class="pa-pill pa-pill--sugg"><i class="bi bi-magic"></i> ${exf(esc(EX.clmGuess), { name: `<a href="${esc(profileUrl(guess.id))}" target="_blank" rel="noopener">${esc(guess.name)}</a>` })}</span>
                <button class="btn btn-sm btn-link p-0 align-baseline" data-act="suggestLink" data-uid="${esc(guess.id)}">${esc(EX.clmLinkIt)}</button>` : ""}`}
          </div>
          ${p.uid
            ? `<button class="btn btn-sm btn-outline-danger" data-act="unassign">${esc(EX.plUnassign)}</button>`
            : `<button class="btn btn-sm btn-primary" data-act="assign"><i class="bi bi-person-plus me-1"></i>${esc(EX.plAssign)}</button>`}
        </div>`;
    }).join("");
  // equipos plegados (solo el encabezado); al buscar se abren solos para ver los resultados
  const teamBlocks = teams.map((t) => {
    const r = rows(t);
    if (!r) return "";
    const tFree = (t.players || []).filter((p) => !p.uid).length;
    const open = !!q || state.pl.open.has(t.id);
    return `
      <section class="pa-list mb-2">
        <button type="button" class="pa-row pa-team-toggle w-100 text-start border-0" data-act="toggleTeam" data-id="${esc(t.id)}" aria-expanded="${open}">
          ${teamBadge(t, 32)}
          <div class="flex-grow-1 min-w-0 fw-bold text-truncate">${esc(t.name)}</div>
          <span class="pa-pill">${esc(exf(EX.plCount, { free: tFree, total: (t.players || []).length }))}</span>
          <i class="bi ${open ? "bi-chevron-up" : "bi-chevron-down"} ev-muted"></i>
        </button>
        ${open ? `
          <div class="pa-row small" data-team="${esc(t.id)}" style="background:#faf9fe">${squadLink(t)}</div>
          ${r}` : ""}
      </section>`;
  }).join("");
  const anyOpen = teams.some((t) => state.pl.open.has(t.id));
  const foldBar = teams.length > 1 && !q ? `
    <div class="d-flex justify-content-end mb-2">
      <button class="btn btn-sm btn-link text-decoration-none" data-act="${anyOpen ? "collapseTeams" : "expandTeams"}">
        <i class="bi ${anyOpen ? "bi-arrows-collapse" : "bi-arrows-expand"} me-1"></i>${esc(anyOpen ? EX.plCollapseAll : EX.plExpandAll)}
      </button>
    </div>` : "";
  return `
    ${claimRequestsSection()}
    ${newPlayersSection()}
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
    ${foldBar}
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
  // fichas asignadas que perdieron el uid (ej. roster editado): se reparan solas
  if (id) await repairEventClaims(id, teams).catch((err) => console.warn("[claims]", err));
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
      <button class="tp-tab ${state.tab === "drafts" ? "is-active" : ""}" data-pa-tab="drafts"><i class="bi bi-pencil-square"></i> ${esc(EX.adTabDrafts)} <span class="pa-count">${state.drafts.length}</span></button>
      <button class="tp-tab ${state.tab === "active" ? "is-active" : ""}" data-pa-tab="active"><i class="bi bi-trophy"></i> ${esc(EX.adTabEvents)} <span class="pa-count">${active.length}</span></button>
      <button class="tp-tab ${state.tab === "clubs" ? "is-active" : ""}" data-pa-tab="clubs"><i class="bi bi-shield"></i> ${esc(EX.adTabClubs)}${state.clubs ? ` <span class="pa-count">${state.clubs.length}</span>` : ""}</button>
      <button class="tp-tab ${state.tab === "orgs" ? "is-active" : ""}" data-pa-tab="orgs"><i class="bi bi-building"></i> ${esc(PK.adTabOrgs)}${state.orgs ? (orgAlerts().soon + orgAlerts().expired ? ` <span class="pa-count pa-count--alert">${orgAlerts().soon + orgAlerts().expired}</span>` : ` <span class="pa-count">${state.orgs.length}</span>`) : ""}</button>
      <button class="tp-tab ${state.tab === "migrations" ? "is-active" : ""}" data-pa-tab="migrations"><i class="bi bi-arrow-left-right"></i> ${esc(EX.adTabMigrations)}${state.migrations.some((r) => r.status !== "done") ? ` <span class="pa-count pa-count--alert">${state.migrations.filter((r) => r.status !== "done").length}</span>` : ""}</button>
      <button class="tp-tab ${state.tab === "import" ? "is-active" : ""}" data-pa-tab="import"><i class="bi bi-cloud-download"></i> ${esc(EX.adTabImport)}</button>
      <button class="tp-tab ${state.tab === "players" ? "is-active" : ""}" data-pa-tab="players"><i class="bi bi-person-badge"></i> ${esc(EX.adTabPlayers)}${state.claimReqs?.length ? ` <span class="pa-count pa-count--alert">${state.claimReqs.length}</span>` : newThisWeek() ? ` <span class="pa-count" title="${esc(EX.npTabHint)}">+${newThisWeek()}</span>` : ""}</button>
    </nav>

    ${state.tab === "import" ? importTab() : state.tab === "players" ? playersTab() : state.tab === "clubs" ? clubsTab() : state.tab === "migrations" ? migrationsTab() : state.tab === "orgs" ? orgsTab() : state.tab === "drafts"
      ? `<div class="small ev-muted mb-2">${esc(EX.adDraftsHint)}</div>${state.drafts.length ? `<div class="d-grid gap-3">${state.drafts.map(pendingCard).join("")}</div>`
        : `<div class="pa-empty small ev-muted">${esc(EX.adNoDrafts)}</div>`}`
      : state.tab === "pending"
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
  const [pending, active, claimReqs, drafts, migrations] = await Promise.all([listApprovalRequests(), listApprovedEvents(), listClaimRequests().catch(() => []), listDraftEvents().catch(() => []), listMigrationRequests().catch(() => [])]);
  state.migrations = migrations;
  state.pending = pending;
  state.drafts = drafts;
  state.active = active;
  state.claimReqs = claimReqs;
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
  if (tab === "orgs" && state.orgs === null) {
    render();
    state.orgs = await listAllOrgs().catch(() => []);
  }
  if (tab === "clubs" && state.clubs === null) {
    render();
    state.clubs = await listClubDirectory().catch(() => []);
  }
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
  if (tool?.dataset.act === "npMore") {
    state.np.more = !state.np.more;
    return render();
  }
  if (tool?.dataset.act === "toggleTeam") {
    const id = tool.dataset.id;
    if (state.pl.open.has(id)) state.pl.open.delete(id);
    else state.pl.open.add(id);
    return render();
  }
  if (tool?.dataset.act === "expandTeams" || tool?.dataset.act === "collapseTeams") {
    state.pl.open = tool.dataset.act === "expandTeams" ? new Set(state.pl.teams.map((t) => t.id)) : new Set();
    return render();
  }
  if (["migDone", "migReopen", "migDelete"].includes(tool?.dataset.act)) {
    const id = tool.closest("[data-mig]").dataset.mig;
    if (tool.dataset.act === "migDelete") {
      if (!confirm(EX.adMigDelete)) return;
      return act(() => deleteMigrationRequest(id), EX.saved);
    }
    return act(() => setMigrationStatus(id, tool.dataset.act === "migDone" ? "done" : "new"), EX.saved);
  }
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
  if (tool?.dataset.act === "claimOk" || tool?.dataset.act === "claimNo") {
    const req = (state.claimReqs || []).find((r) => r.id === tool.dataset.req);
    if (!req) return;
    const done = async () => {
      state.claimReqs = await listClaimRequests().catch(() => []);
      if (state.pl.eventId === req.eventId) await loadPlayersEvent(state.pl.eventId);
    };
    if (tool.dataset.act === "claimOk") {
      if (!confirm(exf(EX.plConfirm, { profile: req.profileName || req.uid, player: req.playerName, team: req.teamName }))) return;
      return act(async () => { await approveClaimRequest(req); await done(); }, exf(EX.plAssigned, { name: req.playerName }), { reload: false });
    }
    if (!confirm(exf(EX.clmRejectConfirm, { name: req.profileName || "" }))) return;
    return act(async () => { await rejectClaimRequest(req); await done(); }, EX.saved, { reload: false });
  }
  if (tool?.dataset.act === "suggestLink") {
    const row = tool.closest("[data-player]");
    const team = state.pl.teams.find((t) => t.id === row.dataset.team);
    const player = team?.players.find((p) => p.id === row.dataset.player);
    const prof = linkedProfile(tool.dataset.uid);
    if (!player || !prof) return;
    if (!confirm(exf(EX.plConfirm, { profile: prof.name || prof.id, player: player.name, team: team.name }))) return;
    return act(async () => {
      await assignPlayerAccount(state.pl.event, team, player, prof);
      await loadPlayersEvent(state.pl.eventId);
    }, exf(EX.plAssigned, { name: player.name }), { reload: false });
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
  if (ev.target.name === "npRange") {
    state.np.days = Number(ev.target.value);
    state.np.more = false;
    return render();
  }
  if (ev.target.id === "npNoTeam") {
    state.np.noTeam = ev.target.checked;
    state.np.more = false;
    return render();
  }
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
  if (ev.target.id === "paOrgQ") {
    state.orgQ = ev.target.value;
    const pos = ev.target.selectionStart;
    render();
    const input = document.getElementById("paOrgQ");
    input.focus();
    input.setSelectionRange(pos, pos);
    return;
  }
  if (ev.target.id === "paClubQ") {
    state.clubQ = ev.target.value;
    const pos = ev.target.selectionStart;
    render();
    const input = document.getElementById("paClubQ");
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

// Permiso de pickups por organización (con fecha de vencimiento)
const findOrg = (id) => (state.orgs || []).find((o) => o.id === id);
function savePickups(org, on, until, msg) {
  return act(async () => {
    await setOrgPickups(org.id, { on, until });
    org.features = { ...(org.features || {}), pickups: on, pickupsUntil: until ? { seconds: Math.floor(until / 1000) } : null };
  }, msg, { reload: false });
}

root.addEventListener("change", (ev) => {
  const t = ev.target;
  if (t.dataset?.orgPk) {
    const org = findOrg(t.dataset.orgPk);
    if (!org) return;
    const acc = pickupAccess(org);
    // al prender sin fecha (o vencida) se da un mes
    const until = t.checked && (!acc.until || acc.state === "expired") ? addMonths(Date.now()) : acc.until;
    return savePickups(org, t.checked, until, pkf(t.checked ? PK.adPickupsOn : PK.adPickupsOff, { name: org.name || "" }));
  }
  if (t.dataset?.orgUntil) {
    const org = findOrg(t.dataset.orgUntil);
    if (!org) return;
    const until = endOfDay(t.value);
    return savePickups(org, true, until, pkf(PK.adUntilOk, { name: org.name || "" }));
  }
});

root.addEventListener("click", async (ev) => {
  const month = ev.target.closest("[data-org-month]");
  if (month) {
    const org = findOrg(month.dataset.orgMonth);
    if (!org) return;
    const acc = pickupAccess(org);
    // se suma un mes desde la fecha actual de vencimiento (o desde hoy si ya venció)
    const until = addMonths(acc.until && acc.until > Date.now() ? acc.until : Date.now());
    return savePickups(org, true, until, pkf(PK.adMonthOk, { name: org.name || "", date: fmtDay(until) }));
  }
  const addEmail = ev.target.closest("[data-org-email]");
  if (addEmail) {
    const org = findOrg(addEmail.dataset.orgEmail);
    if (!org) return;
    const email = await askConfirm("", {
      title: PK.adAddEmail,
      ok: PK.plAddOk,
      html: `<div class="text-start"><label class="form-label small fw-semibold" for="aeEmail">${esc(PK.adEmail)}</label><input class="form-control" id="aeEmail" type="email" autocomplete="off" /></div>`,
      onOpen: (wrap) => wrap.querySelector("#aeEmail").focus(),
      read: (wrap) => wrap.querySelector("#aeEmail").value.trim(),
    });
    if (!email) return;
    if (!isEmail(email)) return alertBox(PK.adEmailBad, "warning");
    return act(async () => {
      org.pendingEmails = await addOrgEmail(org, email);
      org.ownerEmail = org.ownerEmail || email.toLowerCase();
    }, pkf(PK.adAddEmailOk, { email }), { reload: false });
  }
  if (ev.target.closest("[data-org-grant]")) {
    const v = (id) => document.getElementById(id).value.trim();
    const data = { email: v("grEmail"), name: v("grName"), kind: v("grKind"), country: v("grCountry"), contactPhone: v("grPhone"), until: endOfDay(v("grUntil")) };
    if (!data.email || !data.name) return alertBox(PK.adGrantMissing, "warning");
    if (!isEmail(data.email)) return alertBox(PK.adEmailBad, "warning");
    state.grantOpen = true;
    return act(async () => {
      await createOrgForEmail(state.me, data);
      state.orgs = await listAllOrgs();
      const text = pkf(PK.adGrantShareText, { name: data.name, email: data.email, url: `${location.origin}/pickups/organize.html` });
      state.grantDone = {
        msg: pkf(PK.adGrantOk, { name: data.name, email: data.email }),
        phone: !!data.contactPhone,
        href: data.contactPhone ? waLink(data.contactPhone, text) : `mailto:${encodeURIComponent(data.email)}?subject=${encodeURIComponent(PK.adRemindSubject)}&body=${encodeURIComponent(text)}`,
      };
    }, pkf(PK.adGrantOk, { name: data.name, email: data.email }), { reload: false });
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
    setAdminMode(true);
    state.me = user;
    await reload();
    // organizaciones: para el aviso de vencimientos en la pestaña (aunque no esté abierta)
    if (state.orgs === null) listAllOrgs().then((o) => { if (state.orgs === null) { state.orgs = o; render(); } }).catch(() => {});
    if (["import", "players", "clubs", "orgs"].includes(state.tab)) await openTab(state.tab);
  } catch (err) {
    console.error("[admin]", err);
    alertBox(`${EX.error} ${err?.code || ""}`, "danger");
  } finally {
    hideLoader();
  }
})();
