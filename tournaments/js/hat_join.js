// /tournaments/js/hat_join.js
// Inscripción a un torneo hat como jugador(a) suelto(a) (?e=<evento>[&d=<división>][&new=1]):
// 1) perfil (F/M y fecha de nacimiento obligatorios), 2) división (solo las que le tocan),
// 3) camiseta y compañero(a), 4) autoevaluación privada, 5) cuota. Después: formulario (waiver) si el torneo lo pide.
// Con ?d= edita su ficha en esa división; sin parámetros y ya inscrito(a) muestra su resumen.
import { EX, L, exf, withDivisionNames } from "/tournaments/js/strings.js";
import { HAT_QUESTIONS } from "/tournaments/js/hat-config.js";
import { HAT_STATUS, eligibility, hatGenders, hatPlayerId, isHatEvent, selfScore } from "/tournaments/js/hat.js";
import { JERSEY_CUTS, JERSEY_SIZES } from "/tournaments/js/divisions-config.js";
import {
  PAYMENT,
  fmtMoney,
  isApproved,
  isPlatformAdmin,
  leaveHat,
  listHatPlayers,
  listMyHatEntries,
  listTeams,
  listWaiverStatus,
  loadEvent,
  loadMyBirthDate,
  loadMyHatPayment,
  loadPublicEventBySlug,
  registrationIsOpen,
  saveHatEntry,
  submitHatPayment,
  updateHatBirthDate,
  waiverOn,
} from "/tournaments/js/services.js";
import { ensureProfile, saveProfile } from "/tournaments/js/squads.js";
import { cropFromInput } from "/tournaments/js/cropper.js";
import { avatarHtml, esc, eventUrl, fmtDateRange, hideLoader, isGoogleUser, paymentChip, renderNav, shrinkImage, showLoader, signInGoogle, teamBadge, waitForUser } from "/tournaments/js/ui.js";

const root = document.getElementById("tnRoot");
const $ = (sel) => root.querySelector(sel);
const params = new URLSearchParams(location.search);
const EK = params.get("e") || "";

const state = {
  user: null,
  event: null,
  profile: null,
  birthDate: "",
  mine: [], // mis fichas en el pool (una por división)
  pool: [], // todas las fichas del torneo (para el cupo y elegir compañero/a)
  teams: [],
  editing: null, // ficha que estoy editando (null = nueva)
  step: 0,
  form: {}, // lo que va llenando en el asistente
  answers: {},
  reanswer: true, // al editar, la autoevaluación es opcional (no se puede volver a leer)
  proof: "",
  payment: null,
};

function alertBox(msg, kind = "danger") {
  const el = document.getElementById("tnAlert");
  el.className = `alert alert-${kind}`;
  el.textContent = msg;
  el.classList.toggle("d-none", !msg);
  if (msg) window.scrollTo(0, 0);
}

const wrap = (inner) => `<div class="mx-auto mt-2 d-grid gap-3" style="max-width:600px">${inner}</div>`;
const divisions = () => (state.event.divisions?.length ? state.event.divisions : [{ id: "open", name: "Open" }]);
const divById = (id) => divisions().find((d) => d.id === id) || null;
const isOpen = () => isApproved(state.event) && registrationIsOpen(state.event);
const multi = () => state.event.hat?.multiDivision === true;
const currency = () => state.event.fees?.currency || "CRC";
const feeMode = () => state.event.fees?.playerMode || "free";
// cuota de la división (o la del torneo); 0 = no se cobra
const feeFor = (div) => (feeMode() === "free" ? 0 : Number(div?.hat?.fee ?? state.event.fees?.player) || 0);
// lugares ocupados (sin la lista de espera ni mi propia ficha)
const taken = (divId) => state.pool.filter((p) => p.divisionId === divId && p.status !== HAT_STATUS.WAITLIST && p.uid !== state.user.uid).length;
const isFull = (div) => Number(div?.hat?.capacity) > 0 && taken(div.id) >= Number(div.hat.capacity);

