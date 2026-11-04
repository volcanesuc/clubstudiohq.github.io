// /tournaments/js/team_admin.js
// "Mi equipo": mis equipos (admin o jugador), crear un equipo, e inscribir un equipo en un torneo
// con inscripciones abiertas eligiendo jugadores del roster, división, contacto y capitanes.
//   /tournaments/team.html                     mis equipos + torneos con inscripciones abiertas
//   /tournaments/team.html?e=EVENTO[&s=EQUIPO] nueva inscripción
//   /tournaments/team.html?e=EVENTO&r=ID       editar una inscripción
import { EX, exf } from "/tournaments/js/strings.js";
import { eventRules, rosterProblem } from "/tournaments/js/model.js";
import { REG, isApproved, registrationIsOpen, rosterLocked, isPlatformAdmin, listPublicEvents, listTeams, loadEvent, loadPublicEventBySlug, loadRegistration, saveRegistration, withdrawRegistration, fmtMoney, submitRegistrationPayment, teamFee, listWaiverStatus, waiverOn } from "/tournaments/js/services.js";
import { countryOptions, countryName, flagOf } from "/tournaments/js/countries.js";
import { createSquad, isSquadAdmin, listMembers, listMySquads, loadSquad, myRegistrationsFor, pendingSpirit, squadUrl } from "/tournaments/js/squads.js";
import { avatarHtml, esc, eventUrl, fmtDateRange, hideLoader, isGoogleUser, regChip, renderNav, showLoader, signInGoogle, spiritPendingHtml, teamBadge, waitForUser, paymentChip, shrinkImage } from "/tournaments/js/ui.js";

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

const regUrl = (eid, extra = {}) => `/tournaments/team.html?${new URLSearchParams({ e: eid, ...extra })}`;

