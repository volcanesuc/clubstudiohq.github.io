// /tournaments/js/squad_page.js
// Página del equipo (?s=ID). Pública: roster y torneos. Admins: editar datos, roster, capitanes,
// links de invitación (jugadores y co-admins), co-admins e inscripciones.
import { EX, exf } from "/tournaments/js/strings.js";
import { REG, isApproved, listPublicEvents, registrationIsOpen } from "/tournaments/js/services.js";
import {
  INVITE_ROLE,
  addSelfToRoster,
  deleteMember,
  getInvites,
  isSquadAdmin,
  joinUrl,
  leaveSquad,
  listMembers,
  listSquadNotices,
  listSquadTournaments,
  markNoticesRead,
  loadProfile,
  loadSquad,
  profileUrl,
  regenerateInvite,
  repairMemberLinks,
  pendingSpirit,
  squadResults,
  squadUrl,
  syncSquadRegistrations,
  saveMember,
  saveSquad,
  setOwners,
} from "/tournaments/js/squads.js";
import {
  avatarHtml,
  esc,
  eventUrl,
  fmtDateRange,
  hideLoader,
  isGoogleUser,
  refreshTeamBadge,
  regChip,
  renderNav,
  showLoader,
  spiritPendingHtml,
  teamBadge,
  waitForUser,
} from "/tournaments/js/ui.js";
import { isPlatformAdmin } from "/tournaments/js/services.js";
import { cropFromInput } from "/tournaments/js/cropper.js";
import { countryName, countryOptions, flagOf } from "/tournaments/js/countries.js";

const root = document.getElementById("tnRoot");
const $ = (sel) => root.querySelector(sel);
const SID = new URLSearchParams(location.search).get("s") || "";

const state = {
  user: null,
  squad: null,
  members: [],
  tournaments: [],
  regs: new Map(), // eventId -> inscripción (solo admins)
  missing: new Map(), // eventId -> jugadores del equipo que no están inscritos
  invites: null,
  owners: [], // perfiles de los admins
  openEvents: [],
  editing: "", // id del jugador en edición
  // tabs: tournaments | players | admin ("torneos"/"jugadores" son los nombres viejos)
  tab: ({ torneos: "tournaments", jugadores: "players" })[new URLSearchParams(location.search).get("tab")] || new URLSearchParams(location.search).get("tab") || "tournaments",
  results: null, // resultado del equipo en cada torneo (se carga aparte)
  spirit: [], // evaluaciones de espíritu que me tocan en este equipo
  notices: [], // admins: avisos de jugadores que se unieron con el link
  newUids: new Set(), // jugadores que se unieron y este admin todavía no vio
};

const admin = () => isSquadAdmin(state.squad, state.user?.uid);
const isMember = () => !!state.user && state.members.some((m) => m.id === state.user.uid);

function alertBox(msg, kind = "success") {
  const el = document.getElementById("tnAlert");
  el.className = `alert alert-${kind}`;
  el.textContent = msg;
  el.classList.toggle("d-none", !msg);
  if (msg && kind === "success") setTimeout(() => el.classList.add("d-none"), 2500);
}

async function run(fn) {
  showLoader();
  try {
    await fn();
  } catch (err) {
    console.error(err);
    alertBox(`${EX.error} ${err?.code || err?.message || ""}`, "danger");
  } finally {
    hideLoader();
  }
}