function banner(sub = "") {
  const e = state.event;
  return `
    <section class="ev-hero mb-0">
      <div class="small opacity-75"><a class="text-white text-decoration-none" href="${esc(eventUrl(e))}"><i class="bi bi-arrow-left me-1"></i>${esc(e.name || "")}</a></div>
      <h1 class="h3">${esc(EX.hatJoinTitle)}</h1>
      <div class="ev-hero__meta">
        ${e.startDate ? `<span><i class="bi bi-calendar-event"></i> ${esc(fmtDateRange(e.startDate, e.endDate))}</span>` : ""}
        ${e.venue ? `<span><i class="bi bi-geo-alt"></i> ${esc(e.venue)}</span>` : ""}
        ${sub ? `<span>${esc(sub)}</span>` : ""}
      </div>
    </section>`;
}

const message = (icon, text, extra = "") => (root.innerHTML = wrap(`${state.event ? banner() : ""}<div class="ev-card text-center py-4"><div class="display-6 mb-2">${icon}</div><p class="mb-3">${esc(text)}</p>${extra}</div>`));
const backToEvent = () => `<a class="btn btn-primary" href="${esc(eventUrl(state.event))}">${esc(EX.hatBackToEvent)}</a>`;

/* =========================
   Elegibilidad
========================= */
function reasonText(div, el) {
  if (el.code === "gender") return exf(EX.hatOnlyGenders, { div: div.name, g: hatGenders(div).join(" / ") });
  if (el.code === "min") return exf(EX.hatMinAge, { div: div.name, n: el.min });
  if (el.code === "max") return exf(EX.hatMaxAge, { div: div.name, n: el.max });
  if (el.code === "birth") return EX.hatNeedBirth;
  return "";
}

// divisiones donde puede anotarse ahora (sin las que ya tiene, salvo la que está editando)
function divisionChoices() {
  const me = { gender: state.form.gender, birthDate: state.form.birthDate };
  const mineIds = new Set(state.mine.map((m) => m.divisionId));
  return divisions()
    .filter((d) => !mineIds.has(d.id) || d.id === state.editing?.divisionId)
    .map((d) => ({ div: d, el: eligibility(d, me, state.event) }));
}

/* =========================
   Asistente
========================= */
function steps() {
  const list = ["profile"];
  const choices = divisionChoices().filter((c) => c.el.ok);
  // con una sola división posible (o editando sin poder cambiar) se salta el paso
  if (choices.length !== 1 || divisionChoices().length > 1) list.push("division");
  list.push("details", "rating");
  const div = divById(state.form.divisionId) || choices[0]?.div;
  if (feeFor(div) > 0 && state.editing?.paymentStatus !== PAYMENT.APPROVED) list.push("pay");
  return list;
}

function renderStep() {
  const list = steps();
  state.step = Math.min(state.step, list.length - 1);
  const id = list[state.step];
  const last = state.step === list.length - 1;
  const body = { profile: profileStep, division: divisionStep, details: detailsStep, rating: ratingStep, pay: payStep }[id]();
  root.innerHTML = wrap(`
    ${banner(exf(EX.hatStepOf, { n: state.step + 1, total: list.length }))}
    <form id="hatForm" class="ev-card d-grid gap-3" novalidate>
      <div class="hat-steps">${list.map((s, i) => `<span class="${i < state.step ? "is-done" : i === state.step ? "is-on" : ""}"></span>`).join("")}</div>
      ${body}
      <div class="d-flex justify-content-between gap-2">
        ${state.step > 0 ? `<button type="button" class="btn btn-light" id="hatBack"><i class="bi bi-arrow-left me-1"></i>${esc(EX.hatPrev)}</button>` : `<a class="btn btn-light" href="${esc(eventUrl(state.event))}">${esc(EX.cancel)}</a>`}
        <button type="submit" class="btn ${last ? "tn-btn-grad" : "btn-primary"} px-4">${last ? `<i class="bi bi-check2-circle me-1"></i>${esc(state.editing ? EX.hatSaveChanges : EX.hatSubmit)}` : `${esc(EX.hatNext)} <i class="bi bi-arrow-right ms-1"></i>`}</button>
      </div>
    </form>`);
  ({ profile: bindProfile, division: bindDivision, details: () => {}, rating: bindRating, pay: bindPay })[id]();
  $("#hatBack")?.addEventListener("click", () => {
    readStep(id);
    state.step -= 1;
    renderStep();
  });
  $("#hatForm").onsubmit = (ev) => {
    ev.preventDefault();
    readStep(id);
    const problem = checkStep(id);
    if (problem) return alertBox(problem, "warning");
    alertBox("");
    if (last) return submit();
    state.step += 1;
    renderStep();
    window.scrollTo(0, 0);
  };
}

