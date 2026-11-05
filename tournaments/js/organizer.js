// /tournaments/js/organizer.js
// Organizador (cualquier cuenta de Google): mis torneos, info y reglas, equipos, calendario (formatos),
// activación (aprobación + plan) y links de planillero.
import { countryOptions } from "/tournaments/js/countries.js";
import { EX, exf } from "/tournaments/js/strings.js";
import {
  DEFAULT_RULES,
  EVENT_STATUS,
  GAME_STATUS,
  RATIO_RULES,
  SURFACES,
  SURFACE_ICONS,
  eventRules,
  parseRoster,
  randomId,
  rosterToText,
  slotMinutes,
  slugify,
} from "/tournaments/js/model.js";
import { GAME_MODES, HAT_AGE_DEFAULTS } from "/tournaments/js/divisions-config.js";
import { PLAYER_FEE_MODES, hatGenders, isHatEvent } from "/tournaments/js/hat.js";
import { cropFromInput } from "/tournaments/js/cropper.js";
import { renderCreate, segHtml, segValue } from "/tournaments/js/create_event.js";
import { getFormat, listFormats } from "/tournaments/js/formats.js";
import { buildSchedule, playDays, scheduleWarnings } from "/tournaments/js/scheduler.js";
import { APPROVAL, REG, approveRegistration, deadlineEnd, registrationExpired, rosterLocked, createEvent, createGameKey, createGames, deleteEvent, deleteGame, deleteTeam, deleteUnplayedGames, isApproved, isUnplayed, isPlatformAdmin, listGameKeys, listGames, listMyEvents, listRegistrations, rejectRegistration, listTeams, loadDivisionOptions, loadEvent, requestApproval, saveEvent, saveTeam, scorekeeperUrl, updateGame, CURRENCIES, PAYMENT, decideRegistrationPayment, fmtMoney, teamFee, listWaiverStatus, waiverOn, waiverVersion } from "/tournaments/js/services.js";
import { askConfirm, atMinutes, scheduleDays, scheduleGridHtml, esc, eventUrl, fmtDateRange, fmtDayOnly, fmtWhen, fromLocalInput, gameUrl, hideLoader, isGoogleUser, phaseLabel, regChip, renderNav, showLoader, signInGoogle, statusChip, teamBadge, toLocalInput, toMillis, waitForUser, withLiveTeams, paymentChip } from "/tournaments/js/ui.js";

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
      <div class="d-flex gap-2 flex-wrap">
        <button class="btn btn-primary" id="evNew"><i class="bi bi-plus-lg me-1"></i>${esc(EX.newEvent)}</button>
      </div>
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

  // Nuevo torneo: por etapas (create_event.js): tipo (por equipos o hat), fechas, divisiones, cuotas y reglas
  $("#evNew").onclick = () => run(async () => {
    state.event = null;
    state.divOptions = state.divOptions || (await loadDivisionOptions());
    renderCreate({ state, run, alertBox, divisionRow, readDivisions, bindDivisionRows, openEvent, renderList, root });
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
  const [teams, games, keys, regs, waivers] = await Promise.all([
    listTeams(eid),
    listGames(eid),
    listGameKeys(eid).catch(() => []),
    listRegistrations(eid).catch(() => []),
    listWaiverStatus(eid).catch(() => []),
  ]);
  state.waivers = new Map(waivers.map((w) => [w.uid, w]));
  state.regs = regs;
  state.teams = teams;
  state.games = games;
  state.keys = new Map(keys.map((k) => [k.gameId, k.id]));
  // llaves: cuando un partido ya sabe sus equipos (ganó el anterior, terminó el grupo) se guardan en el partido,
  // así el planillero y las estadísticas trabajan con equipos reales
  const toSave = games.filter((g) => (g.slotA || g.slotB) && (g._filled?.A || g._filled?.B));
  await Promise.all(toSave.map((g) => updateGame(eid, g.id, {
    ...(g._filled.A ? { teamA: { id: g.teamA.id, name: g.teamA.name, color: g.teamA.color || "" } } : {}),
    ...(g._filled.B ? { teamB: { id: g.teamB.id, name: g.teamB.name, color: g.teamB.color || "" } } : {}),
  }).catch(() => {})));
}

const pendingRegs = () => state.regs.filter((r) => r.status === REG.PENDING);
// link para inscribirse: en un hat cada jugador se anota solo
const registerLink = () => (isHatEvent(state.event)
  ? `${location.origin}/tournaments/hat.html?e=${encodeURIComponent(state.event.id)}`
  : `${location.origin}/tournaments/team.html?e=${encodeURIComponent(state.event.id)}`);

const divisions = () => (state.event.divisions?.length ? state.event.divisions : [{ id: "open", name: "Open" }]);
const fields = () => state.event.fields || [];

function renderEvent() {
  const e = state.event;
  // hat: pestaña con el pool de jugadores, el armado de equipos y publicar (organizer_hat.js)
  const hat = isHatEvent(e);
  if (!hat && state.tab === "hat") state.tab = "info";
  const tabs = [
    ["info", EX.tabInfo],
    ...(hat ? [["hat", EX.hatTab]] : []),
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
      <div class="d-flex gap-2 flex-wrap">
        <button class="btn btn-sm btn-outline-secondary" data-export="pdf" title="${esc(EX.exDownload)}"><i class="bi bi-file-earmark-pdf me-1"></i>${esc(EX.exPdf)}</button>
        <button class="btn btn-sm btn-outline-secondary" data-export="xlsx" title="${esc(EX.exDownload)}"><i class="bi bi-file-earmark-spreadsheet me-1"></i>${esc(EX.exExcel)}</button>
        <a class="btn btn-sm btn-outline-secondary" href="${esc(eventUrl(e))}" target="_blank" rel="noopener"><i class="bi bi-box-arrow-up-right me-1"></i>${esc(EX.openPublic)}</a>
      </div>
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

  ({ info: renderInfo, hat: renderHatTab, teams: renderTeams, schedule: renderSchedule, games: renderGames })[state.tab]();
}

/* ---------- Hat ---------- */
// Pool de jugadores, armado de equipos y publicar: en su propio módulo (se carga solo en torneos hat)
async function renderHatTab() {
  const tab = document.getElementById("evTab");
  const { renderHat } = await import("/tournaments/js/organizer_hat.js");
  await run(() => renderHat(tab, { state, run, alertBox, divisions, fields, reloadData, renderEvent }));
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
  // hat: quién puede inscribirse en la división (rama, edades), cupo y cuota propia
  const h = d.hat || {};
  const ageDef = HAT_AGE_DEFAULTS[level] || {};
  const genders = hatGenders({ ...d, gender });
  const num = (k, v, ph, attrs = 'min="0"') => `<input class="form-control form-control-sm" type="number" ${attrs} data-hat="${k}" value="${esc(v ?? "")}" placeholder="${esc(ph)}" />`;
  return `
    <div class="tn-div-item" data-div-item>
    <div class="tn-div-row" data-div-row data-id="${esc(d.id || "")}">
      <select class="form-select" data-div="level" aria-label="${esc(EX.divLevel)}">
        ${opts.levels.map((l) => `<option ${l === level ? "selected" : ""}>${esc(l)}</option>`).join("")}
      </select>
      <select class="form-select" data-div="gender" aria-label="${esc(EX.divGender)}">
        ${opts.genders.map((g) => `<option value="${esc(g.id)}" ${g.id === gender ? "selected" : ""}>${esc(g.name)}</option>`).join("")}
      </select>
      <button type="button" class="btn btn-light text-danger" data-div-del title="${esc(EX.delete)}"><i class="bi bi-x-lg"></i></button>
    </div>
    <div class="tn-div-hat tn-hat-only" data-div-hat>
      <div class="tn-div-hat__genders">
        <span class="small ev-muted">${esc(EX.hatDivGenders)}</span>
        ${["F", "M"].map((g) => `<label class="form-check form-check-inline small mb-0"><input class="form-check-input" type="checkbox" data-hat-g="${g}" ${genders.includes(g) ? "checked" : ""} /> ${g}</label>`).join("")}
      </div>
      <label class="small">${esc(EX.hatDivMinAge)}${num("minAge", h.minAge ?? ageDef.minAge, "—", 'min="0" max="99"')}</label>
      <label class="small">${esc(EX.hatDivMaxAge)}${num("maxAge", h.maxAge ?? ageDef.maxAge, "—", 'min="0" max="99"')}</label>
      <label class="small">${esc(EX.hatDivAgeRef)}<input class="form-control form-control-sm" type="date" data-hat="ageRef" value="${esc(h.ageRef || "")}" title="${esc(EX.hatDivAgeRefHint)}" /></label>
      <label class="small">${esc(EX.hatDivCapacity)}${num("capacity", h.capacity || "", EX.hatNoLimit)}</label>
      <label class="small">${esc(EX.hatDivFee)}${num("fee", h.fee ?? "", EX.hatDivFeeSame, 'min="0" step="any"')}</label>
    </div>
    </div>`;
}

function readDivisions(hatOn = segValue(document, "eType") === "hat") {
  const opts = state.divOptions;
  const used = new Set();
  const n = (box, k) => {
    const raw = box.querySelector(`[data-hat=${k}]`)?.value ?? "";
    return raw === "" ? null : Math.max(0, Number(raw) || 0);
  };
  return [...document.querySelectorAll("[data-div-item]")].map((item) => {
    const row = item.querySelector("[data-div-row]");
    const level = row.querySelector("[data-div=level]").value;
    const g = opts.genders.find((x) => x.id === row.querySelector("[data-div=gender]").value) || opts.genders[0];
    const name = `${level} ${g.name}`;
    // se conserva el id de las divisiones existentes (equipos y partidos lo usan)
    let id = row.dataset.id || slugify(name) || "open";
    while (used.has(id)) id += "-2";
    used.add(id);
    const div = { id, name, level, gender: g.id, mixed: !!g.mixed };
    if (hatOn) {
      const box = item.querySelector("[data-div-hat]");
      const genders = ["F", "M"].filter((x) => box.querySelector(`[data-hat-g=${x}]`).checked);
      const prev = (state.event?.divisions || []).find((x) => x.id === id)?.hat || {};
      div.hat = {
        ...prev, // cantidad de equipos y lo demás que guarda la pestaña Hat
        // si coincide con lo que sale de la rama no se guarda: así sigue a la rama si después cambia
        genders: genders.join() === hatGenders({ gender: g.id }).join() ? null : genders,
        minAge: n(box, "minAge"),
        maxAge: n(box, "maxAge"),
        ageRef: box.querySelector("[data-hat=ageRef]").value || "",
        capacity: n(box, "capacity"),
        fee: n(box, "fee"),
      };
    }
    return div;
  });
}

// filas de división: al cambiar la rama o la categoría, F/M y edades del hat siguen a la nueva
// (si eran las que salían de la anterior). Lo usan Info y reglas y Crear torneo.
function bindDivisionRows() {
  // al cambiar la categoría, las edades del hat siguen a la nueva (si eran las de la anterior)
  document.getElementById("eDivRows").onchange = (ev) => {
    // al cambiar la rama, F/M siguen a la nueva (si eran los de la anterior)
    const gsel = ev.target.closest("[data-div=gender]");
    if (gsel) {
      const box = gsel.closest("[data-div-item]").querySelector("[data-div-hat]");
      const checks = [...box.querySelectorAll("[data-hat-g]")];
      const cur = checks.filter((c) => c.checked).map((c) => c.dataset.hatG).join();
      if (cur === hatGenders({ gender: gsel.dataset.prev }).join()) {
        const next = hatGenders({ gender: gsel.value });
        checks.forEach((c) => (c.checked = next.includes(c.dataset.hatG)));
      }
      gsel.dataset.prev = gsel.value;
      return;
    }
    const sel = ev.target.closest("[data-div=level]");
    if (!sel) return;
    const box = sel.closest("[data-div-item]").querySelector("[data-div-hat]");
    const prev = HAT_AGE_DEFAULTS[sel.dataset.prev || ""] || {};
    const next = HAT_AGE_DEFAULTS[sel.value] || {};
    ["minAge", "maxAge"].forEach((k) => {
      const input = box.querySelector(`[data-hat=${k}]`);
      if (input.value === "" || Number(input.value) === prev[k]) input.value = next[k] ?? "";
    });
    sel.dataset.prev = sel.value;
  };
  document.querySelectorAll("[data-div=level],[data-div=gender]").forEach((sel) => (sel.dataset.prev = sel.value));
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
        <div class="form-text">${esc(EX.infoDeadlinesMoved)}</div>
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
    <form id="evInfoForm" class="mt-3 ${isHatEvent(e) ? "is-hat" : ""}">
      ${section("info-circle", EX.crStep_basics, `
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
          <div class="col-12">
            <label class="form-label small" for="eSlug">${esc(EX.crSlug)}</label>
            <div class="input-group"><span class="input-group-text small">…/event.html?e=</span><input class="form-control" id="eSlug" value="${esc(e.slug || "")}" /></div>
          </div>
          <div class="col-12">
            <div class="form-label small">${esc(EX.eventType)}</div>
            ${segHtml("eType", [["team", EX.crTypeTeam, "bi-people"], ["hat", EX.crTypeHat, "tn-ic tn-ic-hat"]], isHatEvent(e) ? "hat" : "team", { full: true, label: EX.eventType, disabled: isHatEvent(e) ? ["team"] : [] })}
            <div class="form-text">${esc(isHatEvent(e) ? EX.hatTypeLocked : EX.eventTypeHint)}</div>
          </div>
          <div class="col-12">
            <div class="form-label small">${esc(EX.eventSurface)}</div>
            ${segHtml("eSurface", SURFACES.map((s) => [s, EX[`crSurface_${s}`] || EX[`surface_${s}`], SURFACE_ICONS[s]]), e.surface || "", { full: true, label: EX.eventSurface })}
          </div>
          <div class="col-12 col-md-6">
            <label class="form-label small" for="eCountry">${esc(EX.teamCountry)}</label>
            <select class="form-select" id="eCountry">${countryOptions(e.country || "", esc(EX.teamCountryPick))}</select>
          </div>
        </div>`)}

      ${section("diagram-3", EX.crStep_divisions, `
        <div class="cr-divs">
          <div id="eDivRows">${divisions().map(divisionRow).join("")}</div>
          <button type="button" class="btn btn-light w-100 fw-semibold text-primary" id="eDivAdd"><i class="bi bi-plus-lg me-1"></i>${esc(EX.divAdd)}</button>
          <div class="form-text">${esc(EX.divHint)}</div>
          <div class="tn-hat-only mt-2">
            <div class="form-text mt-0">${esc(EX.hatDivHint)}</div>
            <div class="form-check form-switch mt-2">
              <input class="form-check-input" type="checkbox" id="eHatMulti" ${e.hat?.multiDivision ? "checked" : ""} />
              <label class="form-check-label" for="eHatMulti">${esc(EX.hatMultiDivision)}</label>
            </div>
            <div class="form-text">${esc(EX.hatMultiDivisionHint)}</div>
          </div>
        </div>
        <div class="row g-3 mt-1">
          <div class="col-12">
            <div class="form-label small">${esc(EX.ruleMode)}</div>
            ${segHtml("rMode", [...GAME_MODES.filter((m) => m.players).map((m) => [m.id, m.id]), ["other", EX.crModeOther]], mode.id, { full: true, label: EX.ruleMode })}
            <input class="form-control mt-2 ${mode.id === "other" ? "" : "d-none"}" style="max-width:9rem" id="rPlayers" type="number" min="1" max="15" value="${esc(r.playersOnField)}" aria-label="${esc(EX.rulePlayers)}" placeholder="${esc(EX.rulePlayers)}" />
            <div class="form-text">${esc(EX.ruleModeHint)}</div>
          </div>
          <div class="col-6 tn-team-only"><label class="form-label small" for="rRosterMin">${esc(EX.ruleRosterMin)}</label><input class="form-control" type="number" min="0" max="99" id="rRosterMin" value="${esc(r.rosterMin)}" /></div>
          <div class="col-6 tn-team-only"><label class="form-label small" for="rRosterMax">${esc(EX.ruleRosterMax)}</label><input class="form-control" type="number" min="0" max="99" id="rRosterMax" value="${esc(r.rosterMax || "")}" placeholder="${esc(EX.ruleRosterNoMax)}" /></div>
          <div class="col-12 mt-0 tn-team-only"><div class="form-text">${esc(EX.ruleRosterHint)}</div></div>
          <div class="col-12">
            <label class="form-label small" for="rRatioRule">${esc(EX.ruleRatio)}</label>
            <select class="form-select" id="rRatioRule">${RATIO_RULES.map((id) => `<option value="${id}" ${r.ratioRule === id ? "selected" : ""}>${esc(EX[`ruleRatio_${id}`])}</option>`).join("")}</select>
            <select class="form-select mt-2 ${r.ratioRule === "fixed" ? "" : "d-none"}" id="rRatioFixed" aria-label="${esc(EX.ruleRatio_fixed)}">
              <option value="M" ${r.ratioFixed === "M" ? "selected" : ""}>${esc(EX.ruleRatioFixedM)}</option>
              <option value="F" ${r.ratioFixed === "F" ? "selected" : ""}>${esc(EX.ruleRatioFixedF)}</option>
            </select>
            <div class="form-text">${esc(EX.ruleRatioHint)}</div>
          </div>
        </div>`)}

      ${section("calendar-event", EX.crStep_dates, `
        <div class="row g-3">
          ${f("eStart", EX.eventStart, e.startDate, { type: "date", col: "col-6" })}
          ${f("eEnd", EX.eventEnd, e.endDate, { type: "date", col: "col-6" })}
          <div class="col-12 col-md-6">
            <label class="form-label small" for="eRegDeadline">${esc(EX.regDeadline)}</label>
            <input class="form-control" type="date" id="eRegDeadline" value="${esc(e.registrationDeadline || "")}" />
            ${e.registrationOpen && registrationExpired(e) ? `<span class="ev-chip ev-chip--alert mt-1">${esc(EX.regClosedByDate)}</span>` : ""}
            <div class="form-text">${esc(isHatEvent(e) ? EX.crRegDeadlineHatHint : EX.regDeadlineHint)}</div>
          </div>
          <div class="col-12 col-md-6 tn-team-only">
            <label class="form-label small" for="eRosterDeadline">${esc(EX.rosterDeadline)}</label>
            <input class="form-control" type="date" id="eRosterDeadline" value="${esc(e.rosterDeadline || "")}" />
            ${rosterLocked(e) ? `<span class="ev-chip mt-1"><i class="bi bi-lock-fill me-1"></i>${esc(EX.rosterLockedShort)}</span>` : ""}
            <div class="form-text">${esc(EX.rosterDeadlineHint)}</div>
          </div>
        </div>`)}

      ${section("geo-alt", EX.crStep_venue, `
        <div class="row g-3">
          ${f("eVenue", EX.eventVenue, e.venue)}
          ${f("eAddress", EX.eventAddress, e.address)}
          ${f("eMaps", EX.eventMaps, e.mapsUrl, { col: "col-12", hint: EX.eventMapsHint })}
          <div class="col-12 col-md-6">
            <label class="form-label small" for="eFields">${esc(EX.eventFields)}</label>
            <textarea class="form-control" id="eFields" rows="3">${esc(fields().join("\n"))}</textarea>
            <div class="form-text">${esc(EX.crFieldsHint)}</div>
          </div>
          <div class="col-12 col-md-6">
            <label class="form-label small" for="eDesc">${esc(EX.eventDescription)}</label>
            <textarea class="form-control" id="eDesc" rows="3">${esc(e.description || "")}</textarea>
          </div>
        </div>`)}

      ${section("cash-coin", EX.crStep_signup, `
        <div class="row g-3">
          <div class="col-12 tn-hat-only">
            <div class="form-label small">${esc(EX.feePlayerMode)}</div>
            ${segHtml("eFeePlayerMode", PLAYER_FEE_MODES.map((m) => [m, EX[`crPayMode_${m}`]]), e.fees?.playerMode || "free", { full: true, label: EX.feePlayerMode })}
            <div class="form-text" id="eFeeModeHelp">${esc(EX[`feePlayerMode_${e.fees?.playerMode || "free"}`])}</div>
          </div>
          <div class="col-7 col-md-4 tn-team-only">
            <label class="form-label small" for="eFeeTeam">${esc(EX.feeTeam)}</label>
            <input class="form-control" id="eFeeTeam" type="number" min="0" step="any" value="${esc(e.fees?.team || "")}" placeholder="0" />
          </div>
          <div class="col-7 col-md-4 tn-hat-only" data-fee-amount>
            <label class="form-label small" for="eFeePlayer">${esc(EX.feePlayer)}</label>
            <input class="form-control" id="eFeePlayer" type="number" min="0" step="any" value="${esc(e.fees?.player || "")}" placeholder="0" />
          </div>
          <div class="col-5 col-md-3">
            <label class="form-label small" for="eFeeCurrency">${esc(EX.feeCurrency)}</label>
            <select class="form-select" id="eFeeCurrency">${CURRENCIES.map((c) => `<option ${(e.fees?.currency || "CRC") === c ? "selected" : ""}>${c}</option>`).join("")}</select>
          </div>
          <div class="col-12">
            <label class="form-label small" for="eFeeInfo">${esc(EX.feeInfo)}</label>
            <textarea class="form-control" id="eFeeInfo" rows="2" placeholder="${esc(EX.feeInfoPh)}">${esc(e.fees?.info || "")}</textarea>
          </div>
          <div class="col-12">
            <label class="form-label small" for="eOrganizers">${esc(EX.organizers)}</label>
            <textarea class="form-control" id="eOrganizers" rows="2" placeholder="${esc(EX.crOrganizersPh)}" ${e.ownerUid === state.user.uid ? "" : "disabled"}>${esc((e.organizerEmails || []).join("\n"))}</textarea>
            <div class="form-text">${esc(EX.organizersHint)}</div>
          </div>
        </div>`)}

      <div class="tn-info-more small ev-muted fw-semibold mt-4 mb-2">${esc(EX.infoMore)}</div>

      ${section("file-earmark-check", EX.secWaiver, `
        <div class="form-check form-switch mb-2">
          <input class="form-check-input" type="checkbox" id="eWaiverOn" ${e.waiver?.enabled ? "checked" : ""} />
          <label class="form-check-label fw-semibold" for="eWaiverOn">${esc(EX.waiverEnable)}</label>
        </div>
        <div class="form-text mt-0 mb-2">${esc(EX.waiverEnableHint)}</div>
        <div class="row g-3">
          <div class="col-12"><label class="form-label small" for="eWaiverTitle">${esc(EX.waiverTitleLabel)}</label><input class="form-control" id="eWaiverTitle" value="${esc(e.waiver?.title || EX.waiverDefaultTitle)}" /></div>
          <div class="col-12"><label class="form-label small" for="eWaiverText">${esc(EX.waiverTextLabel)}</label><textarea class="form-control" id="eWaiverText" rows="6" placeholder="${esc(EX.waiverTextPh)}">${esc(e.waiver?.text || "")}</textarea></div>
          <div class="col-12 d-flex flex-wrap gap-3">
            ${[["eWaiverEm", "askEmergency", EX.waiverAskEmergency], ["eWaiverBirth", "askBirth", EX.waiverAskBirth], ["eWaiverMed", "askMedical", EX.waiverAskMedical]].map(([id, k, l]) => `
              <div class="form-check"><input class="form-check-input" type="checkbox" id="${id}" ${(e.waiver ? e.waiver[k] : k !== "askMedical") ? "checked" : ""} /><label class="form-check-label small" for="${id}">${esc(l)}</label></div>`).join("")}
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

      ${e.ownerUid === state.user.uid ? `
        <section class="tn-section tn-danger">
          <div class="d-flex flex-wrap align-items-center gap-3">
            <div class="flex-grow-1">
              <div class="fw-bold">${esc(EX.deleteEventTitle)}</div>
              <div class="small ev-muted">${esc(EX.deleteEventHint)}</div>
            </div>
            <button type="button" class="btn btn-outline-danger" id="eDelete"><i class="bi bi-trash me-1"></i>${esc(EX.deleteEventTitle)}</button>
          </div>
        </section>` : ""}

      <div class="tn-save-bar d-flex justify-content-between flex-wrap gap-2">
        <button type="button" class="btn btn-light" id="eCancel"><i class="bi bi-arrow-left me-1"></i>${esc(EX.infoBack)}</button>
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

  // tipo de torneo: la clase is-hat muestra u oculta los campos del hat sin repintar
  document.querySelectorAll('input[name="eType"]').forEach((r) => (r.onchange = () => {
    document.getElementById("evInfoForm").classList.toggle("is-hat", segValue(document, "eType") === "hat");
  }));

  // divisiones
  document.getElementById("eDivAdd").onclick = () => {
    document.getElementById("eDivRows").insertAdjacentHTML("beforeend", divisionRow({}));
  };
  document.getElementById("eDivRows").onclick = (ev) => {
    const del = ev.target.closest("[data-div-del]");
    if (!del) return;
    if (document.querySelectorAll("[data-div-item]").length <= 1) return alertBox(EX.divNeedOne, "warning");
    const row = del.closest("[data-div-item]");
    const id = row.querySelector("[data-div-row]").dataset.id;
    const inUse = id && (state.teams.some((t) => t.divisionId === id) || state.games.some((g) => g.divisionId === id));
    if (inUse && !confirm(EX.divInUse)) return;
    row.remove();
  };
  bindDivisionRows();
  // modalidad y forma de pago (botones segmentados)
  const infoForm = document.getElementById("evInfoForm");
  const feeAmount = () => infoForm.querySelector("[data-fee-amount]").classList.toggle("d-none", segValue(infoForm, "eFeePlayerMode") === "free");
  feeAmount();
  infoForm.addEventListener("change", (ev) => {
    if (ev.target.name === "eFeePlayerMode") {
      feeAmount();
      document.getElementById("eFeeModeHelp").textContent = EX[`feePlayerMode_${ev.target.value}`];
    }
    if (ev.target.name === "rMode") onMode(ev);
  });
  const onMode = (ev) => {
    document.getElementById("rPlayers").classList.toggle("d-none", ev.target.value !== "other");
    // si el mínimo era el de la modalidad anterior, sigue a la nueva (7v7 → 7, 5v5 → 5)
    const minEl = document.getElementById("rRosterMin");
    const wasModeDefault = GAME_MODES.some((m) => m.players && m.players === Number(minEl.value));
    const next = GAME_MODES.find((m) => m.id === ev.target.value);
    if (wasModeDefault && next?.players) minEl.value = next.players;
  };
  document.getElementById("rRatioRule").onchange = (ev) => {
    document.getElementById("rRatioFixed").classList.toggle("d-none", ev.target.value !== "fixed");
  };

  document.getElementById("evInfoForm").onsubmit = (ev) => {
    ev.preventDefault();
    run(async () => {
      const modeId = segValue(document, "rMode");
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
        surface: segValue(document, "eSurface"),
        // se guarda el día y el momento exacto de cierre (fin de ese día): las reglas de Firestore usan el segundo
        registrationDeadline: v("eRegDeadline"),
        registrationDeadlineAt: deadlineEnd(v("eRegDeadline")),
        rosterDeadline: v("eRosterDeadline"),
        rosterDeadlineAt: deadlineEnd(v("eRosterDeadline")),
        country: v("eCountry"),
        // un hat no vuelve a ser por equipos (jugadores sueltos, equipos del armado)
        type: isHatEvent(e) || segValue(document, "eType") === "hat" ? "hat" : "",
        ...(isHatEvent(e) || segValue(document, "eType") === "hat" ? {
 hat: { ...(e.hat || {}), multiDivision: document.getElementById("eHatMulti").checked } } : {}),
        fees: {
          team: Math.max(0, Number(v("eFeeTeam")) || 0),
          player: Math.max(0, Number(v("eFeePlayer")) || 0),
          playerMode: PLAYER_FEE_MODES.includes(segValue(document, "eFeePlayerMode")) ? segValue(document, "eFeePlayerMode") : "free",
          currency: v("eFeeCurrency") || "CRC",
          info: v("eFeeInfo"),
        },
        waiver: {
          enabled: document.getElementById("eWaiverOn").checked,
          title: v("eWaiverTitle") || EX.waiverDefaultTitle,
          text: document.getElementById("eWaiverText").value.trim(),
          askEmergency: document.getElementById("eWaiverEm").checked,
          askBirth: document.getElementById("eWaiverBirth").checked,
          askMedical: document.getElementById("eWaiverMed").checked,
          // si cambia el texto, las firmas anteriores quedan como "versión vieja"
          version: waiverVersion(document.getElementById("eWaiverText").value.trim()),
        },
        address: v("eAddress"),
        mapsUrl: v("eMaps"),
        description: v("eDesc"),
        divisions: readDivisions(),
        fields: v("eFields").split(/\n+/).map((s) => s.trim()).filter(Boolean),
        rules: {
          mode: modeDef.id,
          playersOnField: modeDef.players || num("rPlayers") || 7,
          rosterMin: Math.max(0, num("rRosterMin")),
          rosterMax: Math.max(0, num("rRosterMax")),
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

  // Volver: a la lista de eventos sin guardar (pregunta si hay cambios)
  let dirty = false;
  const infoFormEl = document.getElementById("evInfoForm");
  infoFormEl.addEventListener("input", () => (dirty = true));
  infoFormEl.addEventListener("change", () => (dirty = true));
  document.getElementById("eCancel").onclick = () => {
    if (dirty && !confirm(EX.infoDiscard)) return;
    run(renderList);
  };

  document.getElementById("eDelete")?.addEventListener("click", () => {
    if (!confirm(exf(EX.deleteEventConfirm, { name: e.name || "" }))) return;
    run(async () => {
      await deleteEvent(e.id);
      state.event = null;
      await renderList();
    });
  });
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
  // formularios firmados (solo jugadores con cuenta pueden firmar)
  const wv = waiverOn(state.event) && t.id ? waiverCount(t) : null;
  const reg = t.registrationId ? state.regs.find((r) => r.id === t.registrationId) : null;
  return `
    <form class="ev-card ev-team-card" data-team="${esc(t.id || "")}">
      ${t.id ? `<div class="d-flex align-items-center gap-2 mb-2">
        ${teamBadge(t, 36)}
        <div class="fw-bold flex-grow-1 text-truncate">${esc(t.name || "")}</div>
        ${wv ? `<span class="ev-chip ${wv.signed === wv.total ? "ev-chip--ok" : "ev-chip--wait"}"><i class="bi bi-file-earmark-check me-1"></i>${esc(exf(EX.waiverSigned, wv))}</span>` : ""}
        ${reg ? `<span class="small ev-muted text-truncate">${esc(exf(EX.regManagedBy, { who: reg.managerEmail || reg.managerName || "" }))}${reg.contact ? ` · ${esc(reg.contact)}` : ""}</span>` : ""}
      </div>` : ""}
      <div class="row g-2">
        <div class="col-12 col-md-4"><label class="form-label small">${esc(EX.teamName)}</label><input class="form-control" data-f="name" value="${esc(t.name || "")}" required /></div>
        <div class="col-6 col-md-2"><label class="form-label small">${esc(EX.teamCity)}</label><input class="form-control" data-f="city" value="${esc(t.city || "")}" /></div>
        <div class="col-6 col-md-2"><label class="form-label small">${esc(EX.teamColor)}</label><input class="form-control form-control-color w-100" type="color" data-f="color" value="${esc(t.color || "#19473f")}" /></div>
        <div class="col-6 col-md-2">
          <label class="form-label small">${esc(EX.teamDivision)}</label>
          <select class="form-select" data-f="divisionId">${divisions().map((d) => `<option value="${esc(d.id)}" ${d.id === t.divisionId ? "selected" : ""}>${esc(d.name)}</option>`).join("")}</select>
        </div>
        <div class="col-6 col-md-1"><label class="form-label small">${esc(EX.teamPool)}</label><input class="form-control" data-f="pool" maxlength="3" value="${esc(t.pool || "")}" title="${esc(EX.teamPoolHint)}" /></div>
        <div class="col-6 col-md-1"><label class="form-label small">${esc(EX.teamSeed)}</label><input class="form-control" data-f="seed" type="number" min="1" max="999" value="${esc(t.seed || "")}" title="${esc(EX.teamSeedHint)}" /></div>
        <div class="col-12" data-roster>
          <div class="d-flex align-items-center gap-2 mb-1">
            <span class="form-label small mb-0">${esc(EX.roster)} · <span class="ev-muted" data-roster-count>${esc(exf(EX.playersCount, { n: (t.players || []).length }))}</span></span>
            <button type="button" class="btn btn-sm btn-link ms-auto p-0" data-roster-bulk><i class="bi bi-card-text me-1"></i>${esc(EX.rosterBulk)}</button>
          </div>
          <div data-roster-list>
            <div class="tn-roster" data-roster-rows>${(t.players || []).map(rosterRow).join("")}</div>
            <button type="button" class="btn btn-sm btn-light mt-2" data-roster-add><i class="bi bi-plus-lg me-1"></i>${esc(EX.rosterAdd)}</button>
          </div>
          <div class="d-none" data-roster-bulkbox>
            <textarea class="form-control" data-f="roster" rows="${Math.min(12, Math.max(4, (t.players || []).length + 1))}" placeholder="${esc(EX.rosterHint)}"></textarea>
            <div class="form-text">${esc(EX.rosterHint)}</div>
          </div>
        </div>
        ${t.id ? captainSelect("captainId", EX.captain, t) + captainSelect("spiritCaptainId", EX.spiritCaptain, t) : ""}
        <div class="col-12 d-flex justify-content-between gap-2">
          <button type="button" class="btn btn-sm btn-outline-danger" data-team-delete>${esc(EX.delete)}</button>
          <button type="submit" class="btn btn-sm btn-primary">${esc(EX.save)}</button>
        </div>
      </div>
    </form>`;
}

// Roster: una fila por jugador (número, nombre, F/M). "Editar en bloque" cambia a texto, una línea por jugador.
function rosterRow(p = {}) {
  return `
    <div class="tn-roster__row" data-pid="${esc(p.id || "")}">
      <input class="form-control form-control-sm tn-roster__num" type="number" min="0" max="999" data-r="number" value="${esc(p.number ?? "")}" placeholder="#" aria-label="${esc(EX.rosterNumber)}" />
      <input class="form-control form-control-sm" data-r="name" value="${esc(p.name || "")}" placeholder="${esc(EX.rosterName)}" aria-label="${esc(EX.rosterName)}" />
      <select class="form-select form-select-sm tn-roster__g" data-r="gender" aria-label="${esc(EX.rosterGender)}">
        <option value="">—</option>
        ${["F", "M"].map((g) => `<option ${p.gender === g ? "selected" : ""}>${g}</option>`).join("")}
      </select>
      <span class="tn-roster__acc">${p.uid ? `<i class="bi bi-person-check-fill text-success" title="${esc(EX.rosterLinked)}"></i>` : ""}</span>
      <button type="button" class="btn btn-sm btn-light text-danger" data-roster-del aria-label="${esc(EX.delete)}"><i class="bi bi-x-lg"></i></button>
    </div>`;
}

// jugadores según lo que muestra la tarjeta (filas o texto), conservando cuenta, foto y demás de los que ya estaban
function readRoster(form, prevPlayers = []) {
  const box = form.querySelector("[data-roster]");
  if (!box.querySelector("[data-roster-bulkbox]").classList.contains("d-none")) {
    return parseRoster(box.querySelector("[data-f=roster]").value, prevPlayers);
  }
  const byId = new Map(prevPlayers.map((p) => [p.id, p]));
  return [...box.querySelectorAll("[data-roster-rows] .tn-roster__row")]
    .map((row) => {
      const r = (k) => row.querySelector(`[data-r=${k}]`).value.trim();
      const name = r("name");
      if (!name) return null;
      const num = r("number");
      return { ...(byId.get(row.dataset.pid) || {}), id: row.dataset.pid || randomId("p"), number: num === "" ? null : Number(num), name, gender: ["F", "M"].includes(r("gender")) ? r("gender") : "" };
    })
    .filter(Boolean);
}

function renderTeams() {
  const tab = document.getElementById("evTab");
  tab.innerHTML = `
    <div class="d-flex justify-content-between align-items-center mb-2">
      <div class="small ev-muted">${esc(EX.teamPoolHint)} ${esc(isHatEvent(state.event) ? EX.hatTeamsFromTab : EX.teamsOnlyByRegistration)}</div>
    </div>
    ${isHatEvent(state.event) ? "" : paymentsSection()}
    ${isHatEvent(state.event) ? "" : requestsSection()}
    <div id="evTeams">${state.teams.length ? state.teams.map(teamCard).join("") : `<div class="ev-card ev-muted">${esc(EX.noTeams)}</div>`}</div>`;


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
        seed: Number(val("seed")) || null,
        players: readRoster(form, prev?.players || []),
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
    // roster: agregar / quitar fila y cambiar entre filas y texto en bloque
    const roster = ev.target.closest("[data-roster]");
    if (roster) {
      const rows = roster.querySelector("[data-roster-rows]");
      const count = () => (roster.querySelector("[data-roster-count]").textContent = exf(EX.playersCount, { n: rows.querySelectorAll(".tn-roster__row").length }));
      if (ev.target.closest("[data-roster-add]")) {
        rows.insertAdjacentHTML("beforeend", rosterRow());
        rows.lastElementChild.querySelector("[data-r=number]").focus();
        return count();
      }
      if (ev.target.closest("[data-roster-del]")) {
        ev.target.closest(".tn-roster__row").remove();
        return count();
      }
      const bulkBtn = ev.target.closest("[data-roster-bulk]");
      if (bulkBtn) {
        const form = roster.closest("[data-team]");
        const prev = state.teams.find((t) => t.id === form.dataset.team)?.players || [];
        const list = roster.querySelector("[data-roster-list]");
        const bulk = roster.querySelector("[data-roster-bulkbox]");
        const toBulk = bulk.classList.contains("d-none");
        const players = readRoster(form, prev);
        if (toBulk) roster.querySelector("[data-f=roster]").value = rosterToText(players);
        else rows.innerHTML = players.map(rosterRow).join("");
        list.classList.toggle("d-none", toBulk);
        bulk.classList.toggle("d-none", !toBulk);
        bulkBtn.innerHTML = `<i class="bi ${toBulk ? "bi-list-ul" : "bi-card-text"} me-1"></i>${esc(toBulk ? EX.rosterRows : EX.rosterBulk)}`;
        return count();
      }
    }
    const pay = ev.target.closest("[data-pay-approve],[data-pay-reject]");

    if (pay) {
      const ok = !!pay.dataset.payApprove;
      const rid = pay.dataset.payApprove || pay.dataset.payReject;
      const note = ok ? "" : prompt(EX.payRejectNote, "");
      if (note === null) return;
      return run(async () => {
        await decideRegistrationPayment(state.event.id, rid, ok, note || "");
        await reloadData();
        alertBox(EX.saved);
        renderEvent();
      });
    }
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

// Comprobantes de pago por revisar (de cualquier inscripción, aprobada o no)
function paymentsSection() {
  const list = state.regs.filter((r) => r.paymentStatus === PAYMENT.SUBMITTED && r.paymentProof);
  if (!list.length) return "";
  const fee = fmtMoney(teamFee(state.event), state.event.fees?.currency || "CRC");
  return `
    <h2 class="h6 mt-1 mb-2">${esc(exf(EX.payToReview, { n: list.length }))}</h2>
    ${list.map((r) => `
      <div class="ev-card tn-reg-card">
        <div class="d-flex align-items-center gap-2 flex-wrap">
          ${teamBadge(r, 40)}
          <div class="flex-grow-1 min-w-0">
            <div class="fw-bold">${esc(r.name || "—")}</div>
            <div class="small ev-muted">${esc(exf(EX.payFeeOf, { fee }))}</div>
          </div>
          <button class="btn btn-sm btn-outline-danger" data-pay-reject="${esc(r.id)}">${esc(EX.payReject)}</button>
          <button class="btn btn-sm btn-success" data-pay-approve="${esc(r.id)}"><i class="bi bi-check-lg me-1"></i>${esc(EX.payApprove)}</button>
        </div>
        <a href="${esc(r.paymentProof)}" target="_blank" rel="noopener" class="tn-proof"><img src="${esc(r.paymentProof)}" alt="${esc(EX.payProof)}" /></a>
      </div>`).join("")}`;
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
              <div class="fw-bold">${esc(r.name || "—")} ${regChip(r.status)} ${teamFee(state.event) ? paymentChip(r) : ""}</div>
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
    <section class="tn-section" id="evWizard"></section>

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
    </form>

    <section class="tn-section" id="evCal">${calendarHtml()}</section>`;
  bindCalendar();

  renderWizard();

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

// "5/12 firmados" para un equipo (firma de la versión actual del formulario)
function waiverCount(t) {
  const ps = t.players || [];
  const v = state.event.waiver?.version || "";
  const signed = ps.filter((p) => p.uid && state.waivers?.get(p.uid)?.version === v).length;
  return { signed, total: ps.length };
}

/* ---------- Asistente de calendario ---------- */
const WEEKDAYS = [[1, "L"], [2, "K"], [3, "M"], [4, "J"], [5, "V"], [6, "S"], [0, "D"]];
const hhmm = (min) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

// respuestas del asistente: las guardadas en el torneo, o valores por defecto
function wizardDefaults() {
  const e = state.event;
  const saved = e.scheduleConfig || {};
  const evDays = [];
  if (e.startDate) {
    for (let d = new Date(`${e.startDate}T12:00`); localDayOf(d) <= (e.endDate || e.startDate) && evDays.length < 14; d.setDate(d.getDate() + 1)) evDays.push(localDayOf(d));
  }
  const days = evDays.map((day) => ({ day, on: true, start: "08:00", end: "18:00", ...(saved.days || []).find((x) => x.day === day) }));
  return {
    // un hat se juega como torneo (equipos armados para ese fin de semana), nunca como liga por defecto
    kind: saved.kind || (!isHatEvent(e) && evDays.length > 4 ? "league" : "tournament"),
    format: saved.format || e.format || "round_robin",
    thirdPlace: !!saved.thirdPlace,
    advance: saved.advance || 2,
    divisions: (saved.divisions || divisions().map((d) => d.id)).filter((id) => divisions().some((d) => d.id === id)),
    days,
    league: { from: e.startDate || "", to: e.endDate || "", weekdays: [2, 4], every: 1, skip: "", start: "19:00", end: "22:00", ...(saved.league || {}) },
    fields: (saved.fields || fields()).filter((f) => fields().includes(f)),
    rules: { maxPerDay: 3, restSlots: 1, spread: true, playoffsLastDay: true, mix: "mixed", block: 2, fillCourts: true, ...(saved.rules || {}) },
  };
}
const localDayOf = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

function wizardHtml() {
  const w = state.wiz;
  const f = getFormat(w.format);
  const step = (n, title, body, hide = false) => `
    <div class="wz-step ${hide ? "d-none" : ""}">
      <div class="wz-step__head"><span class="wz-step__n">${n}</span><span class="wz-step__title">${esc(title)}</span></div>
      <div class="wz-step__body">${body}</div>
    </div>`;
  const chip = (name, value, label, icon) => `<button type="button" class="wz-chip ${w[name] === value ? "is-on" : ""}" data-wz-set="${name}" data-wz-val="${esc(value)}">${icon ? `<i class="bi bi-${icon} me-1"></i>` : ""}${esc(label)}</button>`;
  const manual = w.kind === "manual";
  const multiDiv = w.divisions.length > 1;
  const swissRound = (div) => Math.max(0, ...state.games.filter((g) => gameDivision(g) === div && !g.key && !g.phase).map((g) => g.round || 0)) + 1;
  return `
    <h2 class="tn-section__title"><i class="bi bi-magic"></i>${esc(EX.wzTitle)}</h2>
    <div class="small ev-muted mb-3">${esc(EX.wzHint)}</div>

    ${step(1, EX.wzStepKind, `
      <div class="wz-chips">
        ${chip("kind", "tournament", EX.wzKindTournament, "trophy")}
        ${chip("kind", "league", EX.wzKindLeague, "calendar-range")}
        ${chip("kind", "manual", EX.wzKindManual, "hand-index")}
      </div>
      <div class="form-text">${esc(EX[`wzKindHint_${w.kind}`] || "")}</div>`)}

    ${step(2, EX.wzStepFormat, `
      <div class="row g-2">
        <div class="col-12 col-md-6">
          <label class="form-label small" for="wzFormat">${esc(EX.format)}</label>
          <select class="form-select" id="wzFormat">${listFormats().map((x) => `<option value="${esc(x.id)}" ${x.id === w.format ? "selected" : ""}>${esc(x.label)}</option>`).join("")}</select>
        </div>
        <div class="col-12 col-md-6">
          <label class="form-label small">${esc(EX.wzDivisions)}</label>
          <div class="wz-chips">${divisions().map((d) => `<label class="wz-check"><input type="checkbox" data-wz-div="${esc(d.id)}" ${w.divisions.includes(d.id) ? "checked" : ""} /> ${esc(d.name)} <span class="ev-muted">(${state.teams.filter((t) => (t.divisionId || divisions()[0].id) === d.id).length})</span></label>`).join("")}</div>
        </div>
        ${(f.options || []).includes("thirdPlace") ? `<div class="col-12 col-md-6"><label class="wz-check"><input type="checkbox" id="wzThird" ${w.thirdPlace ? "checked" : ""} /> ${esc(EX.optThirdPlace)}</label></div>` : ""}
        ${(f.options || []).includes("advance") ? `<div class="col-6 col-md-3"><label class="form-label small" for="wzAdvance">${esc(EX.optAdvance)}</label><select class="form-select form-select-sm" id="wzAdvance">${[1, 2, 3, 4].map((n) => `<option ${n === Number(w.advance) ? "selected" : ""}>${n}</option>`).join("")}</select></div>` : ""}
        <div class="col-12"><div class="form-text m-0">${esc(EX[`formatHint_${f.id}`] ? exf(EX[`formatHint_${f.id}`], { n: swissRound(w.divisions[0]) }) : "")}</div></div>
      </div>`)}

    ${step(3, EX.wzStepWhen, w.kind === "league" ? `
      <div class="row g-2">
        <div class="col-6 col-md-3"><label class="form-label small" for="wzLFrom">${esc(EX.wzFrom)}</label><input class="form-control" type="date" id="wzLFrom" value="${esc(w.league.from)}" /></div>
        <div class="col-6 col-md-3"><label class="form-label small" for="wzLTo">${esc(EX.wzTo)}</label><input class="form-control" type="date" id="wzLTo" value="${esc(w.league.to)}" /></div>
        <div class="col-6 col-md-3"><label class="form-label small" for="wzLStart">${esc(EX.wzStartTime)}</label><input class="form-control" type="time" step="900" id="wzLStart" value="${esc(w.league.start)}" /></div>
        <div class="col-6 col-md-3"><label class="form-label small" for="wzLEnd">${esc(EX.wzEndTime)}</label><input class="form-control" type="time" step="900" id="wzLEnd" value="${esc(w.league.end)}" /></div>
        <div class="col-12 col-md-7">
          <label class="form-label small">${esc(EX.wzWeekdays)}</label>
          <div class="wz-chips">${WEEKDAYS.map(([d, l]) => `<button type="button" class="wz-day ${w.league.weekdays.includes(d) ? "is-on" : ""}" data-wz-weekday="${d}" title="${esc(EX[`wd${d}`])}">${l}</button>`).join("")}</div>
        </div>
        <div class="col-12 col-md-5"><label class="form-label small" for="wzLEvery">${esc(EX.wzEvery)}</label>
          <select class="form-select" id="wzLEvery">${[1, 2, 3, 4].map((n) => `<option value="${n}" ${Number(w.league.every) === n ? "selected" : ""}>${esc(n === 1 ? EX.wzEveryWeek : exf(EX.wzEveryN, { n }))}</option>`).join("")}</select></div>
        <div class="col-12"><label class="form-label small" for="wzLSkip">${esc(EX.wzSkip)}</label><input class="form-control" id="wzLSkip" value="${esc(w.league.skip)}" placeholder="2026-12-24, 2026-12-25" /></div>
        <div class="col-12"><div class="form-text m-0">${esc(exf(EX.wzLeagueDates, { n: playDays(wizardCfg()).length }))}</div></div>
      </div>` : w.days.length ? `
      <div class="wz-days">
        ${w.days.map((d, i) => `
          <div class="wz-dayrow ${d.on ? "" : "is-off"}">
            <label class="wz-check"><input type="checkbox" data-wz-dayon="${i}" ${d.on ? "checked" : ""} /> ${esc(fmtWhen(atMinutes(d.day, 720), { weekday: "short", day: "numeric", month: "short" }))}</label>
            <input class="form-control form-control-sm" type="time" step="900" data-wz-daystart="${i}" value="${esc(d.start)}" aria-label="${esc(EX.wzStartTime)}" ${d.on ? "" : "disabled"} />
            <span class="ev-muted small">–</span>
            <input class="form-control form-control-sm" type="time" step="900" data-wz-dayend="${i}" value="${esc(d.end)}" aria-label="${esc(EX.wzEndTime)}" ${d.on ? "" : "disabled"} />
          </div>`).join("")}
      </div>` : `<div class="small text-warning-emphasis">${esc(EX.wzNeedDates)}</div>`, manual)}

    ${step(4, EX.wzStepFields, `
      <div class="wz-chips">${fields().map((fl) => `<label class="wz-check"><input type="checkbox" data-wz-field="${esc(fl)}" ${w.fields.includes(fl) ? "checked" : ""} /> ${esc(fl)}</label>`).join("") || `<span class="small text-warning-emphasis">${esc(EX.wzNeedFields)}</span>`}</div>`, manual)}

    ${step(5, EX.wzStepRules, `
      <div class="row g-3">
        <div class="col-6 col-md-3"><label class="form-label small" for="wzMax">${esc(w.kind === "league" ? EX.wzMaxPerDate : EX.wzMaxPerDay)}</label>
          <select class="form-select" id="wzMax">${[0, 1, 2, 3, 4, 5, 6].map((n) => `<option value="${n}" ${Number(w.rules.maxPerDay) === n ? "selected" : ""}>${n ? n : esc(EX.wzNoLimit)}</option>`).join("")}</select></div>
        <div class="col-6 col-md-3"><label class="form-label small" for="wzRest">${esc(EX.wzRest)}</label>
          <select class="form-select" id="wzRest">${[0, 1, 2].map((n) => `<option value="${n}" ${Number(w.rules.restSlots) === n ? "selected" : ""}>${esc(n ? exf(EX.wzRestN, { n }) : EX.wzRestNone)}</option>`).join("")}</select></div>
        <div class="col-12 col-md-6 d-flex flex-column gap-1 justify-content-end">
          <label class="wz-check"><input type="checkbox" id="wzSpread" ${w.rules.spread ? "checked" : ""} /> ${esc(EX.wzSpread)}</label>
          ${f.id === "pools_playoffs" || f.id === "single_elim" || f.id === "double_elim" ? `<label class="wz-check"><input type="checkbox" id="wzPlayoffsLast" ${w.rules.playoffsLastDay ? "checked" : ""} /> ${esc(EX.wzPlayoffsLast)}</label>` : ""}
        </div>
        ${multiDiv ? `
        <div class="col-12">
          <label class="form-label small">${esc(EX.wzMix)}</label>
          <div class="wz-mix">
            ${[["mixed", "grid-3x2", EX.wzMixMixed, EX.wzMixMixedHint], ["alternate", "layers", EX.wzMixAlternate, EX.wzMixAlternateHint], ["sequential", "arrow-down", EX.wzMixSequential, EX.wzMixSequentialHint]].map(([id, icon, label, hint]) => `
              <button type="button" class="wz-mixopt ${w.rules.mix === id ? "is-on" : ""}" data-wz-mix="${id}">
                <i class="bi bi-${icon}"></i><b>${esc(label)}</b><span>${esc(hint)}</span>
              </button>`).join("")}
          </div>
          <div class="d-flex flex-wrap gap-3 align-items-center mt-2">
            ${w.rules.mix === "alternate" ? `<label class="small d-flex align-items-center gap-2">${esc(EX.wzBlock)} <select class="form-select form-select-sm w-auto" id="wzBlock">${[1, 2, 3, 4].map((n) => `<option ${Number(w.rules.block) === n ? "selected" : ""}>${n}</option>`).join("")}</select></label>` : ""}
            <label class="wz-check"><input type="checkbox" id="wzFill" ${w.rules.fillCourts ? "checked" : ""} /> ${esc(EX.wzFill)}</label>
          </div>
        </div>` : ""}
      </div>`, manual)}

    <div class="d-flex justify-content-end gap-2 mt-3">
      <button type="button" class="btn btn-primary" id="wzPreview"><i class="bi bi-eye me-1"></i>${esc(EX.wzPreview)}</button>
    </div>
    <div id="wzResult"></div>`;
}

// configuración para el motor (playDays / buildSchedule)
function wizardCfg() {
  const w = state.wiz;
  return {
    kind: w.kind,
    days: w.days,
    league: { ...w.league, skip: String(w.league.skip || "").split(/[\s,;]+/).filter(Boolean) },
  };
}

// lee los campos del asistente a state.wiz (sin perder lo que ya estaba)
function readWizard() {
  const w = state.wiz;
  const box = document.getElementById("evWizard");
  const q = (sel) => box.querySelector(sel);
  if (q("#wzFormat")) w.format = q("#wzFormat").value;
  w.thirdPlace = !!q("#wzThird")?.checked;
  if (q("#wzAdvance")) w.advance = Number(q("#wzAdvance").value) || 2;
  w.divisions = [...box.querySelectorAll("[data-wz-div]")].filter((c) => c.checked).map((c) => c.dataset.wzDiv);
  box.querySelectorAll("[data-wz-dayon]").forEach((c) => (w.days[c.dataset.wzDayon].on = c.checked));
  box.querySelectorAll("[data-wz-daystart]").forEach((c) => (w.days[c.dataset.wzDaystart].start = c.value));
  box.querySelectorAll("[data-wz-dayend]").forEach((c) => (w.days[c.dataset.wzDayend].end = c.value));
  if (q("#wzLFrom")) Object.assign(w.league, { from: q("#wzLFrom").value, to: q("#wzLTo").value, start: q("#wzLStart").value, end: q("#wzLEnd").value, every: Number(q("#wzLEvery").value) || 1, skip: q("#wzLSkip").value });
  if (box.querySelector("[data-wz-field]")) w.fields = [...box.querySelectorAll("[data-wz-field]")].filter((c) => c.checked).map((c) => c.dataset.wzField);
  if (q("#wzMax")) w.rules.maxPerDay = Number(q("#wzMax").value) || 0;
  if (q("#wzRest")) w.rules.restSlots = Number(q("#wzRest").value) || 0;
  if (q("#wzSpread")) w.rules.spread = q("#wzSpread").checked;
  if (q("#wzPlayoffsLast")) w.rules.playoffsLastDay = q("#wzPlayoffsLast").checked;
  if (q("#wzBlock")) w.rules.block = Number(q("#wzBlock").value) || 1;
  if (q("#wzFill")) w.rules.fillCourts = q("#wzFill").checked;
}

function renderWizard() {
  if (!state.wiz || state.wiz.eventId !== state.event.id) state.wiz = { ...wizardDefaults(), eventId: state.event.id };
  const box = document.getElementById("evWizard");
  if (!box) return;
  box.innerHTML = wizardHtml();
  box.onclick = (ev) => {
    const set = ev.target.closest("[data-wz-set]");
    const wd = ev.target.closest("[data-wz-weekday]");
    const mx = ev.target.closest("[data-wz-mix]");
    if (set || wd || mx) readWizard();
    if (set) state.wiz[set.dataset.wzSet] = set.dataset.wzVal;
    if (wd) {
      const d = Number(wd.dataset.wzWeekday);
      const list = state.wiz.league.weekdays;
      state.wiz.league.weekdays = list.includes(d) ? list.filter((x) => x !== d) : [...list, d];
    }
    if (mx) state.wiz.rules.mix = mx.dataset.wzMix;
    if (set || wd || mx) return renderWizard();
    if (ev.target.closest("#wzPreview")) {
      readWizard();
      return previewWizard();
    }
    if (ev.target.closest("#wzConfirm")) return confirmWizard();
    const pday = ev.target.closest("[data-wz-pday]");
    if (pday) {
      state.wizPlan.day = pday.dataset.wzPday;
      return renderPreview();
    }
  };
  // cambios que muestran u ocultan opciones (formato, categorías, días)
  box.onchange = (ev) => {
    if (ev.target.matches("#wzFormat, [data-wz-div], [data-wz-dayon], #wzLFrom, #wzLTo, #wzLEvery, #wzLSkip")) {
      readWizard();
      renderWizard();
    }
  };
}

// arma los partidos (sin guardar) y los acomoda según las respuestas
function planWizard() {
  const w = state.wiz;
  const format = getFormat(w.format);
  const byDivision = {};
  const replaced = []; // partidos sin jugar que se reemplazan
  const notes = [];
  w.divisions.forEach((div) => {
    const teams = state.teams.filter((t) => (t.divisionId || divisions()[0].id) === div);
    const divName = divisions().find((d) => d.id === div)?.name || "";
    if (teams.length < 2) return notes.push(exf(EX.wzFewTeams, { div: divName }));
    const existing = state.games.filter((g) => gameDivision(g) === div);
    if (format.incremental) {
      const played = existing.filter((g) => !g.key && !g.phase);
      if (played.some((g) => g.status !== GAME_STATUS.FINAL)) return notes.push(exf(EX.wzSwissPending, { div: divName }));
      byDivision[div] = format.generate(teams, { divisionId: div, played });
      return;
    }
    const unplayed = existing.filter(isUnplayed);
    replaced.push(...unplayed);
    const played = new Set(existing.filter((g) => !isUnplayed(g)).map((g) => pairKey(g.teamA?.id, g.teamB?.id)));
    byDivision[div] = format.generate(teams, { divisionId: div, thirdPlace: w.thirdPlace, advance: w.advance })
      .filter((g) => !(g.teamA?.id && g.teamB?.id && played.has(pairKey(g.teamA.id, g.teamB.id))));
  });
  const replacedIds = new Set(replaced.map((g) => g.id));
  if (w.kind === "manual") {
    const games = Object.entries(byDivision).flatMap(([div, list]) => list.map((g) => ({ ...g, divisionId: div, field: "", startAt: null })));
    return { games: [], unscheduled: games.map((game) => ({ game, reason: "manual" })), replaced, notes, days: [] };
  }
  const days = playDays(wizardCfg());
  const plan = buildSchedule({
    byDivision,
    divisionOrder: w.divisions,
    occupied: state.games.filter((g) => !replacedIds.has(g.id) && toMillis(g.startAt)),
    days,
    fields: w.fields,
    slotMinutes: slotMinutes(eventRules(state.event)),
    rules: w.rules,
  });
  return { ...plan, replaced, notes, days };
}

function previewWizard() {
  const w = state.wiz;
  if (!w.divisions.length) return alertBox(EX.wzNeedDivision, "warning");
  if (w.kind !== "manual" && !playDays(wizardCfg()).length) return alertBox(EX.wzNeedDays, "warning");
  if (w.kind !== "manual" && !w.fields.length) return alertBox(EX.wzNeedFields, "warning");
  const plan = planWizard();
  // ids temporales para la grilla de la vista previa
  plan.games = plan.games.map((g, i) => ({ ...g, id: `preview${i}`, status: GAME_STATUS.SCHEDULED }));
  plan.day = plan.games[0] ? localDayOf(plan.games[0].startAt) : "";
  state.wizPlan = plan;
  renderPreview();
  document.getElementById("wzResult")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function renderPreview() {
  const plan = state.wizPlan;
  const box = document.getElementById("wzResult");
  if (!plan || !box) return;
  const w = state.wiz;
  const warns = scheduleWarnings(plan, w.rules);
  const days = [...new Set(plan.games.map((g) => localDayOf(g.startAt)))].sort();
  const divName = (id) => divisions().find((d) => d.id === id)?.name || "";
  const total = plan.games.length + plan.unscheduled.length;
  box.innerHTML = `
    <div class="wz-preview">
      <div class="wz-preview__head">
        <div>
          <div class="fw-bold">${esc(EX.wzPreviewTitle)}</div>
          <div class="small ev-muted">${esc(exf(EX.wzPreviewSummary, { n: total, placed: plan.games.length, days: days.length, replaced: plan.replaced.length }))}</div>
        </div>
        <button type="button" class="btn btn-success" id="wzConfirm" ${total ? "" : "disabled"}><i class="bi bi-check2-circle me-1"></i>${esc(EX.wzConfirm)}</button>
      </div>
      ${[...plan.notes, ...warns.map((x) => x.type === "unscheduled"
        ? exf(w.kind === "manual" ? EX.wzManualNote : EX.wzWarnUnscheduled, { n: x.n })
        : exf(EX.wzWarnOverMax, { team: x.name, day: x.day, n: x.n }))].map((t) => `<div class="alert alert-warning py-2 small mb-2">${esc(t)}</div>`).join("")}
      ${days.length ? `
        <div class="sg-days">${days.map((d) => `<button type="button" class="sb-day ${d === plan.day ? "is-active" : ""}" data-wz-pday="${d}">${esc(fmtWhen(atMinutes(d, 720), { weekday: "short", day: "numeric", month: "short" }))}<span>${plan.games.filter((g) => localDayOf(g.startAt) === d).length}</span></button>`).join("")}</div>
        ${scheduleGridHtml({ games: plan.games, fields: w.fields, day: plan.day || days[0], stepMin: slotMinutes(eventRules(state.event)) })}` : ""}
      ${plan.unscheduled.length ? `
        <div class="small fw-bold mt-3 mb-1">${esc(EX.calUnscheduled)} (${plan.unscheduled.length})</div>
        <div class="small ev-muted">${plan.unscheduled.slice(0, 30).map(({ game: g }) => esc(`${divisions().length > 1 ? `${divName(g.divisionId)} · ` : ""}${g.phase || ""} ${g.teamA?.name || ""} vs ${g.teamB?.name || ""}`.trim())).join(" · ")}${plan.unscheduled.length > 30 ? " …" : ""}</div>` : ""}
    </div>`;
}

function confirmWizard() {
  const plan = state.wizPlan;
  const w = state.wiz;
  if (!plan) return;
  if (plan.replaced.length && !confirm(exf(EX.generateReplaceConfirm, { n: plan.replaced.length }))) return;
  run(async () => {
    const removed = plan.replaced.length ? await deleteUnplayedGames(state.event.id, plan.replaced, state.keys) : 0;
    const toCreate = [...plan.games.map(({ id: _tmp, status: _s, ...g }) => g), ...plan.unscheduled.map((x) => x.game)];
    await createGames(state.event.id, toCreate);
    // se guardan las respuestas: al regenerar no hay que contestar todo otra vez
    const { eventId: _e, ...cfg } = w;
    await saveEvent(state.event.id, { format: w.format, scheduleConfig: cfg });
    state.event.format = w.format;
    state.event.scheduleConfig = cfg;
    state.wizPlan = null;
    await reloadData();
    alertBox(removed ? exf(EX.generatedReplaced, { n: toCreate.length, removed }) : exf(EX.generated, { n: toCreate.length }));
    renderEvent();
  });
}

/* ---------- Calendario por horas (arrastrar y soltar) ---------- */
function calendarHtml() {
  const days = scheduleDays(state.games, state.event);
  if (!state.calDay || !days.includes(state.calDay)) state.calDay = days[0] || "";
  const unscheduled = state.games.filter((g) => !toMillis(g.startAt));
  const r = eventRules(state.event);
  const chip = (g) => `<div class="sg-chip ${state.calPick === g.id ? "is-picked" : ""}" draggable="true" data-sg-game="${esc(g.id)}">
      <span class="sg-chip__time">${esc(phaseLabel(g) || EX.tabGames)}</span>
      <span class="sg-chip__team">${teamBadge(g.teamA || {}, 16)}<span class="text-truncate">${esc(g.teamA?.name || "—")}</span></span>
      <span class="sg-chip__team">${teamBadge(g.teamB || {}, 16)}<span class="text-truncate">${esc(g.teamB?.name || "—")}</span></span>
    </div>`;
  return `
    <h2 class="tn-section__title"><i class="bi bi-calendar3-week"></i>${esc(EX.calTitle)}</h2>
    <div class="small ev-muted mb-2">${esc(EX.calHint)}</div>
    ${days.length ? `<div class="sg-days">${days.map((d) => `<button type="button" class="sb-day ${d === state.calDay ? "is-active" : ""}" data-cal-day="${d}">${esc(fmtWhen(atMinutes(d, 720), { weekday: "short", day: "numeric", month: "short" }))}<span>${state.games.filter((g) => toLocalInput(g.startAt).startsWith(d)).length}</span></button>`).join("")}</div>` : ""}
    ${state.calDay ? scheduleGridHtml({ games: state.games, fields: fields(), day: state.calDay, stepMin: slotMinutes(r), editable: true, picked: state.calPick }) : ""}
    <div class="small fw-bold mt-3 mb-1">${esc(EX.calUnscheduled)} <span class="ev-muted fw-normal">(${unscheduled.length})</span></div>
    <div class="sg-tray" data-sg-slot="" data-sg-field="">${unscheduled.map(chip).join("") || `<span class="small ev-muted">${esc(EX.calUnscheduledHint)}</span>`}</div>`;
}

function bindCalendar() {
  const box = document.getElementById("evCal");
  if (!box) return;
  const rerender = () => {
    box.innerHTML = calendarHtml();
  };
  const move = (gid, slot, field) => {
    const g = state.games.find((x) => x.id === gid);
    if (!g || g.status !== GAME_STATUS.SCHEDULED) return;
    const startAt = slot ? new Date(slot) : null;
    run(async () => {
      await updateGame(state.event.id, gid, { startAt, field: slot ? field : "" });
      Object.assign(g, { startAt, field: slot ? field : "" });
      state.calPick = "";
      if (startAt) state.calDay = toLocalInput(startAt).slice(0, 10);
      rerender();
      alertBox(EX.calMoved);
    });
  };
  box.onclick = (ev) => {
    const day = ev.target.closest("[data-cal-day]");
    if (day) {
      state.calDay = day.dataset.calDay;
      return rerender();
    }
    const chip = ev.target.closest("[data-sg-game]");
    if (chip && !chip.dataset.locked) {
      state.calPick = state.calPick === chip.dataset.sgGame ? "" : chip.dataset.sgGame;
      rerender();
      if (state.calPick) alertBox(EX.calPicked, "info");
      return;
    }
    // tocar una celda con un partido elegido lo mueve ahí (celular)
    const cell = ev.target.closest("[data-sg-slot]");
    if (cell && state.calPick) move(state.calPick, cell.dataset.sgSlot, cell.dataset.sgField);
  };
  box.ondragstart = (ev) => {
    const chip = ev.target.closest("[data-sg-game]");
    if (!chip || chip.dataset.locked) return ev.preventDefault();
    ev.dataTransfer.setData("text/plain", chip.dataset.sgGame);
    ev.dataTransfer.effectAllowed = "move";
  };
  box.ondragover = (ev) => {
    const cell = ev.target.closest("[data-sg-slot]");
    if (!cell) return;
    ev.preventDefault();
    box.querySelectorAll(".is-over").forEach((el) => el !== cell && el.classList.remove("is-over"));
    cell.classList.add("is-over");
  };
  box.ondragleave = (ev) => ev.target.closest?.("[data-sg-slot]")?.classList.remove("is-over");
  box.ondrop = (ev) => {
    const cell = ev.target.closest("[data-sg-slot]");
    if (!cell) return;
    ev.preventDefault();
    cell.classList.remove("is-over");
    const gid = ev.dataTransfer.getData("text/plain");
    if (gid) move(gid, cell.dataset.sgSlot, cell.dataset.sgField);
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
  // dentro de cada día: grupos por ronda / fase ("Ronda 1", "Semifinal", "Final"…) con un ancla para saltar
  const multiDiv = divisions().length > 1;
  const roundTitle = (g) => {
    const base = g.key ? String(g.phase || "").replace(/\s(\(\d+\)|\d+)$/, "") : g.round ? exf(EX.phaseRound, { n: g.round }) : g.phase || EX.orgOtherGames;
    const div = multiDiv ? divisions().find((d) => d.id === gameDivision(g))?.name : "";
    return div ? `${div} · ${base}` : base;
  };
  const anchors = [];
  const daysHtml = [...byDay.entries()].map(([day, list], di) => {
    const groups = new Map();
    list.forEach((g) => {
      const t = roundTitle(g);
      if (!groups.has(t)) groups.set(t, []);
      groups.get(t).push(g);
    });
    return `
      <div class="tn-day-title">${esc(day.charAt(0).toUpperCase() + day.slice(1))}</div>
      ${[...groups.entries()].map(([title, games], gi) => {
        const id = `rnd-${di}-${gi}`;
        anchors.push({ id, title, day, n: games.length });
        return `
          <div class="tn-round-title" id="${id}"><span>${esc(title)}</span><span class="tn-count">${esc(games.length === 1 ? EX.orgOneGame : exf(EX.orgNGames, { n: games.length }))}</span></div>
          ${games.map(orgGameCard).join("")}`;
      }).join("")}`;
  }).join("");
  const multiDay = byDay.size > 1;
  tab.innerHTML = `
    <div class="small ev-muted">${esc(EX.linkHint)}</div>
    ${anchors.length > 1 ? `
      <nav class="tn-round-nav" aria-label="${esc(EX.orgJumpTo)}">
        ${anchors.map((a) => `<a href="#${a.id}" class="sb-day" data-jump="${a.id}">${esc(a.title)}${multiDay ? ` <small>${esc(a.day.split(",")[0])}</small>` : ""}<span class="tn-count" title="${esc(exf(EX.orgNGames, { n: a.n }))}">${a.n}</span></a>`).join("")}
      </nav>` : ""}
    ${daysHtml}`;

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
    const jump = ev.target.closest("[data-jump]");
    if (jump) {
      ev.preventDefault();
      const el = document.getElementById(jump.dataset.jump);
      if (el) window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 70, behavior: "smooth" });
      return;
    }
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

// Descargar el torneo en PDF o Excel (mismo contenido que la página pública)
document.addEventListener("click", async (ev) => {
  const ex = ev.target.closest("[data-export]");
  if (!ex || !state.event) return;
  showLoader();
  try {
    const m = await import("/tournaments/js/export.js");
    await (ex.dataset.export === "pdf" ? m.exportPdf : m.exportExcel)(state.event, state.teams, state.games);
  } catch (err) {
    console.error("[export]", err);
    alertBox(`${EX.error} ${err?.message || ""}`, "danger");
  } finally {
    hideLoader();
  }
});