async function load() {
  const squad = await loadSquad(SID);
  if (!squad) return false;
  state.squad = squad;
  let [members, tournaments] = await Promise.all([listMembers(SID), listSquadTournaments(SID).catch(() => [])]);
  // admins: vuelve a vincular jugadores con cuenta que una edición anterior dejó "sin cuenta"
  if (admin() && members.some((m) => !m.uid) && (await repairMemberLinks(SID, members).catch(() => 0))) {
    members = await listMembers(SID);
  }
  state.members = members;
  state.tournaments = tournaments;
  if (admin()) {
    // las inscripciones se actualizan con los datos actuales del roster (nombre, número, F/M, cuenta)
    state.notices = await listSquadNotices(SID, state.user.uid).catch(() => []);
    state.newUids = new Set(state.notices.filter((n) => n.unread).map((n) => n.uid));
    const [invites, owners, synced, events] = await Promise.all([
      getInvites(SID, state.user).catch(() => null),
      Promise.all((squad.ownerUids || []).map(async (uid) => ({ uid, ...((await loadProfile(uid).catch(() => null)) || {}) }))),
      syncSquadRegistrations(SID, members).catch((err) => {
        console.warn("[equipo] sync inscripciones:", err?.code || err);
        return [];
      }),
      listPublicEvents().catch(() => []),
    ]);
    state.invites = invites;
    state.owners = owners;
    state.regs = new Map(synced.map((x) => [x.eventId, x.reg]));
    state.missing = new Map(synced.map((x) => [x.eventId, x.missing]));
    state.rosterLocked = new Set(synced.filter((x) => x.locked).map((x) => x.eventId));
    const registered = new Set(tournaments.map((t) => t.eventId));
    state.openEvents = events.filter((e) => registrationIsOpen(e) && isApproved(e) && !registered.has(e.id));
  }
  return true;
}

/* =========================
   Secciones
========================= */
function header() {
  const s = state.squad;
  const n = state.members.length;
  const f = state.members.filter((m) => m.gender === "F").length;
  const color = s.color || "#19473f";
  const playerLink = admin() && state.invites?.player ? joinUrl(state.invites.player) : "";
  return `
    <section class="tp-hero">
      <div class="tp-hero__banner" style="background: radial-gradient(120% 140% at 100% 0%, rgba(34, 211, 238, .35) 0%, transparent 55%), linear-gradient(135deg, ${esc(color)}, #2e1065)"></div>
      <div class="tp-hero__body">
        <div class="tp-hero__logo">${teamBadge(s, 112)}</div>
        <h1 class="tp-hero__name">${esc(s.name)}</h1>
        ${s.city || s.country ? `<div class="tp-hero__city">${s.country ? `${flagOf(s.country)} ` : `<i class="bi bi-geo-alt me-1"></i>`}${esc([s.city, countryName(s.country)].filter(Boolean).join(", "))}</div>` : ""}
        <div class="tp-hero__chips">
          <span class="ev-chip"><i class="bi bi-people me-1"></i>${esc(exf(EX.playersCount, { n }))}</span>
          <span class="ev-chip">${f} F · ${n - f - state.members.filter((m) => !m.gender).length} M</span>
          ${admin() ? `<span class="ev-chip ev-chip--ok"><i class="bi bi-shield-check me-1"></i>${esc(EX.sqAdminBadge)}</span>` : isMember() ? `<span class="ev-chip"><i class="bi bi-person-check me-1"></i>${esc(EX.sqMemberBadge)}</span>` : ""}
        </div>
        <div class="tp-hero__actions">
          ${playerLink ? `<button class="btn tn-btn-grad" data-copy="${esc(playerLink)}"><i class="bi bi-link-45deg me-1"></i>${esc(EX.sqInvitePlayers)}</button>` : ""}
          ${isMember() ? `<a class="btn btn-light" href="/tournaments/profile.html"><i class="bi bi-person me-1"></i>${esc(EX.navProfile)}</a>` : ""}
          <button class="btn btn-light" data-copy="${esc(location.origin + squadUrl(SID))}"><i class="bi bi-share me-1"></i>${esc(EX.tpShare)}</button>
        </div>
      </div>
    </section>`;
}