// --- 1. Perfil ---
const photoPicker = (p) => `
  <label class="tn-photo-pick" for="hatPhoto" title="${esc(EX.pfPhotoTap)}">
    <span id="hatPhotoPrev">${avatarHtml(p, 88)}</span>
    <span class="tn-photo-pick__badge"><i class="bi bi-camera-fill"></i></span>
    <input type="file" accept="image/*" id="hatPhoto" hidden />
  </label>`;

function profileStep() {
  const f = state.form;
  return `
    <h2 class="h6 fw-bold mb-0">${esc(EX.hatStepProfile)}</h2>
    <div class="d-flex align-items-center gap-3">
      ${photoPicker({ name: f.name, photoURL: f.photoURL })}
      <div>
        <div class="fw-semibold">${esc(EX.pfPhoto)}<span class="tn-optional">${esc(EX.pfOptional)}</span></div>
        <div class="small ev-muted">${esc(EX.pfPhotoTap)}</div>
        <button type="button" class="btn btn-sm btn-link text-danger p-0 ${f.photoURL ? "" : "d-none"}" id="hatPhotoDel">${esc(EX.pfPhotoRemove)}</button>
      </div>
    </div>
    <div><label class="form-label small" for="hatName">${esc(EX.pfName)}</label><input class="form-control form-control-lg" id="hatName" value="${esc(f.name || "")}" required autocomplete="name" /></div>
    <div class="row g-2">
      <div class="col-6"><label class="form-label small" for="hatNumber">${esc(EX.playerNumber)}<span class="tn-optional">${esc(EX.pfOptional)}</span></label><input class="form-control form-control-lg" id="hatNumber" type="number" min="0" max="999" inputmode="numeric" value="${esc(f.number ?? "")}" /></div>
      <div class="col-6">
        <label class="form-label small" for="hatGender">${esc(EX.pfGender)}</label>
        <select class="form-select form-select-lg" id="hatGender" required>
          <option value="">—</option>
          <option value="F" ${f.gender === "F" ? "selected" : ""}>F</option>
          <option value="M" ${f.gender === "M" ? "selected" : ""}>M</option>
        </select>
      </div>
    </div>
    <div>
      <label class="form-label small" for="hatBirth">${esc(EX.hatBirth)}</label>
      <input class="form-control form-control-lg" id="hatBirth" type="date" value="${esc(f.birthDate || "")}" required />
      <div class="form-text"><i class="bi bi-lock-fill me-1"></i>${esc(EX.hatBirthPrivate)}</div>
    </div>`;
}

function bindProfile() {
  const refresh = () => {
    $("#hatPhotoPrev").innerHTML = avatarHtml({ name: $("#hatName").value, photoURL: state.form.photoURL }, 88);
    $("#hatPhotoDel").classList.toggle("d-none", !state.form.photoURL);
  };
  $("#hatPhoto").onchange = async (ev) => {
    try {
      const photo = await cropFromInput(ev.target, { aspect: 1, round: true, width: 256, maxChars: 120000, title: EX.cropPhoto });
      if (!photo) return;
      state.form.photoURL = photo;
      refresh();
    } catch {
      alertBox(EX.imageBad, "warning");
    }
  };
  $("#hatPhotoDel").onclick = () => {
    state.form.photoURL = "";
    refresh();
  };
  $("#hatName").oninput = () => {
    if (!state.form.photoURL) refresh();
  };
}

