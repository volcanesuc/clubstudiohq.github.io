// /tournaments/js/directory.js
// Directorio público de torneos publicados en la plataforma.
// Buscador por texto (nombre, sede, categoría, país) y filtro por país; los finalizados se muestran de a poco.
import { countryName, flagOf } from "/tournaments/js/countries.js";
import { EX, LOCALE, exf, withDivisionNames } from "/tournaments/js/strings.js";
import { SURFACES, SURFACE_ICONS } from "/tournaments/js/model.js";
import { isHatEvent } from "/tournaments/js/hat.js";
import { normName } from "/tournaments/js/names.js";
import { isPlatformAdmin, listPublicEvents, registrationIsOpen } from "/tournaments/js/services.js";
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
    <div id="dirList">${listHtml()}</div>`;
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
  } catch (err) {
    console.error("[directory]", err);
    root.innerHTML = `<div class="ev-card ev-muted">${esc(EX.error)}</div>`;
  } finally {
    hideLoader();
  }
})();