// Vitrina: podios y espíritu en torneos terminados, más el récord total
function honorsShelf() {
  const r = state.results;
  if (!state.tournaments.length) return "";
  if (!r) return `<section class="tp-shelf"><div class="tp-skel"></div></section>`;
  const done = r.filter((x) => x.team && x.finished && x.played);
  const count = (rank) => done.filter((x) => x.rank === rank).length;
  const spirit = r.filter((x) => x.spiritFirst).length;
  const w = r.reduce((s, x) => s + (x.w || 0), 0);
  const l = r.reduce((s, x) => s + (x.l || 0), 0);
  const medal = (icon, n, label, cls) => `
    <div class="tp-medal ${n ? "" : "is-empty"}">
      <div class="tp-medal__icon ${cls}">${icon}${n ? `<span class="tp-medal__n">${n}</span>` : ""}</div>
      <div class="tp-medal__l">${esc(label)}</div>
    </div>`;
  return `
    <section class="tp-shelf">
      <div class="tp-medals">
        ${medal("1", count(1), EX.tpFirst, "is-gold")}
        ${medal("2", count(2), EX.tpSecond, "is-silver")}
        ${medal("3", count(3), EX.tpThird, "is-bronze")}
        ${medal("<i class=\"bi bi-heart-fill\"></i>", spirit, EX.tpSpirit, "is-spirit")}
      </div>
      <div class="tp-record">
        <div><b>${r.filter((x) => x.team).length}</b><span>${esc(EX.pfTournaments)}</span></div>
        <div><b>${w}-${l}</b><span>${esc(EX.tpRecord)}</span></div>
        <div><b>${w + l ? Math.round((w / (w + l)) * 100) : 0}%</b><span>${esc(EX.tpWinPct)}</span></div>
      </div>
    </section>`;
}

const ordinal = (n) => `${n}º`;

function resultChip(x) {
  if (!x?.team) return "";
  if (x.finished && x.played) {
    if (x.rank <= 3) return `<span class="tp-place tp-place--${x.rank}">${["", "🥇", "🥈", "🥉"][x.rank]} ${esc(exf(EX.tpPlace, { n: ordinal(x.rank) }))}</span>`;
    return `<span class="tp-place">${esc(exf(EX.tpPlaceOf, { n: ordinal(x.rank), total: x.total }))}</span>`;
  }
  if (x.live) return `<span class="tp-place tp-place--live"><span class="sb-live-dot"></span> ${esc(EX.tpLive)}${x.played ? ` · ${esc(ordinal(x.rank))}` : ""}</span>`;
  return `<span class="tp-place">${esc(EX.tpUpcoming)}</span>`;
}

function tournamentsTab() {
  const byEvent = new Map((state.results || []).map((x) => [x.ptr.eventId, x]));
  const list = state.tournaments.map((t) => {
    const x = byEvent.get(t.eventId);
    const e = x?.event || {};
    const reg = state.regs.get(t.eventId);
    const missing = admin() ? state.missing.get(t.eventId) || [] : [];
    const thumb = e.image
      ? `<div class="tp-ev__img" style="background-image:url('${esc(e.image)}')"></div>`
      : `<div class="tp-ev__img tp-ev__img--plain">🥏</div>`;
    return `
      <div class="tp-ev">
        <a class="tp-ev__main" href="${esc(eventUrl({ id: t.eventId, slug: e.slug || t.eventSlug }))}">
          ${thumb}
          <div class="flex-grow-1 min-w-0">
            <div class="tp-ev__name">${esc(e.name || t.eventName || "—")}</div>
            <div class="tp-ev__meta">${esc([fmtDateRange(e.startDate || t.startDate, e.endDate || t.endDate), x?.divisionName].filter(Boolean).join(" · "))}</div>
            <div class="d-flex flex-wrap gap-2 align-items-center mt-1">
              ${resultChip(x)}
              ${x?.team && x.played ? `<span class="tp-ev__rec">${x.w}-${x.l}</span>` : ""}
              ${admin() && reg ? regChip(reg.status) : ""}
            </div>
          </div>
          <i class="bi bi-chevron-right ev-muted"></i>
        </a>
        ${admin() && reg ? `<div class="tp-ev__admin"><a class="small" href="/tournaments/team.html?${new URLSearchParams({ e: t.eventId, r: reg.id })}"><i class="bi bi-pencil me-1"></i>${esc(EX.regEditMine)}</a><span class="small ev-muted">${state.rosterLocked?.has(t.eventId) ? `<i class="bi bi-lock-fill me-1"></i>${esc(EX.rosterLockedShort)} · ` : ""}${esc(exf(EX.playersCount, { n: (reg.players || []).length }))}</span></div>` : ""}
        ${missing.length ? `
          <div class="alert alert-warning py-2 px-3 mb-0 mt-2 d-flex justify-content-between align-items-center flex-wrap gap-2">
            <span class="small">${esc(exf(EX.sqMissingInReg, { n: missing.length, names: missing.map((m) => m.name).join(", ") }))}</span>
            <button class="btn btn-sm btn-warning" data-reg-add="${esc(t.eventId)}"><i class="bi bi-person-plus me-1"></i>${esc(EX.sqAddToReg)}</button>
          </div>` : ""}
      </div>`;
  }).join("");
  const open = admin() && state.openEvents.length ? `
    <div class="tp-list-title mt-4">${esc(EX.openRegistrations)}</div>
    <div class="tp-list">
      ${state.openEvents.map((e) => `
        <div class="tp-row">
          <div class="flex-grow-1 min-w-0"><div class="fw-semibold">${esc(e.name)}</div><div class="small ev-muted">${esc(fmtDateRange(e.startDate, e.endDate))}</div></div>
          <a class="btn btn-sm tn-btn-grad" href="/tournaments/team.html?${new URLSearchParams({ e: e.id, s: SID })}">${esc(EX.registerTeam)}</a>
        </div>`).join("")}
    </div>` : "";
  return `
    ${spiritPendingHtml(state.spirit)}
    <div class="tp-list-title">${esc(state.tournaments.length === 1 ? EX.tpEventShown : exf(EX.tpEventsShown, { n: state.tournaments.length }))}</div>
    ${list ? `<div class="tp-list">${list}</div>` : `<div class="tp-empty">${esc(EX.sqNoTournaments)}</div>`}
    ${open}`;
}

