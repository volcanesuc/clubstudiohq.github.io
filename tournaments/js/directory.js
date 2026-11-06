// /tournaments/js/directory.js
// Directorio público de torneos publicados en la plataforma.
// Buscador por texto (nombre, sede, categoría, país) y filtro por país; los finalizados se muestran de a poco.
import { countryName, flagOf } from "/tournaments/js/countries.js";
import { EX, LOCALE, exf, withDivisionNames } from "/tournaments/js/strings.js";
import { SURFACES, SURFACE_ICONS } from "/tournaments/js/model.js";
import { isHatEvent } from "/tournaments/js/hat.js";
import { normName } from "/tournaments/js/names.js";
import { isPlatformAdmin, listPublicEvents, registrationIsOpen, submitMigrationRequest } from "/tournaments/js/services.js";
import { esc, eventUrl, fmtDateRange, hideLoader, isGoogleUser, renderNav, showLoader, waitForUser } from "/tournaments/js/ui.js";

const root = document.getElementById("tnRoot");
const todayKey = new Date().toISOString().slice(0, 10);
const PAST_PAGE = 9; // finalizados visibles al inicio (después "Ver más")

const state = { events: [], q: "", country: "", pastShown: PAST_PAGE };

const place = (e) => [e.venue, e.country ? `${flagOf(e.country)} ${countryName(e.country)}` : ""].filter(Boolean).join(" · ");
// etiqueta "Hat" primero (equipos armados por el organizador) y después las categorías
const chips = (e) => `${isHatEvent(e) ? `<span class="ev-chip dir-chip-hat">${esc(EX.crTypeHat)}</span>` : ""}${(e.divisions || []).map((d) => `<span class="ev-chip">${esc(d.name)}</span>`).join("")}`;
const hasChips = (e) => isHatEvent(e) || (e.divisions || []).length > 0;
const logoHtml = (e, cls) => e.logo
  ? `<span class="${cls}" style="background-image:url('${esc(e.logo)}')"></span>`
  : `<span class="${cls} ${cls}--empty"><i class="bi bi-trophy"></i></span>`;
// día y mes del inicio para el sello de fecha
function dateStamp(iso) {
  if (!iso) return "";
  const d = new Date(`${iso}T12:00:00Z`);
  const month = new Intl.DateTimeFormat(LOCALE, { month: "short", timeZone: "UTC" }).format(d).replace(".", "");
  return `<span class="dir-date"><b>${d.getUTCDate()}</b><small>${esc(month)}</small></span>`;
}

// En curso y próximos: portada con sello de fecha, estado y el logo encima
function cardUpcoming(e) {
  const live = (e.startDate || "9999") <= todayKey;
  const status = registrationIsOpen(e)
    ? `<span class="dir-status dir-status--open">${esc(EX.regOpen)}</span>`
    : `<span class="dir-status ${live ? "dir-status--live" : ""}">${esc(live ? EX.dirNow : EX.dirSoon)}</span>`;
  return `
    <div class="col-12 col-md-6 col-lg-4">
      <a class="dir-card dir-card--up h-100" href="${esc(eventUrl(e))}">
        <div class="dir-card__cover" ${e.image ? `style="background-image:url('${esc(e.image)}')"` : ""}>
          ${dateStamp(e.startDate)}${status}
          ${logoHtml(e, "dir-card__logo")}
        </div>
        <div class="dir-card__body">
          <div class="dir-card__name">${esc(e.name || "—")}</div>
          <div class="dir-card__meta"><i class="bi bi-calendar-event"></i> ${esc(fmtDateRange(e.startDate, e.endDate))}</div>
          ${place(e) ? `<div class="dir-card__meta"><i class="bi bi-geo-alt"></i> ${esc(place(e))}${SURFACES.includes(e.surface) ? ` · <i class="bi ${SURFACE_ICONS[e.surface]}"></i> ${esc(EX[`surface_${e.surface}`])}` : ""}</div>` : ""}
          ${hasChips(e) ? `<div class="mt-2 d-flex flex-wrap justify-content-center gap-1">${chips(e)}</div>` : ""}
        </div>
      </a>
    </div>`;
}

// Finalizados: fila compacta (logo, nombre, fecha y lugar)
function cardPast(e) {
  return `
    <div class="col-12 col-md-6 col-lg-4">
      <a class="dir-card dir-row h-100" href="${esc(eventUrl(e))}">
        ${logoHtml(e, "dir-row__logo")}
        <span class="dir-row__main">
          <span class="dir-card__name">${esc(e.name || "—")}</span>
          <span class="dir-card__meta">${esc([fmtDateRange(e.startDate, e.endDate), place(e)].filter(Boolean).join(" · "))}</span>
          ${hasChips(e) ? `<span class="d-flex flex-wrap gap-1 mt-1">${chips(e)}</span>` : ""}
        </span>
        <i class="bi bi-chevron-right dir-row__go"></i>
      </a>
    </div>`;
}

