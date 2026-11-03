// /torneos/js/team_admin.js
// "Mi equipo": mis equipos (admin o jugador), crear un equipo, e inscribir un equipo en un torneo
// con inscripciones abiertas eligiendo jugadores del roster, división, contacto y capitanes.
//   /torneos/equipo.html                     mis equipos + torneos con inscripciones abiertas
//   /torneos/equipo.html?e=EVENTO[&s=EQUIPO] nueva inscripción
//   /torneos/equipo.html?e=EVENTO&r=ID       editar una inscripción
import { EX, exf } from "/torneos/js/strings.js";
import {
  REG,
  isApproved,
  isPlatformAdmin,
  listPublicEvents,
  loadEvent,
  loadPublicEventBySlug,
  loadRegistration,
  saveRegistration,
  withdrawRegistration,
} from "/torneos/js/services.js";
import { createSquad, isSquadAdmin, listMembers, listMySquads, loadSquad, myRegistrationsFor, pendingSpirit, squadUrl } from "/torneos/js/squads.js";
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
  signInGoogle,
  spiritPendingHtml,
  teamBadge,
  waitForUser,
} from "/torneos/js/ui.js";

const root = document.getElementById("tnRoot");
const $ = (sel) => root.querySelector(sel);
const params = new URLSearchParams(location.search);

const state = {
  user: null,
  event: null,
  reg: null, // inscripción en edición ({} si es nueva)
  squads: [], // equipos que administro
  squad: null,
  members: [],
  selected: new Set(), // ids de jugadores inscritos
};

