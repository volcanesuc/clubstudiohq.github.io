// /torneos/js/organizer.js
// Organizador (cualquier cuenta de Google): mis torneos, info y reglas, equipos, calendario (formatos),
// activación (aprobación + plan) y links de planillero.
import { EX, exf } from "/torneos/js/strings.js";
import {
  DEFAULT_RULES,
  EVENT_STATUS,
  GAME_STATUS,
  RATIO_RULES,
  eventRules,
  parseRoster,
  rosterToText,
  slotMinutes,
  slugify,
} from "/torneos/js/model.js";
import { GAME_MODES } from "/torneos/js/divisions-config.js";
import { cropFromInput } from "/torneos/js/cropper.js";
import { assignSlots, getFormat, listFormats } from "/torneos/js/formats.js";
import {
  APPROVAL,
  REG,
  approveRegistration,
  createEvent,
  createGameKey,
  createGames,
  deleteEvent,
  deleteGame,
  deleteTeam,
  deleteUnplayedGames,
  isApproved,
  isUnplayed,
  isPlatformAdmin,
  listGameKeys,
  listGames,
  listMyEvents,
  listRegistrations,
  rejectRegistration,
  listTeams,
  loadDivisionOptions,
  loadEvent,
  requestApproval,
  saveEvent,
  saveTeam,
  scorekeeperUrl,
  updateGame,
} from "/torneos/js/services.js";
import {
  esc,
  eventUrl,
  fmtDateRange,
  fmtDayOnly,
  fmtWhen,
  fromLocalInput,
  gameUrl,
  hideLoader,
  isGoogleUser,
  phaseLabel,
  regChip,
  renderNav,
  showLoader,
  signInGoogle,
  statusChip,
  teamBadge,
  toLocalInput,
  toMillis,
  waitForUser,
  withLiveTeams,
} from "/torneos/js/ui.js";

const root = document.getElementById("tnRoot");
const $ = (sel) => root.querySelector(sel);

const state = {
  user: null,
  event: null,
  teams: [],
  games: [],
  keys: new Map(), // gameId -> token
  regs: [], // inscripciones de equipos
  divOptions: null, // categorías y ramas para armar divisiones
  tab: "info",
};

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

const params = new URLSearchParams(location.search);
const setUrl = (id) => history.replaceState(null, "", id ? `?id=${encodeURIComponent(id)}` : location.pathname);

/* =========================
   Lista de eventos
========================= */
async function renderList() {
  setUrl(null);
  const events = await listMyEvents(state.user);
  root.innerHTML = `
    <div class="d-flex justify-content-between align-items-end flex-wrap gap-2 mb-3">
      <div>
        <h1 class="h3 fw-bold mb-1">${esc(EX.myEvents)}</h1>
        <div class="ev-muted">${esc(EX.dirSubtitle)}</div>
      </div>
      <button class="btn btn-primary" id="evNew"><i class="bi bi-plus-lg me-1"></i>${esc(EX.newEvent)}</button>
    </div>
    ${events.length ? events.map((e) => `
      <a class="ev-card ev-event-item" href="?id=${esc(e.id)}" data-open="${esc(e.id)}">
        <div class="flex-grow-1 min-w-0">
          <div class="fw-bold">${esc(e.name || "—")}</div>
          <div class="small ev-muted">${esc(fmtDateRange(e.startDate, e.endDate))}${e.venue ? ` · ${esc(e.venue)}` : ""}</div>
        </div>
        ${approvalChip(e)}
        <span class="ev-chip">${esc(e.status === EVENT_STATUS.PUBLISHED ? EX.statusPublished : e.status === EVENT_STATUS.FINISHED ? EX.statusFinished : EX.statusDraft)}</span>
        <i class="bi bi-chevron-right ev-muted"></i>
      </a>`).join("") : `<div class="ev-card ev-muted">${esc(EX.noEvents)}</div>`}`;

  $("#evNew").onclick = () => run(async () => {
    const id = await createEvent(state.user, {
      name: EX.newEvent,
      slug: `evento-${Date.now().toString(36)}`,
      status: EVENT_STATUS.DRAFT,
      divisions: [{ id: "open", name: "Open" }],
      fields: ["Cancha 1"],
      rules: DEFAULT_RULES,
      format: "round_robin",
    });
    await openEvent(id);
  });
  root.querySelectorAll("[data-open]").forEach((a) => (a.onclick = (ev) => {
    ev.preventDefault();
    run(() => openEvent(a.dataset.open));
  }));
}

/* =========================
   Evento
========================= */
async function openEvent(id) {
  const event = await loadEvent(id);
  if (!event) return renderList();
  state.event = event;
  setUrl(id);
  state.divOptions = await loadDivisionOptions();
  await reloadData();
  renderEvent();
}

async function reloadData() {
  const eid = state.event.id;
  const [teams, games, keys, regs] = await Promise.all([
    listTeams(eid),
    listGames(eid),
    listGameKeys(eid).catch(() => []),
    listRegistrations(eid).catch(() => []),
  ]);
  state.regs = regs;
  state.teams = teams;
  state.games = games;
  state.keys = new Map(keys.map((k) => [k.gameId, k.id]));
}

const pendingRegs = () => state.regs.filter((r) => r.status === REG.PENDING);
const registerLink = () => `${location.origin}/torneos/equipo.html?e=${encodeURIComponent(state.event.id)}`;

const divisions = () => (state.event.divisions?.length ? state.event.divisions : [{ id: "open", name: "Open" }]);
const fields = () => state.event.fields || [];

function renderEvent() {
  const e = state.event;
  const tabs = [
    ["info", EX.tabInfo],
    ["teams", `${EX.tabTeams} (${state.teams.length})${pendingRegs().length ? ` · ${pendingRegs().length} 🔔` : ""}`],
    ["schedule", EX.tabSchedule],
    ["games", `${EX.tabGames} (${state.games.length})`],
  ];
  root.innerHTML = `
    <a class="small ev-muted text-decoration-none" href="?" id="evBack"><i class="bi bi-arrow-left"></i> ${esc(EX.backToList)}</a>
    <div class="d-flex justify-content-between align-items-end flex-wrap gap-2 mt-1 mb-3">
      <div class="min-w-0">
        <h1 class="h3 fw-bold mb-1">${esc(e.name || "—")}</h1>
        <div class="ev-muted small">${esc(fmtDateRange(e.startDate, e.endDate))}${e.venue ? ` · ${esc(e.venue)}` : ""}</div>
      </div>
      <a class="btn btn-sm btn-outline-secondary" href="${esc(eventUrl(e))}" target="_blank" rel="noopener"><i class="bi bi-box-arrow-up-right me-1"></i>${esc(EX.openPublic)}</a>
    </div>
    ${approvalCard(e)}
    <ul class="nav nav-pills mb-3 ev-tabs">
      ${tabs.map(([id, label]) => `<li class="nav-item"><button class="nav-link ${state.tab === id ? "active" : ""}" data-tab="${id}">${esc(label)}</button></li>`).join("")}
    </ul>
    <div id="evTab"></div>`;

  bindApprovalCard();
  $("#evBack").onclick = (ev) => {
    ev.preventDefault();
    run(renderList);
  };
  root.querySelectorAll("[data-tab]").forEach((b) => (b.onclick = () => {
    state.tab = b.dataset.tab;
    renderEvent();
  }));

  ({ info: renderInfo, teams: renderTeams, schedule: renderSchedule, games: renderGames })[state.tab]();
}

