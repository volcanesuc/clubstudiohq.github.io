// /tournaments/js/create_event.js
// Crear torneo por etapas (1/5): datos y tipo (por equipos o hat), divisiones, fechas y plazos, sede y canchas,
// cuotas y organizadores. Nada se guarda hasta "Crear torneo"; después todo se ajusta en Info y reglas.
import { EX, exf } from "/tournaments/js/strings.js";
import { DEFAULT_RULES, EVENT_STATUS, RATIO_RULES, SURFACES, SURFACE_ICONS, slugify } from "/tournaments/js/model.js";
import { GAME_MODES } from "/tournaments/js/divisions-config.js";
import { PLAYER_FEE_MODES } from "/tournaments/js/hat.js";
import { countryOptions } from "/tournaments/js/countries.js";
import { cropFromInput } from "/tournaments/js/cropper.js";
import { CURRENCIES, createEvent, deadlineEnd, waiverVersion } from "/tournaments/js/services.js";
import { esc } from "/tournaments/js/ui.js";

/**
 * Botones segmentados (opciones opuestas: una u otra), con radios para leer el valor con el formulario.
 * @param {string} name nombre del grupo de radios
 * @param {[string, string, string?][]} options [valor, texto, icono bootstrap]
 */
export function segHtml(name, options, value, { full = false, label = "", disabled = [] } = {}) {
  return `
    <div class="pa-seg tn-seg ${full ? "tn-seg--full" : ""}" role="radiogroup" ${label ? `aria-label="${esc(label)}"` : ""}>
      ${options.map(([v, text, icon]) => `
        <input type="radio" class="btn-check" name="${esc(name)}" id="${esc(`${name}_${v}`)}" value="${esc(v)}" ${v === value ? "checked" : ""} ${disabled.includes(v) ? "disabled" : ""} autocomplete="off" />
        <label class="btn" for="${esc(`${name}_${v}`)}">${icon ? `<i class="bi ${esc(icon)} me-1"></i>` : ""}${esc(text)}</label>`).join("")}
    </div>`;
}
export const segValue = (root, name) => root.querySelector(`input[name="${name}"]:checked`)?.value ?? "";

const STEPS = ["basics", "divisions", "dates", "venue", "signup"];
let C = null; // { state, run, alertBox, divisionRow, readDivisions, bindDivisionRows, openEvent, renderList, root }
let d = null; // borrador del torneo
let step = 0;

const fresh = () => ({
  type: "team",
  name: "",
  slug: "",
  image: "",
  surface: "",
  country: "",
  divisions: [{ id: "open", name: "Open" }],
  hatMulti: false,
  rules: { ...DEFAULT_RULES },
  startDate: "",
  endDate: "",
  regDeadline: "",
  rosterDeadline: "",
  venue: "",
  address: "",
  mapsUrl: "",
  fields: ["Cancha 1"],
  description: "",
  fees: { team: 0, player: 0, playerMode: "free", currency: "CRC", info: "" },
  waiverOn: false,
  organizers: "",
});

export function renderCreate(ctx) {
  C = ctx;
  d = fresh();
  step = 0;
  paint();
}

const isHat = () => d.type === "hat";
const $ = (id) => document.getElementById(id);
const val = (id) => ($(id)?.value ?? "").trim();
const numOr = (id, fallback = 0) => {
  const raw = val(id);
  return raw === "" ? fallback : Math.max(0, Number(raw) || 0);
};
const field = (id, label, value, { type = "text", col = "col-12", attrs = "", hint = "", ph = "" } = {}) => `
  <div class="${col}">
    <label class="form-label small fw-semibold" for="${id}">${esc(label)}</label>
    <input class="form-control" id="${id}" type="${type}" value="${esc(value ?? "")}" placeholder="${esc(ph)}" ${attrs} />
    ${hint ? `<div class="form-text">${esc(hint)}</div>` : ""}
  </div>`;