function alertBox(msg, kind = "success") {
  const el = document.getElementById("tnAlert");
  el.className = `alert alert-${kind}`;
  el.textContent = msg;
  el.classList.toggle("d-none", !msg);
  if (msg && kind === "success") setTimeout(() => el.classList.add("d-none"), 2500);
  if (msg) el.scrollIntoView({ behavior: "smooth", block: "nearest" });
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

const regUrl = (eid, extra = {}) => `/torneos/equipo.html?${new URLSearchParams({ e: eid, ...extra })}`;

/* =========================
   Mis equipos
========================= */
async function renderList() {
  const [squads, events] = await Promise.all([
    listMySquads(state.user),
    listPublicEvents().catch(() => []),
  ]);
  const open = events.filter((e) => e.registrationOpen && isApproved(e));
  // mis inscripciones en cada torneo abierto
  const mine = new Map(await Promise.all(open.map(async (e) => [e.id, await myRegistrationsFor(state.user, e.id).catch(() => [])])));
  root.innerHTML = `
    <div class="d-flex justify-content-between align-items-end flex-wrap gap-2 mb-3">
      <div>
        <h1 class="h3 fw-bold mb-1">${esc(EX.myTeams)}</h1>
        <div class="ev-muted">${esc(EX.myTeamsSubtitle)}</div>
      </div>
      <a class="btn btn-outline-secondary btn-sm" href="/torneos/perfil.html"><i class="bi bi-person me-1"></i>${esc(EX.navProfile)}</a>
    </div>
    <div id="spPending"></div>
    ${squads.length ? squads.map((s) => `
      <a class="ev-card ev-event-item" href="${esc(squadUrl(s.id))}">
        ${teamBadge(s, 40)}
        <div class="flex-grow-1 min-w-0">
          <div class="fw-bold text-truncate">${esc(s.name || "—")}</div>
          <div class="small ev-muted text-truncate">${esc(s.city || "")}</div>
        </div>
        <span class="ev-chip ${isSquadAdmin(s, state.user.uid) ? "ev-chip--ok" : ""}">${esc(isSquadAdmin(s, state.user.uid) ? EX.sqAdminBadge : EX.sqMemberBadge)}</span>
        <i class="bi bi-chevron-right ev-muted"></i>
      </a>`).join("") : `<div class="ev-card ev-muted">${esc(EX.myTeamsEmpty)}</div>`}

    <form id="sqCreate" class="ev-card d-flex gap-2 flex-wrap align-items-end">
      <div class="flex-grow-1" style="min-width:12rem">
        <label class="form-label small" for="sqNewName">${esc(EX.sqCreate)}</label>
        <input class="form-control" id="sqNewName" placeholder="${esc(EX.teamName)}" required />
      </div>
      <button class="btn tn-btn-grad" type="submit"><i class="bi bi-plus-lg me-1"></i>${esc(EX.sqCreateBtn)}</button>
    </form>

    <h2 class="h6 mt-4 mb-2">${esc(EX.openRegistrations)}</h2>
    ${open.length ? open.map((e) => {
      const regs = mine.get(e.id) || [];
      return `
      <div class="ev-card ev-event-item flex-wrap">
        <div class="flex-grow-1 min-w-0">
          <a class="fw-bold text-decoration-none" href="${esc(eventUrl(e))}">${esc(e.name || "—")}</a>
          <div class="small ev-muted">${esc(fmtDateRange(e.startDate, e.endDate))}${e.venue ? ` · ${esc(e.venue)}` : ""}</div>
          ${regs.map(({ squad, reg }) => `<div class="d-flex align-items-center gap-2 mt-1 small">${teamBadge(squad, 20)}<span class="fw-semibold">${esc(squad.name)}</span>${regChip(reg.status)}<a href="${esc(regUrl(e.id, { r: reg.id }))}">${esc(EX.regEditMine)}</a></div>`).join("")}
        </div>
        ${regs.length < squads.filter((s) => isSquadAdmin(s, state.user.uid)).length || !squads.length
          ? `<a class="btn btn-sm tn-btn-grad" href="${esc(regUrl(e.id))}">${esc(regs.length ? EX.registerAnother : EX.registerTeam)}</a>`
          : ""}
      </div>`;
    }).join("") : `<div class="ev-card ev-muted">${esc(EX.noOpenRegistrations)}</div>`}`;

  // evaluaciones de espíritu pendientes (no bloquea la lista)
  pendingSpirit(state.user).then((list) => {
    const el = document.getElementById("spPending");
    if (el) el.innerHTML = spiritPendingHtml(list);
  }).catch(() => {});

  $("#sqCreate").onsubmit = (ev) => {
    ev.preventDefault();
    const name = $("#sqNewName").value.trim();
    if (!name) return;
    run(async () => {
      const id = await createSquad(state.user, { name });
      location.href = squadUrl(id);
    });
  };
}

/* =========================
   Inscripción
========================= */
const divisions = () => (state.event.divisions?.length ? state.event.divisions : [{ id: "open", name: "Open" }]);
const chosen = () => state.members.filter((m) => state.selected.has(m.id));

function statusBanner(reg) {
  if (!reg.id) return "";
  const map = {
    [REG.PENDING]: ["info", EX.regPendingHint],
    [REG.APPROVED]: ["success", EX.regApprovedHint],
    [REG.REJECTED]: ["warning", `${EX.regRejectedHint}${reg.note ? ` — ${reg.note}` : ""}`],
  };
  const [kind, text] = map[reg.status] || map[REG.PENDING];
  return `<div class="alert alert-${kind} d-flex gap-2 align-items-start">${regChip(reg.status)}<div>${esc(text)}</div></div>`;
}

function captainOptions(selected) {
  return `<option value="">${esc(EX.choosePlayer)}</option>${chosen().map((m) => `<option value="${esc(m.id)}" ${m.id === selected ? "selected" : ""}>${esc(m.name)}${m.number !== null && m.number !== undefined ? ` #${esc(m.number)}` : ""}</option>`).join("")}`;
}

function renderNoSquad() {
  root.innerHTML = `
    <div class="ev-card text-center py-4 mt-2" style="max-width:560px;margin:auto">
      <h1 class="h5 fw-bold">${esc(exf(EX.registerTitle, { event: state.event.name || "" }))}</h1>
      <p class="ev-muted">${esc(EX.regNeedSquad)}</p>
      <a class="btn tn-btn-grad" href="/torneos/equipo.html">${esc(EX.sqCreateBtn)}</a>
    </div>`;
}

function renderForm() {
  const e = state.event;
  const r = state.reg;
  const s = state.squad;
  const approved = r.status === REG.APPROVED;
  const submitLabel = !r.id ? EX.regSubmit : r.status === REG.REJECTED ? EX.regResubmit : EX.regSave;
  const lockedSquad = !!r.id;
  root.innerHTML = `
    <a class="small ev-muted text-decoration-none" href="/torneos/equipo.html"><i class="bi bi-arrow-left"></i> ${esc(EX.myTeams)}</a>
    <div class="mt-1 mb-3">
      <h1 class="h4 fw-bold mb-1">${esc(exf(EX.registerTitle, { event: e.name || "" }))}</h1>
      <div class="small ev-muted">${esc(fmtDateRange(e.startDate, e.endDate))}${e.venue ? ` · ${esc(e.venue)}` : ""} · <a href="${esc(eventUrl(e))}">${esc(EX.openPublic)}</a></div>
    </div>
    ${statusBanner(r)}
    <form id="regForm" class="d-grid gap-3" novalidate>
      <section class="ev-card">
        <h2 class="h6 mb-3">${esc(EX.regSectionTeam)}</h2>
        <div class="d-flex align-items-center gap-3 flex-wrap mb-3">
          ${teamBadge(s, 56)}
          <div class="flex-grow-1 min-w-0">
            ${lockedSquad || state.squads.length <= 1
              ? `<div class="fw-bold fs-5">${esc(s.name)}</div>`
              : `<select class="form-select" id="regSquad" aria-label="${esc(EX.regSectionTeam)}">${state.squads.map((x) => `<option value="${esc(x.id)}" ${x.id === s.id ? "selected" : ""}>${esc(x.name)}</option>`).join("")}</select>`}
            <a class="small" href="${esc(squadUrl(s.id))}">${esc(EX.regEditTeamLink)}</a>
          </div>
        </div>
        <div class="row g-3">
          ${divisions().length > 1 ? `
          <div class="col-12 col-md-6">
            <label class="form-label small" for="regDiv">${esc(EX.teamDivision)}</label>
            <select class="form-select" id="regDiv" ${approved ? "disabled" : ""}>${divisions().map((d) => `<option value="${esc(d.id)}" ${d.id === r.divisionId ? "selected" : ""}>${esc(d.name)}</option>`).join("")}</select>
          </div>` : ""}
          <div class="col-12 col-md-6">
            <label class="form-label small" for="regContact">${esc(EX.teamContact)}</label>
            <input class="form-control" id="regContact" type="tel" value="${esc(r.contact || "")}" />
            <div class="form-text">${esc(EX.teamContactHint)}</div>
          </div>
        </div>
      </section>

      <section class="ev-card">
        <div class="d-flex justify-content-between align-items-center flex-wrap gap-2 mb-2">
          <h2 class="h6 mb-0">${esc(EX.regPickPlayers)}</h2>
          <span class="small ev-muted" id="regSummary"></span>
        </div>
        ${state.members.length ? `
          <div class="form-check mb-1">
            <input class="form-check-input" type="checkbox" id="regAll" ${state.selected.size === state.members.length ? "checked" : ""} />
            <label class="form-check-label small" for="regAll">${esc(EX.regSelectAll)}</label>
          </div>
          ${state.members.map((m) => `
            <label class="tn-roster-row" for="pk_${esc(m.id)}">
              <input class="form-check-input m-0" type="checkbox" id="pk_${esc(m.id)}" data-pick="${esc(m.id)}" ${state.selected.has(m.id) ? "checked" : ""} />
              <div class="tn-roster-num">${esc(m.number ?? "–")}</div>
              ${avatarHtml(m, 32)}
              <div class="flex-grow-1 min-w-0 text-truncate">${esc(m.name)}</div>
              ${m.gender ? `<span class="ev-chip">${esc(m.gender)}</span>` : `<span class="ev-chip ev-chip--wait" title="${esc(EX.sqMissingGender)}">?</span>`}
            </label>`).join("")}`
          : `<div class="ev-muted small">${esc(EX.regNoMembers)} <a href="${esc(squadUrl(s.id))}">${esc(EX.regEditTeamLink)}</a></div>`}
      </section>

      <section class="ev-card">
        <h2 class="h6 mb-3">${esc(EX.regSectionCaptains)}</h2>
        <div class="row g-3">
          <div class="col-12 col-md-6"><label class="form-label small" for="regCaptain"><i class="bi bi-star-fill text-warning me-1"></i>${esc(EX.captain)}</label><select class="form-select" id="regCaptain"></select></div>
          <div class="col-12 col-md-6"><label class="form-label small" for="regSpirit"><i class="bi bi-heart-fill text-danger me-1"></i>${esc(EX.spiritCaptain)}</label><select class="form-select" id="regSpirit"></select></div>
        </div>
      </section>

      <div class="d-flex justify-content-between gap-2 flex-wrap">
        ${r.id && !approved ? `<button type="button" class="btn btn-outline-danger" id="regWithdraw">${esc(EX.regWithdraw)}</button>` : "<span></span>"}
        <button type="submit" class="btn tn-btn-grad px-4">${esc(submitLabel)}</button>
      </div>
    </form>`;

  refreshDerived(r.captainId || s.captainId || "", r.spiritCaptainId || s.spiritCaptainId || "");
  bindForm();
}

// resumen F/M y capitanes (solo entre los elegidos)
function refreshDerived(capVal = $("#regCaptain").value, spiVal = $("#regSpirit").value) {
  const list = chosen();
  $("#regSummary").textContent = exf(EX.playersSummary, {
    n: list.length,
    f: list.filter((p) => p.gender === "F").length,
    m: list.filter((p) => p.gender === "M").length,
  });
  $("#regCaptain").innerHTML = captainOptions(state.selected.has(capVal) ? capVal : "");
  $("#regSpirit").innerHTML = captainOptions(state.selected.has(spiVal) ? spiVal : "");
  const all = $("#regAll");
  if (all) all.checked = state.selected.size === state.members.length;
}

function bindForm() {
  const form = $("#regForm");

  form.addEventListener("change", (ev) => {
    const t = ev.target;
    if (t.id === "regAll") {
      state.selected = t.checked ? new Set(state.members.map((m) => m.id)) : new Set();
      form.querySelectorAll("[data-pick]").forEach((c) => (c.checked = t.checked));
      return refreshDerived();
    }
    if (t.dataset.pick) {
      if (t.checked) state.selected.add(t.dataset.pick);
      else state.selected.delete(t.dataset.pick);
      return refreshDerived();
    }
    if (t.id === "regSquad") {
      run(async () => {
        await useSquad(t.value, true);
        renderForm();
      });
    }
  });

  $("#regWithdraw")?.addEventListener("click", () => {
    if (!confirm(EX.regWithdrawConfirm)) return;
    run(async () => {
      await withdrawRegistration(state.event.id, state.reg.id, state.reg.squadId);
      location.href = squadUrl(state.squad.id);
    });
  });

  form.addEventListener("submit", (ev) => {
    ev.preventDefault();
    const r = state.reg;
    const s = state.squad;
    const players = chosen().map((m) => ({ id: m.id, uid: m.uid || null, name: m.name, number: m.number ?? null, gender: m.gender || "" }));
    const captainId = $("#regCaptain").value;
    const spiritCaptainId = $("#regSpirit").value;

    if (!players.length) return alertBox(EX.regNeedPlayers, "warning");
    if (players.some((p) => !p.gender)) return alertBox(EX.regPlayerNoGender, "warning");
    const nums = players.map((p) => p.number).filter((n) => n !== null);
    const dups = [...new Set(nums.filter((n, i) => nums.indexOf(n) !== i))];
    if (dups.length) return alertBox(exf(EX.regDupNumbers, { nums: dups.join(", ") }), "warning");
    if (!captainId || !spiritCaptainId) return alertBox(EX.regNeedCaptains, "warning");

    run(async () => {
      const data = {
        ...r,
        squadId: s.id,
        name: s.name,
        city: s.city || "",
        color: s.color || "#19473f",
        logo: s.logo || "",
        divisionId: $("#regDiv")?.value || r.divisionId || divisions()[0].id,
        contact: $("#regContact").value.trim(),
        players,
        captainId,
        spiritCaptainId,
      };
      const isNew = !r.id;
      const id = await saveRegistration(state.user, state.event, data);
      state.reg = (await loadRegistration(state.event.id, id)) || { ...data, id };
      history.replaceState(null, "", regUrl(state.event.id, { r: id }));
      renderForm();
      alertBox(isNew || data.status === REG.REJECTED ? EX.regSent : EX.saved);
    });
  });
}

async function useSquad(sid, selectAll) {
  state.squad = state.squads.find((x) => x.id === sid) || (await loadSquad(sid));
  state.members = await listMembers(sid);
  const prev = new Set((state.reg.players || []).map((p) => p.id));
  state.selected = new Set(state.members.filter((m) => selectAll || prev.has(m.id)).map((m) => m.id));
}

async function openRegistration(eventKey, regId, squadId) {
  const event = (await loadEvent(eventKey).catch(() => null)) || (await loadPublicEventBySlug(eventKey).catch(() => null));
  if (!event) return alertBox(EX.eventNotFound, "warning");
  state.event = event;
  state.squads = (await listMySquads(state.user)).filter((s) => isSquadAdmin(s, state.user.uid));
  if (regId) {
    state.reg = await loadRegistration(event.id, regId);
    if (!state.reg) return alertBox(EX.eventNotFound, "warning");
    if (!state.reg.squadId) return alertBox(EX.regNeedSquad, "warning");
    await useSquad(state.reg.squadId, false);
  } else {
    if (!event.registrationOpen || !isApproved(event)) {
      alertBox(EX.registrationClosed, "warning");
      return renderList();
    }
    if (!state.squads.length) return renderNoSquad();
    const already = await myRegistrationsFor(state.user, event.id).catch(() => []);
    const taken = new Set(already.map((x) => x.squad.id));
    const free = state.squads.filter((s) => !taken.has(s.id));
    if (!free.length) {
      // todos mis equipos ya están inscritos: abre la inscripción existente
      const first = already.find((x) => x.squad.id === squadId) || already[0];
      history.replaceState(null, "", regUrl(event.id, { r: first.reg.id }));
      return openRegistration(event.id, first.reg.id);
    }
    state.squads = free;
    state.reg = { divisionId: divisions()[0].id };
    const pick = state.squads.find((s) => s.id === squadId) || state.squads[0];
    await useSquad(pick.id, true);
  }
  renderForm();
}

function renderSignIn() {
  root.innerHTML = `
    <div class="ev-card text-center py-5 mt-3" style="max-width:520px;margin:auto">
      <div class="display-6 mb-2">🥏</div>
      <h1 class="h4 fw-bold">${esc(EX.navTeam)}</h1>
      <p class="ev-muted">${esc(EX.signInToTeam)}</p>
      <button class="btn tn-btn-grad" id="tnLogin"><i class="bi bi-google me-1"></i>${esc(EX.signIn)}</button>
    </div>`;
  document.getElementById("tnLogin").onclick = async () => {
    try {
      await signInGoogle();
      location.reload();
    } catch (err) {
      alertBox(`${EX.error} ${err?.code || ""}`, "danger");
    }
  };
}

/* =========================
   Inicio
========================= */
(async function init() {
  showLoader();
  try {
    const user = await waitForUser();
    state.user = isGoogleUser(user) ? user : null;
    renderNav({ active: "team", user, isAdmin: await isPlatformAdmin(state.user?.uid) });
    if (!state.user) return renderSignIn();
    const e = params.get("e");
    if (e) await openRegistration(e, params.get("r"), params.get("s"));
    else await renderList();
  } catch (err) {
    console.error(err);
    alertBox(`${EX.error} ${err?.code || err?.message || ""}`, "danger");
  } finally {
    hideLoader();
  }
})();
