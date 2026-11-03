// /torneos/js/squad_page.js
// Página del equipo (?s=ID). Pública: roster y torneos. Admins: editar datos, roster, capitanes,
// links de invitación (jugadores y co-admins), co-admins e inscripciones.
import { EX, exf } from "/torneos/js/strings.js";
import { REG, isApproved, listPublicEvents, loadRegistration } from "/torneos/js/services.js";
import {
  INVITE_ROLE,
  deleteMember,
  getInvites,
  isSquadAdmin,
  joinUrl,
  leaveSquad,
  listMembers,
  listSquadTournaments,
  loadProfile,
  loadSquad,
  profileUrl,
  regenerateInvite,
  saveMember,
  saveSquad,
  setOwners,
} from "/torneos/js/squads.js";
import {
  avatarHtml,
  esc,
  eventUrl,
  fmtDateRange,
  hideLoader,
  isGoogleUser,
  regChip,
  renderNav,
  showLoader,
  shrinkImage,
  teamBadge,
  waitForUser,
} from "/torneos/js/ui.js";
import { isPlatformAdmin } from "/torneos/js/services.js";

const root = document.getElementById("tnRoot");
const $ = (sel) => root.querySelector(sel);
const SID = new URLSearchParams(location.search).get("s") || "";

const state = {
  user: null,
  squad: null,
  members: [],
  tournaments: [],
  regs: new Map(), // eventId -> inscripción (solo admins)
  invites: null,
  owners: [], // perfiles de los admins
  openEvents: [],
  editing: "", // id del jugador en edición
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
  const [members, tournaments] = await Promise.all([listMembers(SID), listSquadTournaments(SID).catch(() => [])]);
  state.members = members;
  state.tournaments = tournaments;
  if (admin()) {
    const [invites, owners, regs, events] = await Promise.all([
      getInvites(SID, state.user).catch(() => null),
      Promise.all((squad.ownerUids || []).map(async (uid) => ({ uid, ...((await loadProfile(uid).catch(() => null)) || {}) }))),
      Promise.all(tournaments.map((t) => loadRegistration(t.eventId, t.regId).catch(() => null))),
      listPublicEvents().catch(() => []),
    ]);
    state.invites = invites;
    state.owners = owners;
    state.regs = new Map(regs.filter(Boolean).map((r) => [r.eventId, r]));
    const registered = new Set(tournaments.map((t) => t.eventId));
    state.openEvents = events.filter((e) => e.registrationOpen && isApproved(e) && !registered.has(e.id));
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
  return `
    <section class="ev-card d-flex align-items-center gap-3 flex-wrap">
      ${teamBadge(s, 72)}
      <div class="flex-grow-1 min-w-0">
        <h1 class="h3 fw-bold mb-0">${esc(s.name)}</h1>
        <div class="ev-muted small">${esc([s.city, exf(EX.playersSummary, { n, f, m: state.members.filter((m) => m.gender === "M").length })].filter(Boolean).join(" · "))}</div>
      </div>
      ${admin() ? `<span class="ev-chip ev-chip--ok"><i class="bi bi-shield-check me-1"></i>${esc(EX.sqAdminBadge)}</span>` : isMember() ? `<span class="ev-chip">${esc(EX.sqMemberBadge)}</span>` : ""}
    </section>`;
}

function captainOptions(selected) {
  return `<option value="">—</option>${state.members.map((m) => `<option value="${esc(m.id)}" ${m.id === selected ? "selected" : ""}>${esc(m.name)}${m.number !== null && m.number !== undefined ? ` #${esc(m.number)}` : ""}</option>`).join("")}`;
}

function editSection() {
  if (!admin()) return "";
  const s = state.squad;
  return `
    <details class="ev-card" ${state.members.length ? "" : "open"}>
      <summary class="fw-bold">${esc(EX.sqEditTeam)}</summary>
      <form id="sqForm" class="row g-3 mt-1">
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
            <div class="col-8 col-md-4"><label class="form-label small" for="sqCity">${esc(EX.teamCity)}</label><input class="form-control" id="sqCity" value="${esc(s.city || "")}" /></div>
            <div class="col-4 col-md-2"><label class="form-label small" for="sqColor">${esc(EX.teamColor)}</label><input class="form-control form-control-color w-100" type="color" id="sqColor" value="${esc(s.color || "#19473f")}" /></div>
            <div class="col-12 col-md-6"><label class="form-label small" for="sqCaptain"><i class="bi bi-star-fill text-warning me-1"></i>${esc(EX.captain)}</label><select class="form-select" id="sqCaptain">${captainOptions(s.captainId)}</select></div>
            <div class="col-12 col-md-6"><label class="form-label small" for="sqSpirit"><i class="bi bi-heart-fill text-danger me-1"></i>${esc(EX.spiritCaptain)}</label><select class="form-select" id="sqSpirit">${captainOptions(s.spiritCaptainId)}</select></div>
          </div>
        </div>
        <div class="col-12 text-end"><button class="btn btn-primary" type="submit">${esc(EX.save)}</button></div>
      </form>
    </details>`;
}

function rosterRow(m) {
  const s = state.squad;
  const tags = `${m.id === s.captainId ? `<span class="tn-cap tn-cap--c" title="${esc(EX.captain)}">C</span>` : ""}${m.id === s.spiritCaptainId ? `<span class="tn-cap tn-cap--s" title="${esc(EX.spiritCaptain)}">E</span>` : ""}`;
  if (admin() && state.editing === m.id) {
    return `
      <form class="tn-roster-row" data-member-form="${esc(m.id)}">
        <input class="form-control form-control-sm" style="width:4.5rem" data-m="number" type="number" min="0" max="999" value="${esc(m.number ?? "")}" aria-label="${esc(EX.playerNumber)}" />
        <input class="form-control form-control-sm" data-m="name" value="${esc(m.name)}" required aria-label="${esc(EX.playerName)}" />
        <select class="form-select form-select-sm" style="width:5rem" data-m="gender" aria-label="${esc(EX.playerGender)}">
          <option value="">—</option><option ${m.gender === "F" ? "selected" : ""}>F</option><option ${m.gender === "M" ? "selected" : ""}>M</option>
        </select>
        <button class="btn btn-sm btn-primary" type="submit"><i class="bi bi-check-lg"></i></button>
        <button class="btn btn-sm btn-light" type="button" data-cancel-edit><i class="bi bi-x-lg"></i></button>
      </form>`;
  }
  const name = m.uid ? `<a class="fw-semibold text-decoration-none" href="${esc(profileUrl(m.uid))}">${esc(m.name)}</a>` : `<span class="fw-semibold">${esc(m.name)}</span>`;
  return `
    <div class="tn-roster-row">
      <div class="tn-roster-num">${esc(m.number ?? "–")}</div>
      ${avatarHtml(m, 36)}
      <div class="flex-grow-1 min-w-0 text-truncate">${name}${tags}
        ${m.uid ? "" : `<div class="small ev-muted">${esc(EX.sqNoAccount)}</div>`}
      </div>
      ${m.gender ? `<span class="ev-chip">${esc(m.gender)}</span>` : `<span class="ev-chip ev-chip--wait" title="${esc(EX.sqMissingGender)}">?</span>`}
      ${admin() ? `
        <button class="btn btn-sm btn-light" data-edit-member="${esc(m.id)}" title="${esc(EX.edit)}"><i class="bi bi-pencil"></i></button>
        <button class="btn btn-sm btn-light text-danger" data-del-member="${esc(m.id)}" title="${esc(EX.delete)}"><i class="bi bi-x-lg"></i></button>` : ""}
    </div>`;
}

function rosterSection() {
  return `
    <section class="ev-card">
      <div class="d-flex justify-content-between align-items-center mb-1">
        <h2 class="h6 mb-0">${esc(EX.regSectionPlayers)}</h2>
        ${isMember() ? `<a class="small" href="/torneos/perfil.html">${esc(EX.sqEditMyProfile)}</a>` : ""}
      </div>
      ${state.members.length ? state.members.map(rosterRow).join("") : `<div class="ev-muted small py-2">${esc(EX.sqNoPlayers)}</div>`}
      ${admin() ? `
        <form id="sqAddMember" class="d-flex gap-2 mt-2 flex-wrap">
          <input class="form-control form-control-sm" style="width:4.5rem" id="amNumber" type="number" min="0" max="999" placeholder="#" aria-label="${esc(EX.playerNumber)}" />
          <input class="form-control form-control-sm flex-grow-1" style="min-width:10rem;width:auto" id="amName" placeholder="${esc(EX.playerName)}" required />
          <select class="form-select form-select-sm" style="width:5rem" id="amGender" aria-label="${esc(EX.playerGender)}"><option value="">F/M</option><option>F</option><option>M</option></select>
          <button class="btn btn-sm btn-outline-primary" type="submit"><i class="bi bi-plus-lg me-1"></i>${esc(EX.addPlayer)}</button>
        </form>
        <div class="form-text">${esc(EX.sqManualHint)}</div>` : ""}
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
        <button class="btn btn-outline-secondary" type="button" data-regen="${role}" title="${esc(EX.sqRegenerate)}"><i class="bi bi-arrow-repeat"></i></button>
      </div>
    </div>`;
}

function inviteSection() {
  if (!admin()) return "";
  return `
    <section class="ev-card d-grid gap-3">
      <h2 class="h6 mb-0">${esc(EX.sqInviteTitle)}</h2>
      ${inviteBlock(INVITE_ROLE.PLAYER, EX.sqInvitePlayers, EX.sqInvitePlayersText)}
      ${inviteBlock(INVITE_ROLE.ADMIN, EX.sqInviteAdmins, EX.sqInviteAdminsText)}
      <div class="form-text m-0">${esc(EX.sqRegenerateHint)}</div>
    </section>`;
}

function ownersSection() {
  if (!admin()) return "";
  const solo = state.owners.length <= 1;
  return `
    <section class="ev-card">
      <h2 class="h6 mb-2">${esc(EX.sqAdmins)}</h2>
      ${state.owners.map((o) => `
        <div class="tn-roster-row">
          ${avatarHtml(o, 32)}
          <div class="flex-grow-1 min-w-0 text-truncate">${esc(o.name || EX.sqUnnamed)}${o.uid === state.user.uid ? ` <span class="small ev-muted">(${esc(EX.sqYou)})</span>` : ""}</div>
          ${solo ? "" : `<button class="btn btn-sm btn-light text-danger" data-del-owner="${esc(o.uid)}">${esc(o.uid === state.user.uid ? EX.sqLeaveAdmin : EX.sqRemoveAdmin)}</button>`}
        </div>`).join("")}
    </section>`;
}

function tournamentsSection() {
  const rows = state.tournaments.map((t) => {
    const reg = state.regs.get(t.eventId);
    return `
      <div class="tn-roster-row">
        <div class="flex-grow-1 min-w-0">
          <a class="fw-semibold text-decoration-none" href="${esc(eventUrl({ id: t.eventId, slug: t.eventSlug }))}">${esc(t.eventName || "—")}</a>
          <div class="small ev-muted">${esc(fmtDateRange(t.startDate, t.endDate))}</div>
        </div>
        ${reg ? regChip(reg.status) : ""}
        ${admin() && reg ? `<a class="btn btn-sm btn-light" href="/torneos/equipo.html?${new URLSearchParams({ e: t.eventId, r: reg.id })}">${esc(EX.edit)}</a>` : ""}
      </div>`;
  }).join("");
  const open = admin() && state.openEvents.length ? `
    <div class="mt-3 small fw-bold">${esc(EX.openRegistrations)}</div>
    ${state.openEvents.map((e) => `
      <div class="tn-roster-row">
        <div class="flex-grow-1 min-w-0"><div class="fw-semibold">${esc(e.name)}</div><div class="small ev-muted">${esc(fmtDateRange(e.startDate, e.endDate))}</div></div>
        <a class="btn btn-sm tn-btn-grad" href="/torneos/equipo.html?${new URLSearchParams({ e: e.id, s: SID })}">${esc(EX.registerTeam)}</a>
      </div>`).join("")}` : "";
  return `
    <section class="ev-card">
      <h2 class="h6 mb-1">${esc(EX.sqTournaments)}</h2>
      ${rows || `<div class="ev-muted small py-1">${esc(EX.sqNoTournaments)}</div>`}
      ${open}
    </section>`;
}

function render() {
  document.title = `${state.squad.name} · ClubStudioHQ`;
  root.innerHTML = `
    ${state.user ? `<a class="small ev-muted text-decoration-none" href="/torneos/equipo.html"><i class="bi bi-arrow-left"></i> ${esc(EX.myTeams)}</a>` : ""}
    <div class="d-grid gap-3 mt-1">
      ${header()}
      ${editSection()}
      ${inviteSection()}
      <div class="row g-3">
        <div class="col-12 col-lg-7">${rosterSection()}</div>
        <div class="col-12 col-lg-5 d-grid gap-3 align-content-start">${tournamentsSection()}${ownersSection()}</div>
      </div>
      ${isMember() || admin() ? `<div class="text-end"><button class="btn btn-sm btn-outline-danger" id="sqLeave">${esc(EX.sqLeave)}</button></div>` : ""}
    </div>`;
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
      const data = { name: v("sqName"), city: v("sqCity"), color: v("sqColor"), logo: state.squad.logo || "", captainId: v("sqCaptain"), spiritCaptainId: v("sqSpirit") };
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
      location.href = "/torneos/equipo.html";
    });
  }
});

root.addEventListener("change", async (ev) => {
  if (ev.target.id === "sqLogo") {
    const file = ev.target.files?.[0];
    if (!file) return;
    try {
      const logo = await shrinkImage(file);
      if (logo.length > 300000) return alertBox(EX.teamLogoTooBig, "warning");
      state.squad.logo = logo;
      $("#sqLogoPrev").innerHTML = teamBadge(state.squad, 64);
      $("#sqLogoDel").classList.remove("d-none");
    } catch {
      alertBox(EX.teamLogoTooBig, "warning");
    }
  }
});

root.addEventListener("click", (ev) => {
  if (ev.target.id !== "sqLogoDel") return;
  state.squad.logo = "";
  $("#sqLogoPrev").innerHTML = teamBadge(state.squad, 64);
  ev.target.classList.add("d-none");
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
  } catch (err) {
    console.error(err);
    alertBox(`${EX.error} ${err?.code || err?.message || ""}`, "danger");
  } finally {
    hideLoader();
  }
})();