/* ---------- Info y reglas ---------- */
const section = (icon, title, body, extra = "") => `
  <section class="tn-section ${extra}">
    <h2 class="tn-section__title"><i class="bi bi-${icon}"></i>${esc(title)}</h2>
    ${body}
  </section>`;

// Fila de división: categoría + rama, de las opciones de la plataforma
function divisionRow(d = {}) {
  const opts = state.divOptions;
  const name = String(d.name || "").toLowerCase();
  const level = d.level || opts.levels.find((l) => name.startsWith(l.toLowerCase())) || opts.levels[0];
  const gender = d.gender || opts.genders.find((g) => name.includes(g.name.toLowerCase()))?.id || opts.genders[0].id;
  return `
    <div class="tn-div-row" data-div-row data-id="${esc(d.id || "")}">
      <select class="form-select" data-div="level" aria-label="${esc(EX.divLevel)}">
        ${opts.levels.map((l) => `<option ${l === level ? "selected" : ""}>${esc(l)}</option>`).join("")}
      </select>
      <select class="form-select" data-div="gender" aria-label="${esc(EX.divGender)}">
        ${opts.genders.map((g) => `<option value="${esc(g.id)}" ${g.id === gender ? "selected" : ""}>${esc(g.name)}</option>`).join("")}
      </select>
      <button type="button" class="btn btn-light text-danger" data-div-del title="${esc(EX.delete)}"><i class="bi bi-x-lg"></i></button>
    </div>`;
}

function readDivisions() {
  const opts = state.divOptions;
  const used = new Set();
  return [...document.querySelectorAll("[data-div-row]")].map((row) => {
    const level = row.querySelector("[data-div=level]").value;
    const g = opts.genders.find((x) => x.id === row.querySelector("[data-div=gender]").value) || opts.genders[0];
    const name = `${level} ${g.name}`;
    // se conserva el id de las divisiones existentes (equipos y partidos lo usan)
    let id = row.dataset.id || slugify(name) || "open";
    while (used.has(id)) id += "-2";
    used.add(id);
    return { id, name, level, gender: g.id, mixed: !!g.mixed };
  });
}

function publishSection(e) {
  const pub = `${location.origin}${eventUrl(e)}`;
  const linkBox = (id, url, wa) => `
    <div class="input-group input-group-sm mt-2">
      <input class="form-control" readonly value="${esc(url)}" aria-label="${esc(EX.copy)}" />
      <button class="btn btn-outline-secondary" type="button" data-copy-link="${esc(url)}"><i class="bi bi-clipboard me-1"></i>${esc(EX.regCopyLink)}</button>
      <a class="btn btn-outline-success" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent(wa)}"><i class="bi bi-whatsapp"></i></a>
    </div>`;
  return section("megaphone", EX.secPublish, `
    <div class="row g-4">
      <div class="col-12 col-lg-6">
        <div class="form-check form-switch fs-6">
          <input class="form-check-input" type="checkbox" id="ePublic" ${e.isPublic ? "checked" : ""} ${isApproved(e) ? "" : "disabled"} />
          <label class="form-check-label fw-semibold" for="ePublic">${esc(EX.eventPublic)}</label>
        </div>
        <div class="form-text">${esc(isApproved(e) ? EX.publicHint : EX.approvalNeeded)}</div>
        ${e.isPublic ? linkBox("pub", pub, exf(EX.waPublic, { event: e.name, url: pub })) : ""}
      </div>
      <div class="col-12 col-lg-6">
        <div class="form-check form-switch fs-6">
          <input class="form-check-input" type="checkbox" id="eRegOpen" ${e.registrationOpen ? "checked" : ""} />
          <label class="form-check-label fw-semibold" for="eRegOpen">${esc(EX.regOpen)}</label>
        </div>
        <div class="form-text">${esc(isApproved(e) ? EX.regOpenHint : EX.regOpenNeedsActive)}</div>
        ${e.registrationOpen ? linkBox("reg", registerLink(), exf(EX.waRegister, { event: e.name, url: registerLink() })) : ""}
      </div>
    </div>`, "tn-section--highlight");
}