/* =========================
   Mis equipos
========================= */
async function renderList() {
  const [squads, events] = await Promise.all([
    listMySquads(state.user),
    listPublicEvents().catch(() => []),
  ]);
  const open = events.filter((e) => registrationIsOpen(e) && isApproved(e));
  // mis inscripciones en cada torneo abierto
  const mine = new Map(await Promise.all(open.map(async (e) => [e.id, await myRegistrationsFor(state.user, e.id).catch(() => [])])));
  // jugadores por equipo (para la tarjeta)
  const counts = new Map(await Promise.all(squads.map(async (sq) => [sq.id, (await listMembers(sq.id).catch(() => [])).length])));
  root.innerHTML = `
    <div class="d-flex justify-content-between align-items-end flex-wrap gap-2 mb-3">
      <div>
        <h1 class="h3 fw-bold mb-1">${esc(EX.myTeams)}</h1>
        <div class="ev-muted">${esc(EX.myTeamsSubtitle)}</div>
      </div>
      <a class="btn btn-outline-secondary btn-sm" href="/tournaments/profile.html"><i class="bi bi-person me-1"></i>${esc(EX.navProfile)}</a>
    </div>
    <div id="spPending"></div>
    ${squads.length ? `<div class="mt-grid">${squads.map((s) => {
      const isAdmin = isSquadAdmin(s, state.user.uid);
      const n = counts.get(s.id);
      return `
      <a class="mt-card" href="${esc(squadUrl(s.id))}">
        <div class="mt-card__banner" style="background: linear-gradient(135deg, ${esc(s.color || "#19473f")}, #2e1065)"></div>
        <div class="mt-card__body">
          <div class="mt-card__logo">${teamBadge(s, 72)}</div>
          <div class="min-w-0 flex-grow-1">
            <div class="mt-card__name">${esc(s.name || "—")}</div>
            ${s.city || s.country ? `<div class="mt-card__place">${s.country ? `${flagOf(s.country)} ` : ""}${esc([s.city, countryName(s.country)].filter(Boolean).join(", "))}</div>` : ""}
            <div class="d-flex flex-wrap gap-1 mt-2">
              <span class="ev-chip ${isAdmin ? "ev-chip--ok" : ""}"><i class="bi ${isAdmin ? "bi-shield-check" : "bi-person-check"} me-1"></i>${esc(isAdmin ? EX.sqAdminBadge : EX.sqMemberBadge)}</span>
              ${n !== undefined ? `<span class="ev-chip"><i class="bi bi-people me-1"></i>${esc(n === 1 ? EX.clPlayer : exf(EX.clPlayers, { n }))}</span>` : ""}
            </div>
          </div>
          <i class="bi bi-chevron-right ev-muted"></i>
        </div>
      </a>`;
    }).join("")}</div>` : `<div class="ev-card ev-muted">${esc(EX.myTeamsEmpty)}</div>`}

    <details class="mt-create" ${squads.length ? "" : "open"}>
      <summary class="mt-create__toggle"><i class="bi bi-plus-circle me-1"></i>${esc(EX.sqCreateToggle)}</summary>
      <form id="sqCreate" class="mt-create__form">
        <div class="row g-2">
          <div class="col-12 col-md-5">
            <label class="form-label small" for="sqNewName">${esc(EX.teamName)}</label>
            <input class="form-control" id="sqNewName" required />
          </div>
          <div class="col-7 col-md-4">
            <label class="form-label small" for="sqNewCountry">${esc(EX.teamCountry)}</label>
            <select class="form-select" id="sqNewCountry" required>${countryOptions("", esc(EX.teamCountryPick))}</select>
          </div>
          <div class="col-5 col-md-3">
            <label class="form-label small" for="sqNewCity">${esc(EX.teamCity)}</label>
            <input class="form-control" id="sqNewCity" />
          </div>
        </div>
        <div class="d-flex justify-content-end mt-2">
          <button class="btn btn-primary btn-sm" type="submit"><i class="bi bi-plus-lg me-1"></i>${esc(EX.sqCreateBtn)}</button>
        </div>
      </form>
    </details>

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
    const country = $("#sqNewCountry").value;
    if (!name) return;
    if (!country) return $("#sqNewCountry").focus();
    run(async () => {
      const id = await createSquad(state.user, { name, country, city: $("#sqNewCity").value.trim() });
      location.href = squadUrl(id);
    });
  };
}

/* =========================
   Inscripción
========================= */
const divisions = () => (state.event.divisions?.length ? state.event.divisions : [{ id: "open", name: "Open" }]);
// "7–15 jugadores" / "mínimo 7"
const rosterRangeText = (r) => (r.rosterMin && r.rosterMax ? exf(EX.regRosterRange, { min: r.rosterMin, max: r.rosterMax })
  : r.rosterMin ? exf(EX.regRosterAtLeast, { n: r.rosterMin }) : r.rosterMax ? exf(EX.regRosterAtMost, { n: r.rosterMax }) : "");

// Otros equipos del torneo donde ya juega este miembro (no cuenta el propio)
const elsewhere = (m) => (m.uid ? (state.otherRosters?.get(m.uid) || []).filter((t) => t.squadId !== state.squad?.id).map((t) => t.name) : []);

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

// Cuota del equipo: monto, cómo pagar y (opcional) el comprobante; el organizador lo aprueba
// Estado del formulario de un jugador del roster
function waiverChip(m) {
  if (!m.uid) return `<div class="small ev-muted"><i class="bi bi-file-earmark me-1"></i>${esc(EX.waiverStatusNoAccount)}</div>`;
  const ok = state.waivers.get(m.uid)?.version === (state.event.waiver?.version || "");
  return `<div class="small ${ok ? "text-success" : "text-warning-emphasis"}"><i class="bi ${ok ? "bi-file-earmark-check-fill" : "bi-file-earmark"} me-1"></i>${esc(ok ? EX.waiverStatusSigned : EX.waiverStatusPending)}</div>`;
}

// Link del formulario para pasarle a los jugadores
function waiverSection() {
  if (!waiverOn(state.event)) return "";
  const url = `${location.origin}/tournaments/waiver.html?e=${encodeURIComponent(state.event.slug || state.event.id)}`;
  return `
    <section class="ev-card">
      <h2 class="h6 mb-2"><i class="bi bi-file-earmark-check me-1"></i>${esc(state.event.waiver.title || EX.secWaiver)}</h2>
      <div class="small ev-muted mb-2">${esc(EX.waiverShare)}</div>
      <div class="input-group input-group-sm">
        <input class="form-control" value="${esc(url)}" readonly />
        <button class="btn btn-outline-secondary" type="button" data-copy-waiver="${esc(url)}"><i class="bi bi-clipboard"></i></button>
        <a class="btn btn-outline-success" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent(exf(EX.waiverWa, { event: state.event.name || "", url }))}"><i class="bi bi-whatsapp"></i></a>
      </div>
    </section>`;
}

function paymentSection(r) {
  const fee = teamFee(state.event);
  if (!fee) return "";
  const cur = state.event.fees?.currency || "CRC";
  const st = r.paymentStatus || "none";
  const proof = state.paymentProof || r.paymentProof || "";
  const canUpload = st !== "approved";
  return `
    <section class="ev-card">
      <div class="d-flex justify-content-between align-items-center flex-wrap gap-2 mb-2">
        <h2 class="h6 mb-0"><i class="bi bi-cash-coin me-1"></i>${esc(EX.feeTeam)}: ${esc(fmtMoney(fee, cur))}</h2>
        ${r.id ? paymentChip(r) : ""}
      </div>
      ${state.event.fees?.info ? `<div class="small mb-2" style="white-space:pre-line">${esc(state.event.fees.info)}</div>` : ""}
      ${st === "rejected" && r.paymentNote ? `<div class="alert alert-warning py-2 small">${esc(r.paymentNote)}</div>` : ""}
      ${proof ? `<img class="tn-proof__img mb-2" src="${esc(proof)}" alt="${esc(EX.payProof)}" />` : ""}
      ${canUpload ? `
        <label class="form-label small" for="regProof">${esc(proof ? EX.payReplace : EX.payAttach)}</label>
        <input class="form-control" id="regProof" type="file" accept="image/*" />
        <div class="form-text">${esc(EX.payAttachHint)}</div>` : ""}
    </section>`;
}

function captainOptions(selected) {
  return `<option value="">${esc(EX.choosePlayer)}</option>${chosen().map((m) => `<option value="${esc(m.id)}" ${m.id === selected ? "selected" : ""}>${esc(m.name)}${m.number !== null && m.number !== undefined ? ` #${esc(m.number)}` : ""}</option>`).join("")}`;
}

function renderNoSquad() {
  root.innerHTML = `
    <div class="ev-card text-center py-4 mt-2" style="max-width:560px;margin:auto">
      <h1 class="h5 fw-bold">${esc(exf(EX.registerTitle, { event: state.event.name || "" }))}</h1>
      <p class="ev-muted">${esc(EX.regNeedSquad)}</p>
      <a class="btn tn-btn-grad" href="/tournaments/team.html">${esc(EX.sqCreateBtn)}</a>
    </div>`;
}

function renderForm() {
  // ya inscrito y pasó la fecha de rosters: los jugadores quedan fijos
  const lockRoster = !!state.reg?.id && rosterLocked(state.event);
  const e = state.event;
  const r = state.reg;
  const s = state.squad;
  const approved = r.status === REG.APPROVED;
  const submitLabel = !r.id ? EX.regSubmit : r.status === REG.REJECTED ? EX.regResubmit : EX.regSave;
  const lockedSquad = !!r.id;
  root.innerHTML = `
    <a class="small ev-muted text-decoration-none" href="/tournaments/team.html"><i class="bi bi-arrow-left"></i> ${esc(EX.myTeams)}</a>
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
          <h2 class="h6 mb-0">${esc(EX.regPickPlayers)} <span class="small ev-muted fw-normal">${esc(rosterRangeText(eventRules(state.event)))}</span></h2>
          <span class="small ev-muted" id="regSummary"></span>
        </div>
        ${lockRoster ? `<div class="alert alert-secondary py-2 small d-flex gap-2 align-items-start"><i class="bi bi-lock-fill mt-1"></i><span>${esc(exf(EX.rosterLockedMsg, { date: state.event.rosterDeadline || "" }))}</span></div>` : ""}
        ${state.members.length ? `
          <div class="form-check mb-1">
            <input class="form-check-input" type="checkbox" id="regAll" ${state.selected.size === state.members.length ? "checked" : ""} ${lockRoster ? "disabled" : ""} />
            <label class="form-check-label small" for="regAll">${esc(EX.regSelectAll)}</label>
          </div>
          ${state.members.map((m) => `
            <label class="tn-roster-row" for="pk_${esc(m.id)}">
              <input class="form-check-input m-0" type="checkbox" id="pk_${esc(m.id)}" data-pick="${esc(m.id)}" ${state.selected.has(m.id) ? "checked" : ""} ${lockRoster ? "disabled" : ""} />
              <div class="tn-roster-num">${esc(m.number ?? "–")}</div>
              ${avatarHtml(m, 32)}
              <div class="flex-grow-1 min-w-0">
                <div class="text-truncate">${esc(m.name)}</div>
                ${waiverOn(state.event) ? waiverChip(m) : ""}
                ${elsewhere(m).length ? `<div class="small text-warning-emphasis text-truncate"><i class="bi bi-people-fill me-1"></i>${esc(exf(EX.regAlsoIn, { teams: elsewhere(m).join(", ") }))}</div>` : ""}
              </div>
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

      ${waiverSection()}
      ${paymentSection(r)}

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

  form.querySelector("#regProof")?.addEventListener("change", async (ev) => {
    const file = ev.target.files?.[0];
    if (!file) return;
    try {
      state.paymentProof = await shrinkImage(file, 1100);
      renderForm();
      alertBox(EX.payReadyToSend, "info");
    } catch {
      alertBox(EX.error, "danger");
    }
  });

  form.addEventListener("submit", (ev) => {
    ev.preventDefault();
    const r = state.reg;
    const s = state.squad;
    const locked = !!r.id && rosterLocked(state.event);
    // roster cerrado: se guardan los mismos jugadores inscritos (las reglas no dejan cambiarlos)
    const players = locked ? (r.players || []) : chosen().map((m) => ({ id: m.id, uid: m.uid || null, name: m.name, number: m.number ?? null, gender: m.gender || "" }));
    const captainId = $("#regCaptain").value;
    const spiritCaptainId = $("#regSpirit").value;

    if (!players.length) return alertBox(EX.regNeedPlayers, "warning");
    // tamaño del roster según las reglas del torneo (con el roster cerrado ya no se valida: no cambia)
    const rr = eventRules(state.event);
    const bad = locked ? "" : rosterProblem(players.length, rr);
    if (bad === "min") return alertBox(exf(EX.regRosterMin, { n: rr.rosterMin }), "warning");
    if (bad === "max") return alertBox(exf(EX.regRosterMax, { n: rr.rosterMax }), "warning");
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
      if (state.paymentProof) {
        await submitRegistrationPayment(state.event.id, id, state.paymentProof);
        state.paymentProof = "";
      }
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
  // jugadores que ya están en el roster de otro equipo de este torneo (se puede estar en varios equipos)
  // formulario de exención: quién del roster ya firmó
  state.waivers = new Map(waiverOn(event) ? (await listWaiverStatus(event.id).catch(() => [])).map((w) => [w.uid, w]) : []);
  state.otherRosters = new Map();
  (await listTeams(event.id).catch(() => [])).forEach((t) => (t.players || []).forEach((p) => {
    if (!p.uid) return;
    if (!state.otherRosters.has(p.uid)) state.otherRosters.set(p.uid, []);
    state.otherRosters.get(p.uid).push({ squadId: t.squadId || "", name: t.name || "" });
  }));
  state.squads = (await listMySquads(state.user)).filter((s) => isSquadAdmin(s, state.user.uid));
  if (regId) {
    state.reg = await loadRegistration(event.id, regId);
    if (!state.reg) return alertBox(EX.eventNotFound, "warning");
    if (!state.reg.squadId) return alertBox(EX.regNeedSquad, "warning");
    await useSquad(state.reg.squadId, false);
  } else {
    if (!registrationIsOpen(event) || !isApproved(event)) {
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

// copiar el link del formulario
document.addEventListener("click", async (ev) => {
  const b = ev.target.closest("[data-copy-waiver]");
  if (!b) return;
  try {
    await navigator.clipboard.writeText(b.dataset.copyWaiver);
    alertBox(EX.copied || EX.saved);
  } catch { /* sin portapapeles */ }
});