function captainOptions(selected) {
  return `<option value="">—</option>${state.members.map((m) => `<option value="${esc(m.id)}" ${m.id === selected ? "selected" : ""}>${esc(m.name)}${m.number !== null && m.number !== undefined ? ` #${esc(m.number)}` : ""}</option>`).join("")}`;
}

function rosterRow(m) {
  const s = state.squad;
  if (admin() && state.editing === m.id) {
    return `
      <form class="tp-row" data-member-form="${esc(m.id)}">
        <input class="form-control form-control-sm" style="width:4.5rem" data-m="number" type="number" min="0" max="999" value="${esc(m.number ?? "")}" aria-label="${esc(EX.playerNumber)}" />
        <input class="form-control form-control-sm" data-m="name" value="${esc(m.name)}" required aria-label="${esc(EX.playerName)}" />
        <select class="form-select form-select-sm" style="width:5rem" data-m="gender" aria-label="${esc(EX.playerGender)}">
          <option value="">—</option><option ${m.gender === "F" ? "selected" : ""}>F</option><option ${m.gender === "M" ? "selected" : ""}>M</option>
        </select>
        <button class="btn btn-sm btn-primary" type="submit"><i class="bi bi-check-lg"></i></button>
        <button class="btn btn-sm btn-light" type="button" data-cancel-edit><i class="bi bi-x-lg"></i></button>
      </form>`;
  }
  const roles = [];
  if (m.id === s.captainId) roles.push(`<span class="tp-role tp-role--cap" title="${esc(EX.captain)}"><i class="bi bi-star-fill"></i> ${esc(EX.tpCaptain)}</span>`);
  if (m.id === s.spiritCaptainId) roles.push(`<span class="tp-role tp-role--spirit" title="${esc(EX.spiritCaptain)}"><i class="bi bi-heart-fill"></i> ${esc(EX.tpSpiritCaptain)}</span>`);
  // quién administra el equipo solo lo ven los que están en el equipo
  if (admin() && m.uid && state.newUids.has(m.uid)) roles.push(`<span class="tp-role tp-role--new"><i class="bi bi-person-plus-fill"></i> ${esc(EX.ntNew)}</span>`);
  if ((isMember() || admin()) && m.uid && (s.ownerUids || []).includes(m.uid)) roles.push(`<span class="tp-role"><i class="bi bi-shield-check"></i> ${esc(EX.sqAdminBadge)}</span>`);
  const sub = [m.number !== null && m.number !== undefined && m.number !== "" ? `#${m.number}` : "", m.gender || "", m.uid ? "" : EX.tpNoAccount].filter(Boolean).join(" · ");
  const inner = `
    <span class="tp-row__av">${avatarHtml(m, 46)}${m.id === s.captainId ? `<span class="tp-crown" title="${esc(EX.captain)}"><i class="bi bi-star-fill"></i></span>` : ""}</span>
    <div class="flex-grow-1 min-w-0">
      <div class="tp-row__name">${esc(m.name)}</div>
      <div class="tp-row__sub">${esc(sub || EX.pfRolePlayer)}</div>
    </div>
    <div class="tp-row__roles">${roles.join("")}</div>`;
  return `
    <div class="tp-row ${m.gender === "" ? "is-incomplete" : ""}">
      ${m.uid ? `<a class="tp-row__link" href="${esc(profileUrl(m.uid))}">${inner}</a>` : `<div class="tp-row__link">${inner}</div>`}
      ${admin() ? `
        <div class="tp-row__tools">
          <button class="btn btn-sm btn-light" data-edit-member="${esc(m.id)}" title="${esc(EX.edit)}"><i class="bi bi-pencil"></i></button>
          <button class="btn btn-sm btn-light text-danger" data-del-member="${esc(m.id)}" title="${esc(EX.delete)}"><i class="bi bi-x-lg"></i></button>
        </div>` : ""}
    </div>`;
}