// --- 2. División ---
function divisionStep() {
  const choices = divisionChoices();
  const ok = choices.filter((c) => c.el.ok);
  const hidden = choices.filter((c) => !c.el.ok);
  const sel = state.form.divisionId;
  return `
    <h2 class="h6 fw-bold mb-0">${esc(EX.hatStepDivision)}</h2>
    ${ok.length ? `<div class="d-grid gap-2">${ok.map(({ div }) => {
      const fee = feeFor(div);
      const full = isFull(div) && div.id !== state.editing?.divisionId;
      return `
        <label class="hat-choice">
          <input class="form-check-input" type="radio" name="hatDiv" value="${esc(div.id)}" ${div.id === sel ? "checked" : ""} />
          <span class="flex-grow-1">
            <span class="fw-bold d-block">${esc(div.name)}</span>
            <span class="small ev-muted">${esc([fee ? fmtMoney(fee, currency()) : "", full ? EX.hatFullWaitlist : ""].filter(Boolean).join(" · "))}</span>
          </span>
        </label>`;
    }).join("")}</div>` : `<div class="alert alert-warning mb-0">${esc(EX.hatNoEligible)}</div>`}
    ${hidden.length ? `
      <div class="small ev-muted">
        <div class="fw-semibold mb-1">${esc(EX.hatHiddenDivisions)}</div>
        ${hidden.map(({ div, el }) => `<div><i class="bi bi-eye-slash me-1"></i>${esc(reasonText(div, el))}</div>`).join("")}
      </div>` : ""}
    ${state.editing && multi() ? "" : state.editing ? `<div class="form-text m-0">${esc(EX.hatMoveDivisionHint)}</div>` : ""}`;
}

function bindDivision() {}

// --- 3. Camiseta y compañero(a) ---
function detailsStep() {
  const f = state.form;
  const mates = state.pool
    .filter((p) => p.divisionId === f.divisionId && p.uid !== state.user.uid)
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));
  return `
    <h2 class="h6 fw-bold mb-0">${esc(EX.hatStepDetails)}</h2>
    <div class="row g-2">
      <div class="col-6">
        <label class="form-label small" for="hatSize">${esc(EX.hatJerseySize)}</label>
        <select class="form-select form-select-lg" id="hatSize" required>
          <option value="">—</option>
          ${JERSEY_SIZES.map((s) => `<option ${f.jersey?.size === s ? "selected" : ""}>${s}</option>`).join("")}
        </select>
      </div>
      <div class="col-6">
        <label class="form-label small" for="hatCut">${esc(EX.hatJerseyCut)}</label>
        <select class="form-select form-select-lg" id="hatCut" required>
          <option value="">—</option>
          ${JERSEY_CUTS.map((c) => `<option value="${c.id}" ${f.jersey?.cut === c.id ? "selected" : ""}>${esc(L(c))}</option>`).join("")}
        </select>
      </div>
    </div>
    <div>
      <label class="form-label small" for="hatMate">${esc(EX.hatTeammate)}<span class="tn-optional">${esc(EX.pfOptional)}</span></label>
      <select class="form-select" id="hatMate">
        <option value="">${esc(EX.hatNoTeammate)}</option>
        ${mates.map((p) => `<option value="${esc(p.uid)}" ${p.uid === f.teammateUid ? "selected" : ""}>${esc(p.name)}${p.number !== null && p.number !== undefined ? ` #${esc(p.number)}` : ""}</option>`).join("")}
      </select>
      <div class="form-text">${esc(mates.length ? EX.hatTeammateHint : EX.hatTeammateNone)}</div>
    </div>`;
}