function renderInfo() {
  const e = state.event;
  const r = eventRules(e);
  const f = (id, label, value, { type = "text", col = "col-12 col-md-6", attrs = "", hint = "" } = {}) => `
    <div class="${col}">
      <label class="form-label small" for="${id}">${esc(label)}</label>
      <input class="form-control" id="${id}" type="${type}" value="${esc(value ?? "")}" ${attrs} />
      ${hint ? `<div class="form-text">${esc(hint)}</div>` : ""}
    </div>`;
  const mode = GAME_MODES.find((m) => m.id === r.mode) || GAME_MODES[0];
  const tab = document.getElementById("evTab");
  tab.innerHTML = `
    ${publishSection(e)}
    <form id="evInfoForm" class="mt-3">
      ${section("info-circle", EX.secInfo, `
        <div class="row g-3">
          <div class="col-12">
            <label class="form-label small">${esc(EX.eventImage)}</label>
            <div class="d-flex flex-wrap gap-3 align-items-end">
              ${e.image
                ? `<img class="tn-cover-preview" src="${esc(e.image)}" alt="${esc(EX.eventImage)}" />`
                : `<label class="tn-cover-empty" for="eImage" role="button"><i class="bi bi-image fs-3"></i><span class="small">${esc(EX.eventImageUpload)}</span></label>`}
              <div class="d-flex flex-column gap-2">
                <label class="btn btn-sm btn-outline-primary mb-0"><i class="bi bi-upload me-1"></i>${esc(e.image ? EX.eventImageChange : EX.eventImageUpload)}<input type="file" accept="image/*" id="eImage" hidden /></label>
                ${e.image ? `<button type="button" class="btn btn-sm btn-light text-danger" id="eImageDel"><i class="bi bi-trash me-1"></i>${esc(EX.eventImageRemove)}</button>` : ""}
              </div>
            </div>
            <div class="form-text">${esc(EX.eventImageHint)}</div>
          </div>
          ${f("eName", EX.eventName, e.name, { col: "col-12 col-md-8" })}
          <div class="col-12 col-md-4">
            <label class="form-label small" for="eStatus">${esc(EX.eventStatus)}</label>
            <select class="form-select" id="eStatus">
              <option value="draft">${esc(EX.statusDraft)}</option>
              <option value="published" ${isApproved(e) ? "" : "disabled"}>${esc(EX.statusPublished)}</option>
              <option value="finished">${esc(EX.statusFinished)}</option>
            </select>
          </div>
          <div class="col-12 col-md-6">
            <label class="form-label small" for="eSlug">${esc(EX.eventSlug)}</label>
            <div class="input-group"><span class="input-group-text small">/torneos/evento.html?e=</span><input class="form-control" id="eSlug" value="${esc(e.slug || "")}" /></div>
          </div>
          ${f("eStart", EX.eventStart, e.startDate, { type: "date", col: "col-6 col-md-3" })}
          ${f("eEnd", EX.eventEnd, e.endDate, { type: "date", col: "col-6 col-md-3" })}
          ${f("eVenue", EX.eventVenue, e.venue)}
          ${f("eAddress", EX.eventAddress, e.address)}
          ${f("eMaps", EX.eventMaps, e.mapsUrl, { col: "col-12", hint: EX.eventMapsHint })}
          <div class="col-12">
            <label class="form-label small" for="eDesc">${esc(EX.eventDescription)}</label>
            <textarea class="form-control" id="eDesc" rows="3">${esc(e.description || "")}</textarea>
          </div>
        </div>`)}

      ${section("diagram-3", EX.secDivisions, `
        <div class="row g-4">
          <div class="col-12 col-lg-7">
            <label class="form-label small">${esc(EX.eventDivisions)}</label>
            <div id="eDivRows">${divisions().map(divisionRow).join("")}</div>
            <button type="button" class="btn btn-sm btn-outline-primary" id="eDivAdd"><i class="bi bi-plus-lg me-1"></i>${esc(EX.divAdd)}</button>
            <div class="form-text">${esc(EX.divHint)}</div>
          </div>
          <div class="col-12 col-lg-5">
            <label class="form-label small" for="rMode">${esc(EX.ruleMode)}</label>
            <div class="d-flex gap-2">
              <select class="form-select" id="rMode">${GAME_MODES.map((m) => `<option value="${esc(m.id)}" ${m.id === mode.id ? "selected" : ""}>${esc(m.label)}</option>`).join("")}</select>
              <input class="form-control ${mode.id === "other" ? "" : "d-none"}" style="max-width:7rem" id="rPlayers" type="number" min="1" max="15" value="${esc(r.playersOnField)}" aria-label="${esc(EX.rulePlayers)}" placeholder="${esc(EX.rulePlayers)}" />
            </div>
            <div class="form-text">${esc(EX.ruleModeHint)}</div>
            <label class="form-label small mt-3" for="rRatioRule">${esc(EX.ruleRatio)}</label>
            <select class="form-select" id="rRatioRule">${RATIO_RULES.map((id) => `<option value="${id}" ${r.ratioRule === id ? "selected" : ""}>${esc(EX[`ruleRatio_${id}`])}</option>`).join("")}</select>
            <select class="form-select mt-2 ${r.ratioRule === "fixed" ? "" : "d-none"}" id="rRatioFixed" aria-label="${esc(EX.ruleRatio_fixed)}">
              <option value="M" ${r.ratioFixed === "M" ? "selected" : ""}>${esc(EX.ruleRatioFixedM)}</option>
              <option value="F" ${r.ratioFixed === "F" ? "selected" : ""}>${esc(EX.ruleRatioFixedF)}</option>
            </select>
            <div class="form-text">${esc(EX.ruleRatioHint)}</div>
            <label class="form-label small mt-3" for="eFields">${esc(EX.eventFields)}</label>
            <textarea class="form-control" id="eFields" rows="3">${esc(fields().join("\n"))}</textarea>
          </div>
        </div>`)}

      ${section("stopwatch", EX.rulesTitle, `
        <div class="row g-3">
          ${f("rGameMin", EX.ruleGameMinutes, r.gameMinutes, { type: "number", col: "col-6 col-md-4", attrs: 'min="0" step="any"' })}
          ${f("rGap", EX.ruleBetweenGames, r.betweenGamesMin, { type: "number", col: "col-6 col-md-4", attrs: 'min="0" step="any"' })}
          <div class="col-12 col-md-4 d-flex align-items-end">
            <div class="form-check form-switch mb-2">
              <input class="form-check-input" type="checkbox" id="rStopBreaks" ${r.stopClockOnBreaks ? "checked" : ""} />
              <label class="form-check-label" for="rStopBreaks">${esc(EX.ruleStopOnBreaks)}</label>
            </div>
          </div>
          <div class="col-12 mt-0"><div class="form-text">${esc(EX.ruleGameMinutesHint)} ${esc(EX.ruleStopOnBreaksHint)} ${esc(EX.ruleBetweenGamesHint)}</div></div>
          ${f("rGameTo", EX.ruleGameTo, r.gameTo, { type: "number", col: "col-6 col-md-3", attrs: 'min="1"' })}
          ${f("rHalf", EX.ruleHalftimeAt, r.halftimeAt, { type: "number", col: "col-6 col-md-3", attrs: 'min="1"' })}
          ${f("rSoft", EX.ruleSoftCap, r.softCapMin || "", { type: "number", col: "col-6 col-md-3", attrs: 'min="0"' })}
          ${f("rHard", EX.ruleHardCap, r.hardCapMin || "", { type: "number", col: "col-6 col-md-3", attrs: 'min="0"' })}
          ${f("rTo", EX.ruleTimeouts, r.timeoutsPerHalf, { type: "number", col: "col-6 col-md-4", attrs: 'min="0"' })}
          ${f("rToSec", EX.ruleTimeoutSeconds, r.timeoutSeconds, { type: "number", col: "col-6 col-md-4", attrs: 'min="0"' })}
          ${f("rHalfMin", EX.ruleHalftimeMinutes, r.halftimeMinutes, { type: "number", col: "col-6 col-md-4", attrs: 'min="0" step="any"' })}
          <div class="col-12">
            <div class="form-check form-switch">
              <input class="form-check-input" type="checkbox" id="rAudit" ${r.auditLog ? "checked" : ""} />
              <label class="form-check-label" for="rAudit">${esc(EX.ruleAudit)}</label>
            </div>
            <div class="form-text">${esc(EX.ruleAuditHint)}</div>
          </div>
        </div>`)}

      ${section("trophy", EX.mvpTitle, `
        <div class="form-text mt-0 mb-2">${esc(EX.mvpHint)}</div>
        <div class="row g-3">
          ${f("mG", EX.mvpGoals, r.mvp.goals, { type: "number", col: "col-6 col-md-3", attrs: 'step="0.5"' })}
          ${f("mA", EX.mvpAssists, r.mvp.assists, { type: "number", col: "col-6 col-md-3", attrs: 'step="0.5"' })}
          ${f("mB", EX.mvpBlocks, r.mvp.blocks, { type: "number", col: "col-6 col-md-3", attrs: 'step="0.5"' })}
          ${f("mT", EX.mvpTurns, r.mvp.turns, { type: "number", col: "col-6 col-md-3", attrs: 'step="0.5"' })}
        </div>`)}

      ${section("people", EX.organizers, `
        <textarea class="form-control" id="eOrganizers" rows="2" ${e.ownerUid === state.user.uid ? "" : "disabled"}>${esc((e.organizerEmails || []).join("\n"))}</textarea>
        <div class="form-text">${esc(EX.organizersHint)}</div>`)}

      <div class="tn-save-bar d-flex justify-content-between flex-wrap gap-2">
        <button type="button" class="btn btn-outline-danger ${e.ownerUid === state.user.uid ? "" : "invisible"}" id="eDelete"><i class="bi bi-trash me-1"></i>${esc(EX.delete)}</button>
        <button type="submit" class="btn btn-primary px-4"><i class="bi bi-save me-1"></i>${esc(EX.save)}</button>
      </div>
    </form>`;

  document.getElementById("eStatus").value = e.status || "draft";
  const v = (id) => document.getElementById(id).value.trim();
  const num = (id) => Number(v(id)) || 0;

  // publicar e inscripciones: se guardan al tocar el switch
  const quickSave = (patch) => run(async () => {
    await saveEvent(e.id, patch);
    Object.assign(state.event, patch);
    alertBox(EX.saved);
    renderInfo();
  });
  document.getElementById("ePublic").onchange = (ev) => quickSave({ isPublic: isApproved(e) && ev.target.checked });
  document.getElementById("eRegOpen").onchange = (ev) => quickSave({ registrationOpen: ev.target.checked });
  tab.querySelectorAll("[data-copy-link]").forEach((b) => (b.onclick = async () => {
    try {
      await navigator.clipboard.writeText(b.dataset.copyLink);
      alertBox(EX.regLinkCopied);
    } catch {
      prompt(EX.regCopyLink, b.dataset.copyLink);
    }
  }));

  // imagen del torneo: se recorta y se guarda al momento
  document.getElementById("eImage").onchange = async (ev) => {
    let image = null;
    try {
      image = await cropFromInput(ev.target, { aspect: 2, width: 1000, maxChars: 260000, title: EX.cropCover });
    } catch {
      return alertBox(EX.imageBad, "warning");
    }
    if (!image) return;
    run(async () => {
      await saveEvent(e.id, { image });
      state.event.image = image;
      alertBox(EX.eventImageSaved);
      renderInfo();
    });
  };
  document.getElementById("eImageDel")?.addEventListener("click", () => run(async () => {
    await saveEvent(e.id, { image: "" });
    state.event.image = "";
    renderInfo();
  }));

  // divisiones
  document.getElementById("eDivAdd").onclick = () => {
    document.getElementById("eDivRows").insertAdjacentHTML("beforeend", divisionRow({}));
  };
  document.getElementById("eDivRows").onclick = (ev) => {
    const del = ev.target.closest("[data-div-del]");
    if (!del) return;
    if (document.querySelectorAll("[data-div-row]").length <= 1) return alertBox(EX.divNeedOne, "warning");
    const row = del.closest("[data-div-row]");
    const id = row.dataset.id;
    const inUse = id && (state.teams.some((t) => t.divisionId === id) || state.games.some((g) => g.divisionId === id));
    if (inUse && !confirm(EX.divInUse)) return;
    row.remove();
  };
  document.getElementById("rMode").onchange = (ev) => {
    document.getElementById("rPlayers").classList.toggle("d-none", ev.target.value !== "other");
  };
  document.getElementById("rRatioRule").onchange = (ev) => {
    document.getElementById("rRatioFixed").classList.toggle("d-none", ev.target.value !== "fixed");
  };

  document.getElementById("evInfoForm").onsubmit = (ev) => {
    ev.preventDefault();
    run(async () => {
      const modeId = v("rMode");
      const modeDef = GAME_MODES.find((m) => m.id === modeId) || GAME_MODES[0];
      const data = {
        name: v("eName"),
        slug: slugify(v("eSlug") || v("eName")) || e.slug,
        status: !isApproved(e) && v("eStatus") === "published" ? "draft" : v("eStatus"),
        organizerEmails: e.ownerUid === state.user.uid
          ? v("eOrganizers").split(/[\n,;]+/).map((x) => x.trim().toLowerCase()).filter((x) => x.includes("@"))
          : e.organizerEmails || [],
        startDate: v("eStart"),
        endDate: v("eEnd"),
        venue: v("eVenue"),
        address: v("eAddress"),
        mapsUrl: v("eMaps"),
        description: v("eDesc"),
        divisions: readDivisions(),
        fields: v("eFields").split(/\n+/).map((s) => s.trim()).filter(Boolean),
        rules: {
          mode: modeDef.id,
          playersOnField: modeDef.players || num("rPlayers") || 7,
          ratioRule: v("rRatioRule") || "abba",
          ratioFixed: v("rRatioFixed") === "F" ? "F" : "M",
          gameMinutes: num("rGameMin"),
          betweenGamesMin: num("rGap"),
          stopClockOnBreaks: document.getElementById("rStopBreaks").checked,
          auditLog: document.getElementById("rAudit").checked,
          gameTo: num("rGameTo") || 13,
          halftimeAt: num("rHalf") || 7,
          softCapMin: num("rSoft"),
          hardCapMin: num("rHard"),
          timeoutsPerHalf: num("rTo"),
          timeoutSeconds: num("rToSec"),
          halftimeMinutes: num("rHalfMin"),
          mvp: { goals: Number(v("mG")), assists: Number(v("mA")), blocks: Number(v("mB")), turns: Number(v("mT")) },
        },
      };
      await saveEvent(e.id, data);
      Object.assign(state.event, data);
      alertBox(EX.saved);
      renderEvent();
    });
  };

  document.getElementById("eDelete").onclick = () => {
    if (!confirm(EX.confirmDelete)) return;
    run(async () => {
      await deleteEvent(e.id);
      state.event = null;
      await renderList();
    });
  };
}