function playersTab() {
  // capitanes primero, luego por número
  const s = state.squad;
  const weight = (m) => (m.id === s.captainId ? 0 : m.id === s.spiritCaptainId ? 1 : 2);
  const members = state.members.slice().sort((a, b) => weight(a) - weight(b) || (a.number ?? 999) - (b.number ?? 999) || String(a.name).localeCompare(String(b.name)));
  return `
    ${admin() && !isMember() ? `
      <div class="alert alert-info d-flex justify-content-between align-items-center flex-wrap gap-2 py-2">
        <span class="small">${esc(EX.sqNotInRoster)}</span>
        <button class="btn btn-sm btn-primary" id="sqAddSelf"><i class="bi bi-person-plus me-1"></i>${esc(EX.sqAddSelf)}</button>
      </div>` : ""}
    <div class="tp-list-title">${esc(exf(EX.tpPlayersShown, { n: members.length }))}</div>
    ${members.length ? `<div class="tp-list">${members.map(rosterRow).join("")}</div>` : `<div class="tp-empty">${esc(EX.sqNoPlayers)}</div>`}
    ${admin() ? `
      <form id="sqAddMember" class="tp-add">
        <div class="small fw-bold mb-2">${esc(EX.addPlayer)}</div>
        <div class="d-flex gap-2 flex-wrap">
          <input class="form-control form-control-sm" style="width:4.5rem" id="amNumber" type="number" min="0" max="999" placeholder="#" aria-label="${esc(EX.playerNumber)}" />
          <input class="form-control form-control-sm flex-grow-1" style="min-width:10rem;width:auto" id="amName" placeholder="${esc(EX.playerName)}" required />
          <select class="form-select form-select-sm" style="width:5rem" id="amGender" aria-label="${esc(EX.playerGender)}"><option value="">F/M</option><option>F</option><option>M</option></select>
          <button class="btn btn-sm btn-outline-primary" type="submit"><i class="bi bi-plus-lg me-1"></i>${esc(EX.add)}</button>
        </div>
        <div class="form-text">${esc(EX.sqManualHint)}</div>
      </form>` : ""}
    ${isMember() && !admin() ? `<div class="text-center mt-4"><button class="btn btn-sm btn-outline-danger" id="sqLeave">${esc(EX.sqLeave)}</button></div>` : ""}`;
}