// --- 4. Autoevaluación (privada) ---
function ratingStep() {
  const skip = state.editing && !state.reanswer;
  return `
    <h2 class="h6 fw-bold mb-0">${esc(EX.hatStepRating)}</h2>
    <div class="alert alert-info py-2 small mb-0"><i class="bi bi-lock-fill me-1"></i>${esc(EX.hatRatingPrivate)}</div>
    ${state.editing ? `
      <div class="form-check form-switch">
        <input class="form-check-input" type="checkbox" id="hatReanswer" ${state.reanswer ? "checked" : ""} />
        <label class="form-check-label" for="hatReanswer">${esc(EX.hatReanswer)}</label>
      </div>
      <div class="form-text mt-0">${esc(EX.hatReanswerHint)}</div>` : ""}
    <div class="d-grid gap-3 ${skip ? "d-none" : ""}" id="hatQuestions">
      ${HAT_QUESTIONS.map((q, i) => `
        <fieldset class="hat-q">
          <legend class="hat-q__label">${i + 1}. ${esc(L(q))}</legend>
          <div class="d-grid gap-1">
            ${q.options.map((o) => `
              <label class="hat-choice hat-choice--sm">
                <input class="form-check-input" type="radio" name="q_${esc(q.id)}" value="${esc(o.id)}" ${state.answers[q.id] === o.id ? "checked" : ""} />
                <span>${esc(L(o))}</span>
              </label>`).join("")}
          </div>
        </fieldset>`).join("")}
    </div>`;
}

function bindRating() {
  $("#hatReanswer")?.addEventListener("change", (ev) => {
    state.reanswer = ev.target.checked;
    $("#hatQuestions").classList.toggle("d-none", !state.reanswer);
  });
}

// --- 5. Cuota ---
function payStep() {
  const div = divById(state.form.divisionId);
  const fee = feeFor(div);
  const required = feeMode() === "required";
  const sent = state.editing?.paymentStatus === PAYMENT.SUBMITTED;
  const proof = state.proof || state.payment?.proof || "";
  return `
    <h2 class="h6 fw-bold mb-0">${esc(EX.hatStepPay)}</h2>
    <div class="d-flex justify-content-between align-items-center flex-wrap gap-2">
      <div class="fs-5 fw-bold">${esc(fmtMoney(fee, currency()))}</div>
      ${state.editing ? paymentChip(state.editing) : ""}
    </div>
    ${state.event.fees?.info ? `<div class="small" style="white-space:pre-line">${esc(state.event.fees.info)}</div>` : ""}
    ${state.editing?.paymentStatus === PAYMENT.REJECTED && state.payment?.note ? `<div class="alert alert-warning py-2 small mb-0">${esc(state.payment.note)}</div>` : ""}
    ${proof ? `<img class="tn-proof__img" src="${esc(proof)}" alt="${esc(EX.payProof)}" />` : ""}
    <div>
      <label class="form-label small" for="hatProof">${esc(proof ? EX.payReplace : EX.hatPayAttach)}${required ? "" : `<span class="tn-optional">${esc(EX.pfOptional)}</span>`}</label>
      <input class="form-control" id="hatProof" type="file" accept="image/*" />
      <div class="form-text">${esc(required && !sent ? EX.hatPayRequired : EX.hatPayLater)}</div>
    </div>`;
}

function bindPay() {
  $("#hatProof").onchange = async (ev) => {
    const file = ev.target.files?.[0];
    if (!file) return;
    try {
      state.proof = await shrinkImage(file, 1100);
      renderStep();
    } catch {
      alertBox(EX.imageBad, "warning");
    }
  };
}

// lee lo que hay en pantalla del paso actual
function readStep(id) {
  const f = state.form;
  const v = (sel) => $(sel)?.value.trim() ?? "";
  if (id === "profile") {
    f.name = v("#hatName");
    f.number = v("#hatNumber") === "" ? null : Number(v("#hatNumber"));
    f.gender = v("#hatGender");
    f.birthDate = v("#hatBirth");
  } else if (id === "division") {
    f.divisionId = root.querySelector("input[name=hatDiv]:checked")?.value || "";
  } else if (id === "details") {
    f.jersey = { size: v("#hatSize"), cut: v("#hatCut") };
    f.teammateUid = v("#hatMate");
  } else if (id === "rating") {
    HAT_QUESTIONS.forEach((q) => {
      const o = root.querySelector(`input[name="q_${q.id}"]:checked`);
      if (o) state.answers[q.id] = o.value;
    });
  }
}