/* ---------- Equipos ---------- */
function captainSelect(field, label, t) {
  return `
    <div class="col-6 col-md-3">
      <label class="form-label small">${esc(label)}</label>
      <select class="form-select form-select-sm" data-f="${field}">
        <option value="">—</option>
        ${(t.players || []).map((p) => `<option value="${esc(p.id)}" ${p.id === t[field] ? "selected" : ""}>${esc(p.name)}${p.number !== null && p.number !== undefined ? ` #${esc(p.number)}` : ""}</option>`).join("")}
      </select>
    </div>`;
}

function teamCard(t = {}) {
  const reg = t.registrationId ? state.regs.find((r) => r.id === t.registrationId) : null;
  return `
    <form class="ev-card ev-team-card" data-team="${esc(t.id || "")}">
      ${t.id ? `<div class="d-flex align-items-center gap-2 mb-2">
        ${teamBadge(t, 36)}
        <div class="fw-bold flex-grow-1 text-truncate">${esc(t.name || "")}</div>
        ${reg ? `<span class="small ev-muted text-truncate">${esc(exf(EX.regManagedBy, { who: reg.managerEmail || reg.managerName || "" }))}${reg.contact ? ` · ${esc(reg.contact)}` : ""}</span>` : ""}
      </div>` : ""}
      <div class="row g-2">
        <div class="col-12 col-md-4"><label class="form-label small">${esc(EX.teamName)}</label><input class="form-control" data-f="name" value="${esc(t.name || "")}" required /></div>
        <div class="col-6 col-md-3"><label class="form-label small">${esc(EX.teamCity)}</label><input class="form-control" data-f="city" value="${esc(t.city || "")}" /></div>
        <div class="col-6 col-md-2"><label class="form-label small">${esc(EX.teamColor)}</label><input class="form-control form-control-color w-100" type="color" data-f="color" value="${esc(t.color || "#19473f")}" /></div>
        <div class="col-6 col-md-2">
          <label class="form-label small">${esc(EX.teamDivision)}</label>
          <select class="form-select" data-f="divisionId">${divisions().map((d) => `<option value="${esc(d.id)}" ${d.id === t.divisionId ? "selected" : ""}>${esc(d.name)}</option>`).join("")}</select>
        </div>
        <div class="col-6 col-md-1"><label class="form-label small">${esc(EX.teamPool)}</label><input class="form-control" data-f="pool" maxlength="3" value="${esc(t.pool || "")}" title="${esc(EX.teamPoolHint)}" /></div>
        <div class="col-12">
          <label class="form-label small">${esc(EX.roster)} · <span class="ev-muted">${esc(exf(EX.playersCount, { n: (t.players || []).length }))}</span></label>
          <textarea class="form-control" data-f="roster" rows="${Math.min(10, Math.max(3, (t.players || []).length + 1))}" placeholder="${esc(EX.rosterHint)}">${esc(rosterToText(t.players || []))}</textarea>
          <div class="form-text">${esc(EX.rosterHint)}</div>
        </div>
        ${t.id ? captainSelect("captainId", EX.captain, t) + captainSelect("spiritCaptainId", EX.spiritCaptain, t) : ""}
        <div class="col-12 d-flex justify-content-between gap-2">
          <button type="button" class="btn btn-sm btn-outline-danger" data-team-delete>${esc(EX.delete)}</button>
          <button type="submit" class="btn btn-sm btn-primary">${esc(EX.save)}</button>
        </div>
      </div>
    </form>`;
}