// texto donde se busca: nombre, sede, dirección, país (nombre y código) y categorías
const haystack = (e) => normName([e.name, e.venue, e.address, e.city, countryName(e.country), e.country, ...(e.divisions || []).map((d) => d.name), isHatEvent(e) ? "hat" : ""].filter(Boolean).join(" "));

function matches(e) {
  if (state.country && e.country !== state.country) return false;
  const words = normName(state.q).split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const h = haystack(e);
  return words.every((w) => h.includes(w));
}

function listHtml() {
  const shown = state.events.filter(matches);
  const filtering = !!(state.q.trim() || state.country);
  const current = shown.filter((e) => (e.endDate || e.startDate || "9999") >= todayKey).reverse();
  const past = shown.filter((e) => (e.endDate || e.startDate || "9999") < todayKey);
  const pastVisible = filtering ? past : past.slice(0, state.pastShown);
  const head = (title, n) => `<h2 class="h6 mb-2 d-flex align-items-center gap-2">${esc(title)} <span class="tn-count">${n}</span></h2>`;
  if (!shown.length) {
    return filtering
      ? `<div class="ev-card ev-muted text-center py-4"><i class="bi bi-search d-block fs-3 mb-1"></i>${esc(EX.dirNoMatch)}<div class="mt-2"><button class="btn btn-sm btn-outline-secondary" id="dirClear">${esc(EX.dirClear)}</button></div></div>`
      : `<div class="ev-card ev-muted">${esc(EX.dirEmpty)}</div>`;
  }
  return `
    ${filtering ? `<div class="small ev-muted mb-2">${esc(exf(EX.dirResults, { n: shown.length }))} · <button class="btn btn-link btn-sm p-0 align-baseline" id="dirClear">${esc(EX.dirClear)}</button></div>` : ""}
    ${current.length ? `${head(EX.dirLive, current.length)}<div class="row g-3 mb-4">${current.map(cardUpcoming).join("")}</div>` : ""}
    ${past.length ? `${head(EX.dirPast, past.length)}<div class="row g-2">${pastVisible.map(cardPast).join("")}</div>
      ${pastVisible.length < past.length ? `<div class="text-center mt-3"><button class="btn btn-outline-secondary" id="dirMore">${esc(exf(EX.dirMore, { n: past.length - pastVisible.length }))}</button></div>` : ""}` : ""}`;
}

function renderList() {
  document.getElementById("dirList").innerHTML = listHtml();
}

function render() {
  // países que tienen torneos (para el filtro), ordenados por nombre
  const countries = [...new Set(state.events.map((e) => e.country).filter(Boolean))]
    .sort((a, b) => countryName(a).localeCompare(countryName(b), LOCALE));
  root.innerHTML = `
    <section class="ev-hero mb-3 d-flex justify-content-between align-items-end flex-wrap gap-3">
      <div>
        <h1>${esc(EX.dirTitle)}</h1>
        <div class="ev-hero__meta">${esc(EX.dirSubtitle)}</div>
      </div>
      <a class="btn tn-btn-grad" href="/tournaments/organize.html"><i class="bi bi-plus-lg me-1"></i>${esc(EX.dirOrganize)}</a>
    </section>
    ${state.events.length ? `
      <div class="dir-filters mb-3">
        <div class="pa-search mb-0 flex-grow-1"><i class="bi bi-search"></i><input class="form-control" id="dirQ" type="search" placeholder="${esc(EX.dirSearch)}" value="${esc(state.q)}" autocomplete="off" /></div>
        ${countries.length > 1 ? `
          <select class="form-select dir-country" id="dirCountry" aria-label="${esc(EX.dirCountry)}">
            <option value="">${esc(EX.dirAllCountries)}</option>
            ${countries.map((c) => `<option value="${esc(c)}" ${c === state.country ? "selected" : ""}>${flagOf(c)} ${esc(countryName(c))}</option>`).join("")}
          </select>` : ""}
      </div>` : ""}
    <div id="dirList">${listHtml()}</div>
    ${migrateCard()}`;
}

function migrateCard() {
  return `
    <section class="mig-card mt-4" id="migrar">
      <div class="mig-card__icon"><i class="bi bi-box-arrow-in-right"></i></div>
      <div class="flex-grow-1 min-w-0">
        <div class="mig-card__title">${esc(EX.migTitle)}</div>
        <div class="mig-card__text">${esc(EX.migText)}</div>
      </div>
      <button class="btn tn-btn-grad flex-shrink-0" type="button" data-mig-open><i class="bi bi-arrow-left-right me-1"></i>${esc(EX.migBtn)}</button>
    </section>`;
}