function editSection() {
  const s = state.squad;
  return `
    <section class="ev-card">
      <h2 class="h6 fw-bold mb-3">${esc(EX.sqEditTeam)}</h2>
      <form id="sqForm" class="row g-3">
        <div class="col-12 col-md-auto d-flex align-items-center gap-3">
          <div id="sqLogoPrev">${teamBadge(s, 64)}</div>
          <div>
            <label class="btn btn-sm btn-outline-secondary mb-1"><i class="bi bi-image me-1"></i>${esc(EX.teamLogo)}<input type="file" accept="image/*" id="sqLogo" hidden /></label>
            <button type="button" class="btn btn-sm btn-link text-danger ${s.logo ? "" : "d-none"}" id="sqLogoDel">${esc(EX.teamLogoRemove)}</button>
          </div>
        </div>
        <div class="col-12 col-md">
          <div class="row g-2">
            <div class="col-12 col-md-6"><label class="form-label small" for="sqName">${esc(EX.teamName)}</label><input class="form-control" id="sqName" value="${esc(s.name)}" required /></div>
            <div class="col-12 col-md-6"><label class="form-label small" for="sqCountry">${esc(EX.teamCountry)}</label><select class="form-select" id="sqCountry">${countryOptions(s.country || "", esc(EX.teamCountryPick))}</select></div>
            <div class="col-8 col-md-4"><label class="form-label small" for="sqCity">${esc(EX.teamCity)}</label><input class="form-control" id="sqCity" value="${esc(s.city || "")}" /></div>
            <div class="col-4 col-md-2"><label class="form-label small" for="sqColor">${esc(EX.teamColor)}</label><input class="form-control form-control-color w-100" type="color" id="sqColor" value="${esc(s.color || "#19473f")}" /></div>
            <div class="col-12 col-md-6"><label class="form-label small" for="sqCaptain"><i class="bi bi-star-fill text-warning me-1"></i>${esc(EX.captain)}</label><select class="form-select" id="sqCaptain">${captainOptions(s.captainId)}</select></div>
            <div class="col-12 col-md-6"><label class="form-label small" for="sqSpirit"><i class="bi bi-heart-fill text-danger me-1"></i>${esc(EX.spiritCaptain)}</label><select class="form-select" id="sqSpirit">${captainOptions(s.spiritCaptainId)}</select></div>
          </div>
        </div>
        <div class="col-12 text-end"><button class="btn btn-primary" type="submit">${esc(EX.save)}</button></div>
      </form>
    </section>`;
}

function inviteBlock(role, title, text) {
  const token = state.invites?.[role];
  const url = token ? joinUrl(token) : "";
  return `
    <div class="tn-invite">
      <div class="fw-bold mb-1">${esc(title)}</div>
      <div class="small ev-muted mb-2">${esc(text)}</div>
      <div class="input-group input-group-sm">
        <input class="form-control" readonly value="${esc(url)}" aria-label="${esc(title)}" />
        <button class="btn tn-btn-grad" type="button" data-copy="${esc(url)}"><i class="bi bi-link-45deg me-1"></i>${esc(EX.sqCopyInvite)}</button>
        <a class="btn btn-outline-success" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent(exf(EX.tpWaInvite, { team: state.squad.name, url }))}" title="WhatsApp"><i class="bi bi-whatsapp"></i></a>
        <button class="btn btn-outline-secondary" type="button" data-regen="${role}" title="${esc(EX.sqRegenerate)}"><i class="bi bi-arrow-repeat"></i></button>
      </div>
    </div>`;
}

function inviteSection() {
  return `
    <section class="ev-card d-grid gap-3">
      <h2 class="h6 fw-bold mb-0">${esc(EX.sqInviteTitle)}</h2>
      ${inviteBlock(INVITE_ROLE.PLAYER, EX.sqInvitePlayers, EX.sqInvitePlayersText)}
      ${inviteBlock(INVITE_ROLE.ADMIN, EX.sqInviteAdmins, EX.sqInviteAdminsText)}
      <div class="form-text m-0">${esc(EX.sqRegenerateHint)}</div>
    </section>`;
}

function ownersSection() {
  const solo = state.owners.length <= 1;
  return `
    <section class="ev-card">
      <h2 class="h6 fw-bold mb-2">${esc(EX.sqAdmins)}</h2>
      ${state.owners.map((o) => `
        <div class="tn-roster-row">
          ${avatarHtml(o, 36)}
          <div class="flex-grow-1 min-w-0 text-truncate">${esc(o.name || EX.sqUnnamed)}${o.uid === state.user.uid ? ` <span class="small ev-muted">(${esc(EX.sqYou)})</span>` : ""}</div>
          ${solo ? "" : `<button class="btn btn-sm btn-light text-danger" data-del-owner="${esc(o.uid)}">${esc(o.uid === state.user.uid ? EX.sqLeaveAdmin : EX.sqRemoveAdmin)}</button>`}
        </div>`).join("")}
    </section>`;
}