function renderTeams() {
  const tab = document.getElementById("evTab");
  tab.innerHTML = `
    <div class="d-flex justify-content-between align-items-center mb-2">
      <div class="small ev-muted">${esc(EX.teamPoolHint)}</div>
      <button class="btn btn-sm btn-outline-primary" id="evAddTeam"><i class="bi bi-plus-lg me-1"></i>${esc(EX.addTeam)}</button>
    </div>
    ${requestsSection()}
    <div id="evTeams">${state.teams.length ? state.teams.map(teamCard).join("") : `<div class="ev-card ev-muted">${esc(EX.noTeams)}</div>`}</div>`;

  document.getElementById("evAddTeam").onclick = () => {
    const wrap = document.getElementById("evTeams");
    if (!state.teams.length) wrap.innerHTML = "";
    wrap.insertAdjacentHTML("afterbegin", teamCard({ divisionId: divisions()[0].id }));
    wrap.querySelector("[data-f=name]").focus();
  };

  tab.addEventListener("submit", (ev) => {
    const form = ev.target.closest("[data-team]");
    if (!form) return;
    ev.preventDefault();
    const val = (k) => form.querySelector(`[data-f=${k}]`).value.trim();
    const prev = state.teams.find((t) => t.id === form.dataset.team);
    run(async () => {
      const team = {
        id: form.dataset.team || undefined,
        name: val("name"),
        city: val("city"),
        color: val("color"),
        divisionId: val("divisionId"),
        pool: val("pool").toUpperCase(),
        players: parseRoster(form.querySelector("[data-f=roster]").value, prev?.players || []),
      };
      if (prev) {
        team.captainId = form.querySelector("[data-f=captainId]")?.value || "";
        team.spiritCaptainId = form.querySelector("[data-f=spiritCaptainId]")?.value || "";
      }
      if (!team.name) return;
      await saveTeam(state.event.id, team);
      await reloadData();
      alertBox(EX.saved);
      renderEvent();
    });
  });

  tab.addEventListener("click", (ev) => {
    const decide = ev.target.closest("[data-reg-approve],[data-reg-reject]");
    if (decide) {
      const reg = state.regs.find((r) => r.id === decide.dataset.regApprove || r.id === decide.dataset.regReject);
      if (!reg) return;
      if (decide.dataset.regReject) {
        const note = prompt(EX.regRejectNote, "");
        if (note === null) return;
        return run(async () => {
          await rejectRegistration(state.event.id, reg.id, note);
          await reloadData();
          renderEvent();
        });
      }
      return run(async () => {
        await approveRegistration(state.event.id, reg);
        await reloadData();
        alertBox(EX.saved);
        renderEvent();
      });
    }
    if (!ev.target.closest("[data-team-delete]")) return;
    const form = ev.target.closest("[data-team]");
    if (!form.dataset.team) return form.remove();
    if (!confirm(EX.confirmDelete)) return;
    run(async () => {
      await deleteTeam(state.event.id, form.dataset.team);
      await reloadData();
      renderEvent();
    });
  });
}