/* =========================
   Pantalla
========================= */
function paint() {
  const id = STEPS[step];
  const last = step === STEPS.length - 1;
  C.root.innerHTML = `
    <div class="cr-wrap">
      <a class="small ev-muted text-decoration-none" href="?" id="crCancel"><i class="bi bi-arrow-left"></i> ${esc(EX.backToList)}</a>
      <h1 class="h3 fw-bold text-center mt-2 mb-1">${esc(EX[`crStep_${id}`])} <span class="ev-muted">${step + 1}/${STEPS.length}</span></h1>
      <div class="text-center small ev-muted mb-3">${esc(EX[`crSub_${id}`] || (isHat() ? EX.crHatBadge : EX.crTeamBadge))}</div>
      <div class="hat-steps mb-3">${STEPS.map((_, i) => `<span class="${i < step ? "is-done" : i === step ? "is-on" : ""}"></span>`).join("")}</div>
      <form id="crForm" novalidate>
        ${({ basics: basicsHtml, divisions: divisionsHtml, dates: datesHtml, venue: venueHtml, signup: signupHtml })[id]()}
        <div class="d-grid gap-2 mt-3">
          <button type="submit" class="btn ${last ? "tn-btn-grad" : "btn-primary"} btn-lg">${last ? `<i class="bi bi-check2-circle me-1"></i>${esc(EX.crCreate)}` : `${esc(EX.crNextStep)} <i class="bi bi-arrow-right ms-1"></i>`}</button>
          ${step > 0 ? `<button type="button" class="btn btn-light" id="crBack">${esc(EX.hatPrev)}</button>` : ""}
        </div>
      </form>
    </div>`;
  bind(id);
  window.scrollTo({ top: 0 });
}

// 1. Datos del torneo y tipo
function basicsHtml() {
  return `
    <section class="ev-card mb-3 text-center">
      ${d.image
        ? `<img class="tn-cover-preview mx-auto d-block mb-2" src="${esc(d.image)}" alt="${esc(EX.eventImage)}" />
           <div class="d-flex gap-2 justify-content-center">
             <label class="btn btn-sm btn-light mb-0"><i class="bi bi-arrow-repeat me-1"></i>${esc(EX.eventImageChange)}<input type="file" accept="image/*" id="crImage" hidden /></label>
             <button type="button" class="btn btn-sm btn-light text-danger" id="crImageDel" aria-label="${esc(EX.eventImageRemove)}"><i class="bi bi-trash"></i></button>
           </div>`
        : `<label class="cr-upload mb-0" for="crImage" role="button"><span class="cr-upload__icon"><i class="bi bi-camera"></i></span><span class="small fw-semibold">${esc(EX.eventImageUpload)}</span><input type="file" accept="image/*" id="crImage" hidden /></label>`}
    </section>
    <section class="ev-card">
      <div class="row g-3">
        ${field("crName", EX.eventName, d.name, { ph: EX.crNamePh, attrs: 'required maxlength="80"' })}
        <div class="col-12">
          <label class="form-label small fw-semibold" for="crSlug">${esc(EX.crSlug)}</label>
          <div class="input-group"><span class="input-group-text small">…/event.html?e=</span><input class="form-control" id="crSlug" value="${esc(d.slug)}" placeholder="${esc(slugify(d.name) || EX.crSlugPh)}" /></div>
          <div class="form-text">${esc(EX.crSlugHint)}</div>
        </div>
        <div class="col-12">
          <div class="form-label small fw-semibold">${esc(EX.eventType)}</div>
          ${segHtml("crType", [["team", EX.crTypeTeam, "bi-people"], ["hat", EX.crTypeHat, "tn-ic tn-ic-hat"]], d.type, { full: true, label: EX.eventType })}
          <div class="cr-type-help mt-2" id="crTypeHelp">${isHat() ? EX.crTypeHatHelp : EX.crTypeTeamHelp}</div>
        </div>
        <div class="col-12">
          <div class="form-label small fw-semibold">${esc(EX.eventSurface)}</div>
          ${segHtml("crSurface", SURFACES.map((s) => [s, EX[`crSurface_${s}`] || EX[`surface_${s}`], SURFACE_ICONS[s]]), d.surface, { full: true, label: EX.eventSurface })}
        </div>
        <div class="col-12">
          <label class="form-label small fw-semibold" for="crCountry">${esc(EX.teamCountry)}</label>
          <select class="form-select" id="crCountry">${countryOptions(d.country, esc(EX.teamCountryPick))}</select>
        </div>
      </div>
    </section>`;
}