function checkStep(id) {
  const f = state.form;
  if (id === "profile") {
    if (!f.name || !f.gender) return EX.jnNeedNameGender;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(f.birthDate || "")) return EX.hatNeedBirth;
    // con una sola división posible se elige sola
    const ok = divisionChoices().filter((c) => c.el.ok);
    if (!ok.length) return EX.hatNoEligible;
    if (!ok.some((c) => c.div.id === f.divisionId)) f.divisionId = ok.length === 1 ? ok[0].div.id : "";
  }
  if (id === "division" && !divisionChoices().some((c) => c.el.ok && c.div.id === f.divisionId)) return EX.hatPickDivision;
  if (id === "details" && (!f.jersey?.size || !f.jersey?.cut)) return EX.hatNeedJersey;
  if (id === "rating" && (!state.editing || state.reanswer) && HAT_QUESTIONS.some((q) => !state.answers[q.id])) return EX.hatNeedAnswers;
  if (id === "pay" && feeMode() === "required" && !state.proof && ![PAYMENT.SUBMITTED, PAYMENT.APPROVED].includes(state.editing?.paymentStatus)) return EX.hatPayRequired;
  return "";
}

async function submit() {
  const f = state.form;
  const div = divById(f.divisionId);
  const rated = !state.editing || state.reanswer;
  showLoader();
  try {
    await saveProfile(state.user, { name: f.name, photoURL: f.photoURL || "", number: f.number, gender: f.gender });
    // cupo lleno al inscribirse (o al cambiarse de división): queda en lista de espera
    const moving = state.editing && state.editing.divisionId !== f.divisionId;
    const status = isFull(div) && (!state.editing || moving) ? HAT_STATUS.WAITLIST : state.editing && !moving ? state.editing.status : HAT_STATUS.WAITING;
    await saveHatEntry(state.user, state.event, {
      entry: {
        divisionId: f.divisionId,
        name: f.name,
        number: f.number,
        gender: f.gender,
        photoURL: f.photoURL || "",
        jersey: f.jersey,
        position: state.answers.position || state.editing?.position || "",
        teammateUid: f.teammateUid || "",
      },
      prevDivisionId: state.editing?.divisionId || "",
      status,
      rating: rated ? { answers: { ...state.answers }, selfScore: selfScore(state.answers) } : null,
      birthDate: f.birthDate,
      proof: state.proof,
    });
    // la fecha de nacimiento cambió sin volver a responder: el organizador la ve igual
    if (!rated && f.birthDate !== state.birthDate) await updateHatBirthDate(state.event.id, state.user.uid, f.birthDate);
    location.href = `${location.pathname}?e=${encodeURIComponent(state.event.id)}&done=${encodeURIComponent(f.divisionId)}`;
  } catch (err) {
    console.error(err);
    alertBox(`${EX.error} ${err?.code || err?.message || ""}`);
    hideLoader();
  }
}