function requestsSection() {
  const regs = state.regs.filter((r) => r.status !== REG.APPROVED);
  if (!regs.length && !state.event.registrationOpen) return "";
  const divName = (id) => divisions().find((d) => d.id === id)?.name || "";
  const pname = (r, id) => (r.players || []).find((p) => p.id === id)?.name || "—";
  return `
    <h2 class="h6 mt-1 mb-2">${esc(EX.regRequests)}</h2>
    ${regs.length ? regs.map((r) => {
      const ps = r.players || [];
      return `
        <div class="ev-card tn-reg-card">
          <div class="d-flex align-items-center gap-2 flex-wrap">
            ${teamBadge(r, 40)}
            <div class="flex-grow-1 min-w-0">
              <div class="fw-bold">${esc(r.name || "—")} ${regChip(r.status)}</div>
              <div class="small ev-muted text-truncate">${esc([r.city, divisions().length > 1 ? divName(r.divisionId) : "", exf(EX.regManagedBy, { who: r.managerEmail || r.managerName || "" }), r.contact].filter(Boolean).join(" · "))}</div>
            </div>
            ${r.status === REG.PENDING ? `
              <button class="btn btn-sm btn-outline-danger" data-reg-reject="${esc(r.id)}">${esc(EX.regReject)}</button>
              <button class="btn btn-sm btn-success" data-reg-approve="${esc(r.id)}"><i class="bi bi-check-lg me-1"></i>${esc(EX.regApprove)}</button>` : ""}
          </div>
          <div class="small">
            <i class="bi bi-star-fill text-warning"></i> ${esc(pname(r, r.captainId))}
            · <i class="bi bi-heart-fill text-danger"></i> ${esc(pname(r, r.spiritCaptainId))}
            · ${esc(exf(EX.playersSummary, { n: ps.length, f: ps.filter((p) => p.gender === "F").length, m: ps.filter((p) => p.gender === "M").length }))}
          </div>
          <details class="small"><summary class="ev-muted">${esc(EX.roster)}</summary>
            <div class="mt-1">${ps.map((p) => esc(`${p.number ?? ""} ${p.name} (${p.gender || "?"})`.trim())).join(" · ")}</div>
          </details>
          ${r.status === REG.REJECTED && r.note ? `<div class="small ev-muted">${esc(r.note)}</div>` : ""}
        </div>`;
    }).join("") : `<div class="ev-card ev-muted small mb-3">${esc(EX.regNoRequests)}</div>`}
    <h2 class="h6 mt-3 mb-2">${esc(EX.tabTeams)}</h2>`;
}

/* ---------- Calendario ---------- */
const pairKey = (a, b) => [a, b].sort().join("|");
const gameDivision = (g) => g.divisionId || divisions()[0].id;

function renderSchedule() {
  const tab = document.getElementById("evTab");
  const defaultStart = state.event.startDate ? `${state.event.startDate}T08:00` : "";
  const teamOpts = (sel) => state.teams.map((t) => `<option value="${esc(t.id)}" ${t.id === sel ? "selected" : ""}>${esc(t.name)}</option>`).join("");
  const r = eventRules(state.event);
  tab.innerHTML = `
    <form class="tn-section" id="evGenForm">
      <h2 class="tn-section__title"><i class="bi bi-magic"></i>${esc(EX.scheduleTitle)}</h2>
      <div class="small ev-muted mb-3">${esc(EX.scheduleHint)}</div>
      <div class="row g-3">
        <div class="col-12 col-md-4">
          <label class="form-label small" for="gFormat">${esc(EX.format)}</label>
          <select class="form-select" id="gFormat">
            ${listFormats().map((f) => `<option value="${esc(f.id)}" ${f.available ? "" : "disabled"} ${f.id === (state.event.format || "round_robin") ? "selected" : ""}>${esc(f.label)}${f.available ? "" : ` ${esc(EX.formatComingSoon)}`}</option>`).join("")}
          </select>
        </div>
        <div class="col-12 col-md-4">
          <label class="form-label small" for="gDivision">${esc(EX.scheduleDivision)}</label>
          <select class="form-select" id="gDivision">${divisions().map((d) => `<option value="${esc(d.id)}">${esc(d.name)}</option>`).join("")}</select>
        </div>
        <div class="col-12 col-md-4">
          <label class="form-label small" for="gStart">${esc(EX.scheduleStart)}</label>
          <input class="form-control" id="gStart" type="datetime-local" value="${esc(defaultStart)}" />
        </div>
        <div class="col-12">
          <div class="form-text m-0"><i class="bi bi-clock me-1"></i>${esc(exf(EX.scheduleSlotInfo, { slot: slotMinutes(r), game: r.gameMinutes || r.hardCapMin || 90, gap: r.betweenGamesMin || 0 }))}</div>
          <div class="form-text m-0"><i class="bi bi-arrow-repeat me-1"></i>${esc(EX.scheduleReplaceInfo)}</div>
        </div>
        <div class="col-12 d-flex justify-content-end">
          <button class="btn btn-primary" type="submit"><i class="bi bi-magic me-1"></i>${esc(EX.generate)}</button>
        </div>
      </div>
    </form>

    <form class="tn-section" id="evManualForm">
      <h2 class="tn-section__title"><i class="bi bi-plus-circle"></i>${esc(EX.addGameManual)}</h2>
      <div class="row g-2">
        <div class="col-12 col-md-3"><label class="form-label small">${esc(EX.phase)}</label><input class="form-control" id="mPhase" placeholder="Semifinal" /></div>
        <div class="col-6 col-md-3"><label class="form-label small">${esc(EX.teamA)}</label><select class="form-select" id="mA">${teamOpts()}</select></div>
        <div class="col-6 col-md-3"><label class="form-label small">${esc(EX.teamB)}</label><select class="form-select" id="mB">${teamOpts(state.teams[1]?.id)}</select></div>
        <div class="col-6 col-md-3"><label class="form-label small">${esc(EX.field)}</label><select class="form-select" id="mField">${fields().map((f) => `<option>${esc(f)}</option>`).join("")}</select></div>
        <div class="col-6 col-md-4"><label class="form-label small">${esc(EX.startAt)}</label><input class="form-control" id="mStart" type="datetime-local" value="${esc(defaultStart)}" /></div>
        <div class="col-12 col-md-8 d-flex align-items-end justify-content-end"><button class="btn btn-outline-primary" type="submit"><i class="bi bi-plus-lg me-1"></i>${esc(EX.add)}</button></div>
      </div>
    </form>`;

  document.getElementById("evGenForm").onsubmit = (ev) => {
    ev.preventDefault();
    const formatId = document.getElementById("gFormat").value;
    const divisionId = document.getElementById("gDivision").value;
    const teams = state.teams.filter((t) => (t.divisionId || divisions()[0].id) === divisionId);
    if (teams.length < 2) return alertBox(EX.generateNeedTeams, "warning");
    // los partidos sin jugar de la división se reemplazan; los jugados se conservan
    const existing = state.games.filter((g) => gameDivision(g) === divisionId);
    const unplayed = existing.filter(isUnplayed);
    const played = new Set(existing.filter((g) => !isUnplayed(g)).map((g) => pairKey(g.teamA?.id, g.teamB?.id)));
    if (unplayed.length && !confirm(exf(EX.generateReplaceConfirm, { n: unplayed.length }))) return;
    run(async () => {
      const removed = await deleteUnplayedGames(state.event.id, unplayed, state.keys);
      const raw = getFormat(formatId).generate(teams, { event: state.event })
        .filter((g) => !played.has(pairKey(g.teamA?.id, g.teamB?.id)));
      const slotted = assignSlots(raw, {
        fields: fields(),
        start: fromLocalInput(document.getElementById("gStart").value),
        gameMinutes: slotMinutes(eventRules(state.event)),
      }).map((g) => ({ ...g, divisionId }));
      await createGames(state.event.id, slotted);
      await saveEvent(state.event.id, { format: formatId });
      state.event.format = formatId;
      await reloadData();
      alertBox(removed ? exf(EX.generatedReplaced, { n: slotted.length, removed }) : exf(EX.generated, { n: slotted.length }));
      state.tab = "games";
      renderEvent();
    });
  };

  document.getElementById("evManualForm").onsubmit = (ev) => {
    ev.preventDefault();
    const a = state.teams.find((t) => t.id === document.getElementById("mA").value);
    const b = state.teams.find((t) => t.id === document.getElementById("mB").value);
    if (!a || !b || a.id === b.id) return alertBox(EX.generateNeedTeams, "warning");
    run(async () => {
      await createGames(state.event.id, [{
        phase: document.getElementById("mPhase").value.trim(),
        teamA: a,
        teamB: b,
        divisionId: a.divisionId || "",
        field: document.getElementById("mField").value,
        startAt: fromLocalInput(document.getElementById("mStart").value),
      }]);
      await reloadData();
      alertBox(exf(EX.generated, { n: 1 }));
      state.tab = "games";
      renderEvent();
    });
  };
}