// 2. Divisiones (una tarjeta por división) + modalidad, roster y proporción
function divisionsHtml() {
  const r = d.rules;
  const known = GAME_MODES.filter((m) => m.players);
  const modeId = known.some((m) => m.id === r.mode) ? r.mode : "other";
  return `
    <div class="cr-divs ${isHat() ? "is-hat" : ""}">
      <div id="eDivRows">${d.divisions.map(C.divisionRow).join("")}</div>
      <button type="button" class="btn btn-light w-100 fw-semibold text-primary" id="crDivAdd"><i class="bi bi-plus-lg me-1"></i>${esc(EX.divAdd)}</button>
      ${isHat() ? `
        <section class="ev-card mt-3">
          <div class="form-check form-switch">
            <input class="form-check-input" type="checkbox" id="crHatMulti" ${d.hatMulti ? "checked" : ""} />
            <label class="form-check-label" for="crHatMulti">${esc(EX.hatMultiDivision)}</label>
          </div>
          <div class="form-text">${esc(EX.hatMultiDivisionHint)}</div>
        </section>` : ""}
    </div>
    <section class="ev-card mt-3">
      <div class="row g-3">
        <div class="col-12">
          <div class="form-label small fw-semibold">${esc(EX.ruleMode)}</div>
          ${segHtml("crMode", [...known.map((m) => [m.id, m.id]), ["other", EX.crModeOther]], modeId, { full: true, label: EX.ruleMode })}
          <input class="form-control mt-2 ${modeId === "other" ? "" : "d-none"}" style="max-width:9rem" id="crPlayers" type="number" min="1" max="15" value="${esc(r.playersOnField)}" placeholder="${esc(EX.rulePlayers)}" aria-label="${esc(EX.rulePlayers)}" />
        </div>
        ${isHat() ? "" : `
          ${field("crRosterMin", EX.ruleRosterMin, r.rosterMin, { type: "number", col: "col-6", attrs: 'min="0" max="99"' })}
          ${field("crRosterMax", EX.ruleRosterMax, r.rosterMax || "", { type: "number", col: "col-6", attrs: 'min="0" max="99"', ph: EX.ruleRosterNoMax })}`}
        <div class="col-12">
          <label class="form-label small fw-semibold" for="crRatio">${esc(EX.ruleRatio)}</label>
          <select class="form-select" id="crRatio">${RATIO_RULES.map((id) => `<option value="${id}" ${r.ratioRule === id ? "selected" : ""}>${esc(EX[`ruleRatio_${id}`])}</option>`).join("")}</select>
          <div class="form-text">${esc(EX.ruleRatioHint)}</div>
        </div>
      </div>
    </section>`;
}

// 3. Fechas y plazos
function datesHtml() {
  return `
    <section class="ev-card">
      <div class="row g-3">
        ${field("crStart", EX.eventStart, d.startDate, { type: "date", col: "col-6", attrs: "required" })}
        ${field("crEnd", EX.eventEnd, d.endDate, { type: "date", col: "col-6", hint: EX.crEndHint })}
        ${field("crRegDeadline", EX.regDeadline, d.regDeadline, { type: "date", hint: isHat() ? EX.crRegDeadlineHatHint : EX.regDeadlineHint })}
        ${isHat() ? "" : field("crRosterDeadline", EX.rosterDeadline, d.rosterDeadline, { type: "date", hint: EX.rosterDeadlineHint })}
      </div>
    </section>`;
}

// 4. Sede y canchas (se puede dejar para después)
function venueHtml() {
  return `
    <section class="ev-card">
      <div class="row g-3">
        ${field("crVenue", EX.eventVenue, d.venue, { ph: EX.crVenuePh })}
        ${field("crAddress", EX.eventAddress, d.address)}
        ${field("crMaps", EX.eventMaps, d.mapsUrl, { hint: EX.eventMapsHint })}
        <div class="col-12">
          <label class="form-label small fw-semibold" for="crFields">${esc(EX.eventFields)}</label>
          <textarea class="form-control" id="crFields" rows="3">${esc(d.fields.join("\n"))}</textarea>
          <div class="form-text">${esc(EX.crFieldsHint)}</div>
        </div>
        <div class="col-12">
          <label class="form-label small fw-semibold" for="crDesc">${esc(EX.eventDescription)}</label>
          <textarea class="form-control" id="crDesc" rows="3">${esc(d.description)}</textarea>
        </div>
      </div>
    </section>`;
}