function adminTab() {
  return `
    <div class="d-grid gap-3">
      ${inviteSection()}
      ${editSection()}
      ${ownersSection()}
      <div class="text-center"><button class="btn btn-sm btn-outline-danger" id="sqLeave">${esc(EX.sqLeave)}</button></div>
    </div>`;
}

function render() {
  document.title = `${state.squad.name} · ClubStudioHQ`;
  const tabs = [
    ["tournaments", `<i class="bi bi-trophy"></i> ${esc(EX.tpTabEvents)}`],
    ["players", `<i class="bi bi-people"></i> ${esc(EX.tpTabPlayers)}${unseen().length ? `<b class="tn-badge">${unseen().length}</b>` : ""}`],
    ...(admin() ? [["admin", `<i class="bi bi-gear"></i> ${esc(EX.tpTabAdmin)}`]] : []),
  ];
  if (!tabs.some(([id]) => id === state.tab)) state.tab = "tournaments";
  root.innerHTML = `
    <div class="tp-wrap">
      ${state.user ? `<a class="small ev-muted text-decoration-none" href="/tournaments/team.html"><i class="bi bi-arrow-left"></i> ${esc(EX.myTeams)}</a>` : ""}
      ${header()}
      ${honorsShelf()}
      <nav class="tp-tabs" role="tablist">
        ${tabs.map(([id, label]) => `<button class="tp-tab ${state.tab === id ? "is-active" : ""}" data-tp-tab="${id}" role="tab">${label}</button>`).join("")}
      </nav>
      <div class="tp-panel">${state.tab === "players" ? playersTab() : state.tab === "admin" ? adminTab() : tournamentsTab()}</div>
    </div>`;
  // al abrir Jugadores, los nuevos quedan vistos (el chip "Nuevo" se mantiene mientras siga en la página)
  if (state.tab === "players" && unseen().length) {
    const seen = unseen();
    seen.forEach((n) => { n.unread = false; });
    markNoticesRead(seen, state.user.uid).then(() => refreshTeamBadge(state.user)).catch(() => {});
  }
}

const unseen = () => (admin() ? state.notices.filter((n) => n.unread) : []);

async function loadResults() {
  if (!state.tournaments.length) return;
  if (state.user) {
    pendingSpirit(state.user, { squadId: SID }).then((list) => {
      state.spirit = list;
      if (list.length) render();
    }).catch(() => {});
  }
  state.results = await squadResults(SID, state.tournaments).catch((err) => {
    console.warn("[equipo] resultados:", err?.code || err);
    return [];
  });
  render();
}

/* =========================
   Acciones
========================= */
const reload = () => run(async () => {
  await load();
  render();
});

root.addEventListener("submit", (ev) => {
  ev.preventDefault();
  const form = ev.target;
  if (form.id === "sqForm") {
    const v = (id) => form.querySelector(`#${id}`).value.trim();
    if (!v("sqName")) return;
    return run(async () => {
      const data = { name: v("sqName"), country: v("sqCountry"), city: v("sqCity"), color: v("sqColor"), logo: state.squad.logo || "", captainId: v("sqCaptain"), spiritCaptainId: v("sqSpirit") };
      await saveSquad(SID, data);
      Object.assign(state.squad, data);
      alertBox(EX.saved);
      render();
    });
  }
  if (form.id === "sqAddMember") {
    const name = $("#amName").value.trim();
    if (!name) return;
    const num = $("#amNumber").value;
    return run(async () => {
      await saveMember(SID, { name, number: num === "" ? null : Number(num), gender: $("#amGender").value });
      await load();
      render();
      $("#amName")?.focus();
    });
  }
  const mid = form.dataset.memberForm;
  if (mid) {
    const g = (k) => form.querySelector(`[data-m=${k}]`).value.trim();
    return run(async () => {
      await saveMember(SID, { id: mid, name: g("name"), number: g("number") === "" ? null : Number(g("number")), gender: g("gender") });
      state.editing = "";
      await load();
      render();
    });
  }
});