/* ---------- Partidos y links ---------- */
function orgGameCard(game) {
  const g = withLiveTeams(game, state.teams);
  const token = state.keys.get(g.id);
  const url = token ? scorekeeperUrl(state.event.id, g.id, token) : "";
  const divName = divisions().length > 1 ? divisions().find((d) => d.id === g.divisionId)?.name || "" : "";
  const started = g.status !== GAME_STATUS.SCHEDULED;
  const team = (t, side) => `
    <div class="tn-org-game__team ${side === "B" ? "tn-org-game__team--b" : ""}">
      ${side === "A" ? teamBadge(t || {}, 36) : ""}<span class="text-truncate">${esc(t?.name || "—")}</span>${side === "B" ? teamBadge(t || {}, 36) : ""}
    </div>`;
  return `
    <div class="tn-org-game" data-game="${esc(g.id)}">
      <div class="d-flex justify-content-between align-items-center gap-2 flex-wrap">
        <div class="small ev-muted">${esc([phaseLabel(g), divName].filter(Boolean).join(" · ") || EX.tabGames)}</div>
        ${statusChip(g.status)}
      </div>
      <div class="tn-org-game__teams">
        ${team(g.teamA, "A")}
        <div class="tn-org-game__score">${started ? `${g.scoreA || 0} – ${g.scoreB || 0}` : `<span class="ev-muted fs-6">${esc(EX.vs)}</span>`}</div>
        ${team(g.teamB, "B")}
      </div>
      <div class="row g-2 mb-2">
        <div class="col-7 col-md-4"><input class="form-control form-control-sm" type="datetime-local" data-gf="startAt" value="${esc(toLocalInput(g.startAt))}" aria-label="${esc(EX.startAt)}" /></div>
        <div class="col-5 col-md-3"><select class="form-select form-select-sm" data-gf="field" aria-label="${esc(EX.field)}">${["", ...fields()].map((f) => `<option ${f === g.field ? "selected" : ""}>${esc(f)}</option>`).join("")}</select></div>
      </div>
      <div class="tn-org-game__bar">
        <div class="d-flex flex-wrap gap-2 align-items-center">
          ${url ? `
            <span class="small fw-semibold ev-muted">${esc(EX.scorekeeperLink)}</span>
            <button class="btn btn-sm btn-outline-secondary" data-copy="${esc(url)}" title="${esc(EX.copy)}"><i class="bi bi-clipboard"></i></button>
            <a class="btn btn-sm btn-outline-success" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent(exf(EX.waScorekeeper, { a: g.teamA?.name, b: g.teamB?.name, event: state.event.name, url }))}"><i class="bi bi-whatsapp"></i></a>
            <a class="btn btn-sm btn-outline-primary" target="_blank" rel="noopener" href="${esc(url)}"><i class="bi bi-pencil-square me-1"></i>${esc(EX.openScorer)}</a>`
          : isApproved(state.event)
            ? `<button class="btn btn-sm btn-outline-primary" data-key="${esc(g.id)}" title="${esc(EX.linkHint)}"><i class="bi bi-link-45deg me-1"></i>${esc(EX.createLink)}</button>`
            : `<span class="small ev-muted">${esc(EX.approvalNeeded)}</span>`}
        </div>
        <div class="d-flex gap-2">
          <a class="btn btn-sm btn-light" target="_blank" rel="noopener" href="${esc(gameUrl(state.event.id, g.id))}" title="${esc(EX.liveTitle)}"><i class="bi bi-broadcast me-1"></i>${esc(EX.liveShort)}</a>
          <button class="btn btn-sm btn-light text-danger" data-del="${esc(g.id)}" title="${esc(EX.delete)}"><i class="bi bi-trash"></i></button>
        </div>
      </div>
    </div>`;
}