// 5. Cuotas, exención, organizadores, reglas de juego (plegadas) y resumen
function signupHtml() {
  const f = d.fees;
  const r = d.rules;
  const feeOn = !isHat() || f.playerMode !== "free";
  const n = (id, label, v) => field(id, label, v || "", { type: "number", col: "col-6 col-md-4", attrs: 'min="0" step="any"' });
  return `
    <section class="ev-card mb-3">
      <p class="small ev-muted">${esc(isHat() ? EX.crSignupHat : EX.crSignupTeam)}</p>
      ${isHat() ? `
        <div class="form-label small fw-semibold">${esc(EX.feePlayerMode)}</div>
        ${segHtml("crPayMode", PLAYER_FEE_MODES.map((m) => [m, EX[`crPayMode_${m}`]]), f.playerMode, { full: true, label: EX.feePlayerMode })}
        <div class="form-text mb-2" id="crPayModeHelp">${esc(EX[`feePlayerMode_${f.playerMode}`])}</div>` : ""}
      <div class="row g-3 ${feeOn ? "" : "d-none"}" id="crFeeRow">
        ${field("crFee", isHat() ? EX.feePlayer : EX.feeTeam, (isHat() ? f.player : f.team) || "", { type: "number", col: "col-7", attrs: 'min="0" step="any"', ph: "0" })}
        <div class="col-5">
          <label class="form-label small fw-semibold" for="crCurrency">${esc(EX.feeCurrency)}</label>
          <select class="form-select" id="crCurrency">${CURRENCIES.map((c) => `<option ${f.currency === c ? "selected" : ""}>${c}</option>`).join("")}</select>
        </div>
        <div class="col-12">
          <label class="form-label small fw-semibold" for="crFeeInfo">${esc(EX.feeInfo)}</label>
          <textarea class="form-control" id="crFeeInfo" rows="2" placeholder="${esc(EX.feeInfoPh)}">${esc(f.info)}</textarea>
        </div>
      </div>
    </section>
    <section class="ev-card mb-3">
      <div class="form-check form-switch">
        <input class="form-check-input" type="checkbox" id="crWaiver" ${d.waiverOn ? "checked" : ""} />
        <label class="form-check-label fw-semibold" for="crWaiver">${esc(EX.waiverEnable)}</label>
      </div>
      <div class="form-text">${esc(EX.waiverEnableHint)} ${esc(EX.crWaiverLater)}</div>
      <label class="form-label small fw-semibold mt-3" for="crOrganizers">${esc(EX.organizers)}</label>
      <textarea class="form-control" id="crOrganizers" rows="2" placeholder="${esc(EX.crOrganizersPh)}">${esc(d.organizers)}</textarea>
      <div class="form-text">${esc(EX.organizersHint)}</div>
    </section>
    <details class="ev-card mb-3 cr-rules">
      <summary class="fw-semibold">${esc(EX.rulesTitle)} <span class="small ev-muted fw-normal">· ${esc(EX.crRulesHint)}</span></summary>
      <div class="row g-3 mt-1">
        ${n("crGameTo", EX.ruleGameTo, r.gameTo)}
        ${n("crHalf", EX.ruleHalftimeAt, r.halftimeAt)}
        ${n("crGameMin", EX.ruleGameMinutes, r.gameMinutes)}
        ${n("crSoft", EX.ruleSoftCap, r.softCapMin)}
        ${n("crHard", EX.ruleHardCap, r.hardCapMin)}
        ${n("crTo", EX.ruleTimeouts, r.timeoutsPerHalf)}
      </div>
    </details>
    <section class="ev-card cr-summary">
      <div class="small fw-bold mb-2">${esc(EX.crSummary)}</div>
      <dl class="row small mb-0">
        <dt class="col-5">${esc(EX.eventName)}</dt><dd class="col-7">${esc(d.name)}</dd>
        <dt class="col-5">${esc(EX.eventType)}</dt><dd class="col-7">${esc(isHat() ? EX.crTypeHat : EX.crTypeTeam)}</dd>
        <dt class="col-5">${esc(EX.crWhen)}</dt><dd class="col-7">${esc([d.startDate, d.endDate && d.endDate !== d.startDate ? d.endDate : ""].filter(Boolean).join(" → "))}</dd>
        <dt class="col-5">${esc(EX.crStep_divisions)}</dt><dd class="col-7">${esc(d.divisions.map((x) => x.name).join(", "))} · ${esc(d.rules.mode === "other" ? `${d.rules.playersOnField}v${d.rules.playersOnField}` : d.rules.mode)}</dd>
        <dt class="col-5">${esc(EX.eventVenue)}</dt><dd class="col-7">${esc(d.venue || "—")} · ${esc(exf(d.fields.length === 1 ? EX.hatField1 : EX.hatFields, { n: d.fields.length }))}</dd>
      </dl>
      <div class="form-text mt-2">${esc(EX.crAfter)}</div>
    </section>`;
}