function ensureMigModal() {
  let el = document.getElementById("migModal");
  if (el) return el;
  document.body.insertAdjacentHTML("beforeend", `
    <div class="modal fade" id="migModal" tabindex="-1" aria-labelledby="migModalTitle" aria-hidden="true">
      <div class="modal-dialog modal-dialog-centered">
        <form class="modal-content" id="migForm" novalidate>
          <div class="modal-header">
            <h5 class="modal-title fw-bold" id="migModalTitle">${esc(EX.migFormTitle)}</h5>
            <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="${esc(EX.close || "Cerrar")}"></button>
          </div>
          <div class="modal-body">
            <p class="small ev-muted">${esc(EX.migFormLead)}</p>
            <div class="mb-3">
              <label class="form-label small fw-semibold" for="migLink">${esc(EX.migLink)} *</label>
              <input class="form-control" id="migLink" type="url" inputmode="url" required placeholder="${esc(EX.migLinkPh)}" />
              <div class="form-text">${esc(EX.migLinkHint)}</div>
            </div>
            <div class="mb-3">
              <label class="form-label small fw-semibold" for="migPhone">${esc(EX.migPhone)} *</label>
              <input class="form-control" id="migPhone" type="tel" inputmode="tel" autocomplete="tel" required placeholder="${esc(EX.migPhonePh)}" />
            </div>
            <div class="mb-3">
              <label class="form-label small fw-semibold" for="migName">${esc(EX.migName)}</label>
              <input class="form-control" id="migName" autocomplete="name" />
            </div>
            <div>
              <label class="form-label small fw-semibold" for="migNotes">${esc(EX.migNotes)}</label>
              <textarea class="form-control" id="migNotes" rows="2" placeholder="${esc(EX.migNotesPh)}"></textarea>
            </div>
            <div class="alert alert-danger small py-2 mt-3 mb-0 d-none" id="migErr"></div>
            <div class="alert alert-success small py-2 mt-3 mb-0 d-none" id="migOk"></div>
          </div>
          <div class="modal-footer">
            <button class="btn tn-btn-grad w-100" type="submit" id="migSend"><i class="bi bi-send me-1"></i>${esc(EX.migSend)}</button>
          </div>
        </form>
      </div>
    </div>`);
  el = document.getElementById("migModal");
  const form = el.querySelector("#migForm");
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const v = (id) => form.querySelector(`#${id}`).value.trim();
    const err = form.querySelector("#migErr");
    const ok = form.querySelector("#migOk");
    const btn = form.querySelector("#migSend");
    err.classList.add("d-none");
    const link = v("migLink");
    const phone = v("migPhone");
    if (!/^https?:\/\/\S+\.\S+/i.test(link)) return showErr(EX.migBadLink);
    if (phone.replace(/\D/g, "").length < 7) return showErr(EX.migBadPhone);
    btn.disabled = true;
    try {
      await submitMigrationRequest({ name: v("migName"), phone, link, notes: v("migNotes") });
      ok.textContent = EX.migSent;
      ok.classList.remove("d-none");
      form.querySelectorAll("input, textarea").forEach((i) => { i.value = ""; i.disabled = true; });
      btn.classList.add("d-none");
    } catch (e) {
      console.error("[migrate]", e);
      showErr(`${EX.error} ${e?.code || ""}`);
      btn.disabled = false;
    }
    function showErr(msg) {
      err.textContent = msg;
      err.classList.remove("d-none");
    }
  });
  return el;
}

function openMigrate() {
  window.bootstrap.Modal.getOrCreateInstance(ensureMigModal()).show();
}

root.addEventListener("input", (ev) => {
  if (ev.target.id !== "dirQ") return;
  state.q = ev.target.value;
  renderList();
});
root.addEventListener("change", (ev) => {
  if (ev.target.id !== "dirCountry") return;
  state.country = ev.target.value;
  renderList();
});
root.addEventListener("click", (ev) => {
  if (ev.target.closest("[data-mig-open]")) return openMigrate();
  if (ev.target.closest("#dirMore")) {
    state.pastShown += PAST_PAGE;
    return renderList();
  }
  if (ev.target.closest("#dirClear")) {
    state.q = "";
    state.country = "";
    const q = document.getElementById("dirQ");
    const c = document.getElementById("dirCountry");
    if (q) q.value = "";
    if (c) c.value = "";
    renderList();
  }
});

(async function init() {
  showLoader();
  try {
    const user = await waitForUser();
    renderNav({ active: "dir", user, isAdmin: isGoogleUser(user) && (await isPlatformAdmin(user.uid)) });
    state.events = (await listPublicEvents()).map(withDivisionNames);
    render();
    if (location.hash === "#migrar" || location.hash === "#migrate") {
      document.getElementById("migrar")?.scrollIntoView({ block: "center" });
      openMigrate();
    }
  } catch (err) {
    console.error("[directory]", err);
    root.innerHTML = `<div class="ev-card ev-muted">${esc(EX.error)}</div>`;
  } finally {
    hideLoader();
  }
})();