root.addEventListener("click", (ev) => {
  const t = ev.target;
  const tab = t.closest("[data-tp-tab]");
  if (tab) {
    state.tab = tab.dataset.tpTab;
    return render();
  }
  const copy = t.closest("[data-copy]");
  if (copy) {
    const url = copy.dataset.copy;
    navigator.clipboard.writeText(url).then(() => alertBox(EX.regLinkCopied)).catch(() => prompt(EX.sqCopyInvite, url));
    return;
  }
  const regen = t.closest("[data-regen]");
  if (regen) {
    if (!confirm(EX.sqRegenerateConfirm)) return;
    return run(async () => {
      state.invites = await regenerateInvite(SID, regen.dataset.regen, state.user);
      render();
    });
  }
  const edit = t.closest("[data-edit-member]");
  if (edit) {
    state.editing = edit.dataset.editMember;
    render();
    return root.querySelector(`[data-member-form="${state.editing}"] [data-m=name]`)?.focus();
  }
  if (t.closest("[data-cancel-edit]")) {
    state.editing = "";
    return render();
  }
  const del = t.closest("[data-del-member]");
  if (del) {
    const m = state.members.find((x) => x.id === del.dataset.delMember);
    if (!m || !confirm(exf(EX.sqRemovePlayerConfirm, { name: m.name }))) return;
    return run(async () => {
      await deleteMember(SID, m.id);
      await load();
      render();
    });
  }
  const delOwner = t.closest("[data-del-owner]");
  if (delOwner) {
    const uid = delOwner.dataset.delOwner;
    if (!confirm(uid === state.user.uid ? EX.sqLeaveAdminConfirm : EX.sqRemoveAdminConfirm)) return;
    return run(async () => {
      await setOwners(SID, state.squad.ownerUids.filter((u) => u !== uid));
      await load();
      render();
    });
  }
  if (t.closest("#sqLeave")) {
    if (admin() && state.squad.ownerUids.length <= 1) return alertBox(EX.sqLastAdmin, "warning");
    if (!confirm(EX.sqLeaveConfirm)) return;
    return run(async () => {
      await leaveSquad(state.user, state.squad);
      location.href = "/tournaments/team.html";
    });
  }
  const regAdd = t.closest("[data-reg-add]");
  if (regAdd) {
    const eid = regAdd.dataset.regAdd;
    const ids = (state.missing.get(eid) || []).map((m) => m.id);
    return run(async () => {
      await syncSquadRegistrations(SID, state.members, { addIds: ids, onlyEventId: eid });
      await load();
      alertBox(EX.saved);
      render();
    });
  }
  if (t.closest("#sqAddSelf")) {
    return run(async () => {
      await addSelfToRoster(state.user, SID);
      await load();
      render();
    });
  }
});

root.addEventListener("change", async (ev) => {
  if (ev.target.id === "sqLogo") {
    let logo = null;
    try {
      logo = await cropFromInput(ev.target, { aspect: 1, width: 256, maxChars: 200000, title: EX.cropLogo });
    } catch {
      return alertBox(EX.imageBad, "warning");
    }
    if (!logo) return;
    // el logo se guarda al momento (no hace falta tocar Guardar)
    run(async () => {
      await saveSquad(SID, { logo });
      state.squad.logo = logo;
      alertBox(EX.saved);
      render();
    });
  }
});

root.addEventListener("click", (ev) => {
  if (ev.target.id !== "sqLogoDel") return;
  run(async () => {
    await saveSquad(SID, { logo: "" });
    state.squad.logo = "";
    render();
  });
});

/* =========================
   Inicio
========================= */
(async function init() {
  showLoader();
  try {
    const user = await waitForUser();
    state.user = isGoogleUser(user) ? user : null;
    renderNav({ active: "team", user, isAdmin: await isPlatformAdmin(state.user?.uid) });
    if (!(await load())) {
      alertBox(EX.sqNotFound, "warning");
      return;
    }
    render();
    loadResults();
  } catch (err) {
    console.error(err);
    alertBox(`${EX.error} ${err?.code || err?.message || ""}`, "danger");
  } finally {
    hideLoader();
  }
})();