/* =========================
   Leer, validar y avanzar
========================= */
function readStep(id) {
  const form = $("crForm");
  if (id === "basics") {
    d.name = val("crName");
    d.slug = val("crSlug");
    d.type = segValue(form, "crType") || "team";
    d.surface = segValue(form, "crSurface");
    d.country = val("crCountry");
  }
  if (id === "divisions") {
    d.divisions = C.readDivisions(isHat());
    if (isHat()) d.hatMulti = $("crHatMulti").checked;
    const m = GAME_MODES.find((x) => x.id === segValue(form, "crMode")) || GAME_MODES[0];
    d.rules.mode = m.id;
    d.rules.playersOnField = m.players || numOr("crPlayers", 7) || 7;
    if (!isHat()) {
      d.rules.rosterMin = numOr("crRosterMin", d.rules.rosterMin);
      d.rules.rosterMax = numOr("crRosterMax", 0);
    }
    d.rules.ratioRule = val("crRatio") || d.rules.ratioRule;
  }
  if (id === "dates") {
    d.startDate = val("crStart");
    d.endDate = val("crEnd");
    d.regDeadline = val("crRegDeadline");
    d.rosterDeadline = val("crRosterDeadline");
  }
  if (id === "venue") {
    d.venue = val("crVenue");
    d.address = val("crAddress");
    d.mapsUrl = val("crMaps");
    d.fields = val("crFields").split(/\n+/).map((s) => s.trim()).filter(Boolean);
    d.description = $("crDesc").value.trim();
  }
  if (id === "signup") {
    if (isHat()) d.fees.playerMode = segValue(form, "crPayMode") || "free";
    const fee = numOr("crFee", 0);
    if (isHat()) d.fees.player = fee;
    else d.fees.team = fee;
    d.fees.currency = val("crCurrency") || "CRC";
    d.fees.info = $("crFeeInfo").value.trim();
    d.waiverOn = $("crWaiver").checked;
    d.organizers = $("crOrganizers").value;
    const r = d.rules;
    r.gameTo = numOr("crGameTo", r.gameTo) || 13;
    r.halftimeAt = numOr("crHalf", r.halftimeAt) || 7;
    r.gameMinutes = numOr("crGameMin", 0);
    r.softCapMin = numOr("crSoft", 0);
    r.hardCapMin = numOr("crHard", 0);
    r.timeoutsPerHalf = numOr("crTo", 0);
  }
}

// [mensaje, campo] si falta algo en la etapa
function invalid(id) {
  if (id === "basics" && !d.name) return [EX.crNeedName, "crName"];
  if (id === "divisions" && !d.divisions.length) return [EX.divNeedOne, ""];
  if (id === "dates") {
    if (!d.startDate) return [EX.crNeedStart, "crStart"];
    if (d.endDate && d.endDate < d.startDate) return [EX.crEndBefore, "crEnd"];
  }
  if (id === "venue" && !d.fields.length) return [EX.crNeedField, "crFields"];
  return null;
}