function renderGames() {
  const tab = document.getElementById("evTab");
  if (!state.games.length) {
    tab.innerHTML = `<div class="ev-card ev-muted">${esc(EX.noGames)}</div>`;
    return;
  }
  // por día, en orden de hora
  const sorted = state.games.slice().sort((a, b) => toMillis(a.startAt) - toMillis(b.startAt));
  const byDay = new Map();
  sorted.forEach((g) => {
    const day = toMillis(g.startAt) ? fmtDayOnly(g.startAt) : EX.noSchedule;
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day).push(g);
  });
  tab.innerHTML = `
    <div class="small ev-muted">${esc(EX.linkHint)}</div>
    ${[...byDay.entries()].map(([day, list]) => `
      <div class="tn-day-title">${esc(day.charAt(0).toUpperCase() + day.slice(1))}</div>
      ${list.map(orgGameCard).join("")}`).join("")}`;

  tab.onchange = (ev) => {
    const input = ev.target.closest("[data-gf]");
    if (!input) return;
    const gid = input.closest("[data-game]").dataset.game;
    const patch = input.dataset.gf === "startAt" ? { startAt: fromLocalInput(input.value) } : { field: input.value };
    run(async () => {
      await updateGame(state.event.id, gid, patch);
      Object.assign(state.games.find((g) => g.id === gid), patch);
      alertBox(EX.saved);
    });
  };

  tab.onclick = async (ev) => {
    const copy = ev.target.closest("[data-copy]");
    if (copy) {
      try {
        await navigator.clipboard.writeText(copy.dataset.copy);
        alertBox(EX.copied);
      } catch {
        prompt(EX.copy, copy.dataset.copy);
      }
      return;
    }
    const key = ev.target.closest("[data-key]");
    if (key) {
      return run(async () => {
        const token = await createGameKey(state.event.id, key.dataset.key);
        state.keys.set(key.dataset.key, token);
        renderGames();
      });
    }
    const del = ev.target.closest("[data-del]");
    if (del && confirm(EX.confirmDelete)) {
      run(async () => {
        await deleteGame(state.event.id, del.dataset.del);
        await reloadData();
        renderEvent();
      });
    }
  };
}

/* =========================
   Activación (aprobación de la plataforma + plan)
========================= */
function approvalChip(e) {
  const st = e.approval?.status || APPROVAL.NONE;
  if (st === APPROVAL.APPROVED) return `<span class="ev-chip ev-chip--final">${esc(e.approval.plan === "paid" ? EX.planPaid : EX.planTrial)}</span>`;
  if (st === APPROVAL.REQUESTED) return `<span class="ev-chip">${esc(EX.approvalPending)}</span>`;
  return "";
}

function approvalCard(e) {
  const a = e.approval || {};
  const st = a.status || APPROVAL.NONE;
  if (st === APPROVAL.APPROVED) {
    const plan = a.plan === "paid" ? EX.planPaid : EX.planTrial;
    const until = a.expiresAt ? ` ${exf(EX.approvalExpires, { date: fmtWhen(a.expiresAt, { day: "numeric", month: "short", year: "numeric" }) })}` : "";
    const status = `<div class="small"><i class="bi bi-check-circle me-1"></i>${esc(exf(EX.approvalApproved, { plan }))}${esc(until)}${a.adminNote ? ` · ${esc(a.adminNote)}` : ""}</div>`;
    // activo pero sin publicar: que se note y sea un clic
    if (!e.isPublic || e.status !== EVENT_STATUS.PUBLISHED) {
      return `
        <div class="ev-card tn-approval is-approved mb-3">
          ${status}
          <div class="d-flex justify-content-between align-items-center flex-wrap gap-2 mt-2">
            <div class="small ev-muted">${esc(EX.publishHint)}</div>
            <button class="btn btn-sm tn-btn-grad" type="button" id="tnPublishNow"><i class="bi bi-megaphone me-1"></i>${esc(EX.publishNow)}</button>
          </div>
        </div>`;
    }
    return `<div class="ev-card tn-approval is-approved mb-3">${status}</div>`;
  }
  if (st === APPROVAL.REQUESTED) {
    return `<div class="ev-card tn-approval mb-3 small"><i class="bi bi-hourglass-split me-1"></i>${esc(EX.approvalPending)}</div>`;
  }
  return `
    <form class="ev-card tn-approval ${st === APPROVAL.REJECTED ? "is-rejected" : ""} mb-3" id="tnApprovalForm">
      <div class="fw-bold mb-1">${esc(EX.approvalTitle)}</div>
      <div class="small ev-muted mb-2">${esc(st === APPROVAL.REJECTED ? exf(EX.approvalRejected, { note: a.adminNote || "" }) : EX.approvalNone)}</div>
      <div class="d-flex gap-2 flex-wrap">
        <input class="form-control form-control-sm flex-grow-1" style="min-width:220px" id="tnApprovalNote" maxlength="500" placeholder="${esc(EX.approvalRequestNote)}" />
        <button class="btn btn-sm tn-btn-grad" type="submit">${esc(EX.approvalRequest)}</button>
      </div>
    </form>`;
}

function bindApprovalCard() {
  const publish = document.getElementById("tnPublishNow");
  if (publish) {
    publish.onclick = () => run(async () => {
      await saveEvent(state.event.id, { isPublic: true, status: EVENT_STATUS.PUBLISHED });
      state.event.isPublic = true;
      state.event.status = EVENT_STATUS.PUBLISHED;
      alertBox(EX.published);
      renderEvent();
    });
  }
  const form = document.getElementById("tnApprovalForm");
  if (!form) return;
  form.onsubmit = (ev) => {
    ev.preventDefault();
    run(async () => {
      await requestApproval(state.event.id, document.getElementById("tnApprovalNote").value.trim());
      state.event.approval = { status: APPROVAL.REQUESTED };
      alertBox(EX.approvalRequested);
      renderEvent();
    });
  };
}

function renderSignIn() {
  root.innerHTML = `
    <div class="ev-card text-center py-5 mt-3" style="max-width:520px;margin:auto">
      <div class="display-6 mb-2">🏆</div>
      <h1 class="h4 fw-bold">${esc(EX.dirOrganize)}</h1>
      <p class="ev-muted">${esc(EX.signInToOrganize)}</p>
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
    renderNav({ active: "org", user, isAdmin: await isPlatformAdmin(state.user?.uid) });
    if (!state.user) return renderSignIn();
    const id = params.get("id");
    if (id) await openEvent(id);
    else await renderList();
  } catch (err) {
    console.error(err);
    alertBox(`${EX.error} ${err?.code || err?.message || ""}`, "danger");
  } finally {
    hideLoader();
  }
})();