/* =========================
   Resumen (ya inscrito/a)
========================= */
function entryCard(m) {
  const div = divById(m.divisionId);
  const team = m.status === HAT_STATUS.ASSIGNED ? state.teams.find((t) => t.id === m.teamId) : null;
  const fee = feeFor(div);
  const chip = team
    ? `<span class="ev-chip ev-chip--ok d-inline-flex align-items-center gap-1">${teamBadge(team, 18)} ${esc(team.name)}</span>`
    : m.status === HAT_STATUS.WAITLIST
      ? `<span class="ev-chip ev-chip--wait"><i class="bi bi-hourglass-split me-1"></i>${esc(EX.hatWaitlistChip)}</span>`
      : `<span class="ev-chip ev-chip--wait"><i class="bi bi-hourglass-split me-1"></i>${esc(EX.hatWaitingChip)}</span>`;
  const canEdit = isOpen() && m.status !== HAT_STATUS.ASSIGNED;
  const canPay = fee > 0 && ![PAYMENT.SUBMITTED, PAYMENT.APPROVED].includes(m.paymentStatus);
  return `
    <section class="ev-card d-grid gap-2">
      <div class="d-flex align-items-center gap-2 flex-wrap">
        <div class="fw-bold flex-grow-1">${esc(div?.name || "")}</div>
        ${chip}
        ${fee ? paymentChip(m) : ""}
      </div>
      <div class="small ev-muted">${esc([m.jersey?.size && m.jersey?.cut ? exf(EX.hatJerseyLine, { size: m.jersey.size, cut: L(JERSEY_CUTS.find((c) => c.id === m.jersey.cut)) || m.jersey.cut }) : "", m.teammateUid ? exf(EX.hatTeammateLine, { name: state.pool.find((p) => p.uid === m.teammateUid && p.divisionId === m.divisionId)?.name || "—" }) : ""].filter(Boolean).join(" · "))}</div>
      ${canPay ? `
        <div>
          <label class="form-label small mb-1" for="hatLateProof_${esc(m.id)}">${esc(exf(EX.hatPayLaterLabel, { fee: fmtMoney(fee, currency()) }))}</label>
          <input class="form-control form-control-sm" type="file" accept="image/*" id="hatLateProof_${esc(m.id)}" data-late-proof="${esc(m.id)}" />
        </div>` : ""}
      <div class="d-flex gap-2 flex-wrap">
        ${team ? `<a class="btn btn-sm btn-primary" href="${esc(eventUrl(state.event))}#teams"><i class="bi bi-people me-1"></i>${esc(EX.hatSeeMyTeam)}</a>` : ""}
        ${canEdit ? `<a class="btn btn-sm btn-light" href="?e=${encodeURIComponent(state.event.id)}&d=${encodeURIComponent(m.divisionId)}"><i class="bi bi-pencil me-1"></i>${esc(EX.hatEditMine)}</a>` : ""}
        ${m.status !== HAT_STATUS.ASSIGNED ? `<button class="btn btn-sm btn-outline-danger" data-leave="${esc(m.id)}">${esc(EX.hatLeave)}</button>` : ""}
      </div>
    </section>`;
}

async function renderSummary(justDone = "") {
  const e = state.event;
  let waiverHtml = "";
  if (waiverOn(e)) {
    const ws = await listWaiverStatus(e.id).catch(() => []);
    const signed = ws.some((w) => w.uid === state.user.uid && w.version === e.waiver.version);
    if (!signed) {
      waiverHtml = `
        <div class="ev-waiver-banner">
          <i class="bi bi-file-earmark-text"></i>
          <span class="flex-grow-1">${esc(EX.waiverBanner)}</span>
          <a class="btn btn-sm btn-light fw-bold" href="/tournaments/waiver.html?e=${encodeURIComponent(e.id)}">${esc(EX.waiverBannerBtn)}</a>
        </div>`;
    }
  }
  const more = isOpen() && multi() && divisionChoices().some((c) => c.el.ok && !state.mine.some((m) => m.divisionId === c.div.id));
  root.innerHTML = wrap(`
    ${banner()}
    ${justDone ? `<div class="alert alert-success mb-0"><i class="bi bi-check-circle-fill me-1"></i>${esc(EX.hatDone)}</div>` : ""}
    ${waiverHtml}
    ${state.mine.map(entryCard).join("")}
    ${more ? `<a class="btn btn-outline-primary" href="?e=${encodeURIComponent(e.id)}&new=1"><i class="bi bi-plus-lg me-1"></i>${esc(EX.hatAnotherDivision)}</a>` : ""}
    <div class="text-center">${backToEvent()}</div>`);

  root.querySelectorAll("[data-leave]").forEach((b) => (b.onclick = async () => {
    if (!confirm(EX.hatLeaveConfirm)) return;
    showLoader();
    try {
      await leaveHat(e.id, b.dataset.leave);
      state.mine = state.mine.filter((m) => m.id !== b.dataset.leave);
      if (!state.mine.length) return (location.href = eventUrl(e));
      renderSummary();
    } catch (err) {
      alertBox(`${EX.error} ${err?.code || ""}`);
    } finally {
      hideLoader();
    }
  }));
  root.querySelectorAll("[data-late-proof]").forEach((input) => (input.onchange = async () => {
    const file = input.files?.[0];
    const entry = state.mine.find((m) => m.id === input.dataset.lateProof);
    if (!file || !entry) return;
    showLoader();
    try {
      await submitHatPayment(e.id, entry, await shrinkImage(file, 1100));
      entry.paymentStatus = PAYMENT.SUBMITTED;
      alertBox(EX.paySentOk, "success");
      renderSummary();
    } catch (err) {
      alertBox(`${EX.error} ${err?.code || ""}`);
    } finally {
      hideLoader();
    }
  }));
}