function bind(id) {
  const form = $("crForm");
  $("crCancel").onclick = (ev) => {
    ev.preventDefault();
    if (d.name && !confirm(EX.crDiscard)) return;
    C.run(C.renderList);
  };
  $("crBack")?.addEventListener("click", () => {
    readStep(id);
    step -= 1;
    paint();
  });
  form.onsubmit = (ev) => {
    ev.preventDefault();
    readStep(id);
    const bad = invalid(id);
    if (bad) {
      C.alertBox(bad[0], "warning");
      if (bad[1]) $(bad[1])?.focus();
      return;
    }
    if (step < STEPS.length - 1) {
      step += 1;
      return paint();
    }
    create();
  };

  if (id === "basics") {
    // el tipo cambia la explicación en el momento
    form.onchange = (ev) => {
      if (ev.target.name === "crType") $("crTypeHelp").innerHTML = ev.target.value === "hat" ? EX.crTypeHatHelp : EX.crTypeTeamHelp;
    };
    $("crName").oninput = () => ($("crSlug").placeholder = slugify(val("crName")) || EX.crSlugPh);
    $("crImage").onchange = async (ev) => {
      let image = null;
      try {
        image = await cropFromInput(ev.target, { aspect: 2, width: 1000, maxChars: 260000, title: EX.cropCover });
      } catch {
        return C.alertBox(EX.imageBad, "warning");
      }
      if (!image) return;
      readStep(id);
      d.image = image;
      paint();
    };
    $("crImageDel")?.addEventListener("click", () => {
      readStep(id);
      d.image = "";
      paint();
    });
  }
  if (id === "divisions") {
    $("crDivAdd").onclick = () => $("eDivRows").insertAdjacentHTML("beforeend", C.divisionRow({}));
    $("eDivRows").addEventListener("click", (ev) => {
      const del = ev.target.closest("[data-div-del]");
      if (!del) return;
      if (document.querySelectorAll("[data-div-item]").length <= 1) return C.alertBox(EX.divNeedOne, "warning");
      del.closest("[data-div-item]").remove();
    });
    C.bindDivisionRows();
    form.onchange = (ev) => {
      if (ev.target.name === "crMode") $("crPlayers").classList.toggle("d-none", ev.target.value !== "other");
    };
  }
  if (id === "dates") {
    // la fecha de fin sigue a la de inicio si estaba vacía o quedó antes
    $("crStart").onchange = () => {
      if (!val("crEnd") || val("crEnd") < val("crStart")) $("crEnd").value = val("crStart");
    };
  }
  if (id === "signup" && isHat()) {
    form.onchange = (ev) => {
      if (ev.target.name !== "crPayMode") return;
      $("crFeeRow").classList.toggle("d-none", ev.target.value === "free");
      $("crPayModeHelp").textContent = EX[`feePlayerMode_${ev.target.value}`];
    };
  }
}

function create() {
  C.run(async () => {
    const hat = isHat();
    const emails = d.organizers.split(/[\n,;]+/).map((x) => x.trim().toLowerCase()).filter((x) => x.includes("@"));
    const id = await createEvent(C.state.user, {
      name: d.name,
      slug: slugify(d.slug || d.name) || `evento-${Date.now().toString(36)}`,
      status: EVENT_STATUS.DRAFT,
      type: hat ? "hat" : "",
      ...(hat ? { hat: { multiDivision: d.hatMulti } } : {}),
      image: d.image,
      surface: d.surface,
      country: d.country,
      startDate: d.startDate,
      endDate: d.endDate || d.startDate,
      // se guarda el día y el momento exacto de cierre (fin de ese día): las reglas de Firestore usan el segundo
      registrationDeadline: d.regDeadline,
      registrationDeadlineAt: deadlineEnd(d.regDeadline),
      ...(hat ? {} : { rosterDeadline: d.rosterDeadline, rosterDeadlineAt: deadlineEnd(d.rosterDeadline) }),
      venue: d.venue,
      address: d.address,
      mapsUrl: d.mapsUrl,
      description: d.description,
      divisions: d.divisions,
      fields: d.fields,
      rules: d.rules,
      format: "round_robin",
      fees: d.fees,
      ...(emails.length ? { organizerEmails: emails } : {}),
      ...(d.waiverOn ? {
        waiver: { enabled: true, title: EX.waiverDefaultTitle, text: "", askEmergency: true, askBirth: true, askMedical: false, version: waiverVersion("") },
      } : {}),
    });
    await C.openEvent(id);
    C.alertBox(exf(EX.crCreated, { name: d.name }));
  });
}