/* =========================
   Inicio
========================= */
function renderSignIn() {
  root.innerHTML = wrap(`
    ${banner()}
    <section class="ev-card text-center">
      <p class="ev-muted mb-3">${esc(EX.hatSignInText)}</p>
      <button class="btn tn-btn-grad btn-lg" id="hatLogin"><i class="bi bi-google me-1"></i>${esc(EX.signIn)}</button>
    </section>`);
  $("#hatLogin").onclick = async () => {
    try {
      await signInGoogle();
      location.reload();
    } catch (err) {
      alertBox(`${EX.error} ${err?.code || ""}`);
    }
  };
}

function startWizard(entry = null) {
  const p = state.profile;
  state.editing = entry;
  state.reanswer = !entry;
  state.form = {
    name: entry?.name || p.name || state.user.displayName || "",
    number: entry?.number ?? p.number ?? null,
    gender: entry?.gender || p.gender || "",
    photoURL: entry?.photoURL ?? p.photoURL ?? "",
    birthDate: state.birthDate,
    divisionId: entry?.divisionId || "",
    jersey: entry?.jersey || {},
    teammateUid: entry?.teammateUid || "",
  };
  state.step = 0;
  renderStep();
}

(async function init() {
  showLoader();
  try {
    const user = await waitForUser();
    state.user = isGoogleUser(user) ? user : null;
    renderNav({ active: "dir", user, isAdmin: await isPlatformAdmin(state.user?.uid) });
    const event = (await loadEvent(EK).catch(() => null)) || (await loadPublicEventBySlug(EK).catch(() => null));
    if (!event) return message("🔍", EX.eventNotFound);
    state.event = withDivisionNames(event);
    if (!isHatEvent(event)) return message("🧢", EX.hatNotHat, backToEvent());
    if (!state.user) return renderSignIn();
    const [profile, birthDate, mine, pool, teams] = await Promise.all([
      ensureProfile(state.user),
      loadMyBirthDate(state.user.uid),
      listMyHatEntries(event.id, state.user.uid),
      listHatPlayers(event.id).catch(() => []),
      listTeams(event.id).catch(() => []),
    ]);
    Object.assign(state, { profile, birthDate, mine, pool, teams });

    const done = params.get("done");
    const editDiv = params.get("d");
    const entry = editDiv ? mine.find((m) => m.divisionId === editDiv) : null;
    if (done) return renderSummary(done);
    if (entry) {
      if (entry.status === HAT_STATUS.ASSIGNED || !isOpen()) return renderSummary();
      state.payment = await loadMyHatPayment(event.id, hatPlayerId(state.user.uid, entry.divisionId));
      return startWizard(entry);
    }
    // ya inscrito/a: resumen (salvo que pida otra división y el hat lo permita)
    if (mine.length && !(params.get("new") && multi())) return renderSummary();
    if (!isOpen()) return message("🔒", EX.registrationClosedShort, backToEvent());
    startWizard(null);
  } catch (err) {
    console.error(err);
    alertBox(`${EX.error} ${err?.code || err?.message || ""}`);
  } finally {
    hideLoader();
  }
})();
