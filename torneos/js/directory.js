// /torneos/js/directory.js
// Directorio público de torneos publicados en la plataforma.
import { EX } from "/torneos/js/strings.js";
import { SURFACES, SURFACE_ICONS } from "/torneos/js/model.js";
import { isPlatformAdmin, listPublicEvents } from "/torneos/js/services.js";
import { esc, eventUrl, fmtDateRange, hideLoader, isGoogleUser, renderNav, showLoader, waitForUser } from "/torneos/js/ui.js";

const root = document.getElementById("tnRoot");
const todayKey = new Date().toISOString().slice(0, 10);

function card(e) {
  return `
    <div class="col-12 col-md-6 col-lg-4">
      <a class="ev-card tn-event-card h-100" href="${esc(eventUrl(e))}">
        ${e.image ? `<div class="tn-event-card__img" style="background-image:url('${esc(e.image)}')"></div>` : ""}
        <div class="fw-bold">${esc(e.name || "—")}</div>
        <div class="small ev-muted mt-1"><i class="bi bi-calendar-event"></i> ${esc(fmtDateRange(e.startDate, e.endDate))}</div>
        ${e.venue || SURFACES.includes(e.surface) ? `<div class="small ev-muted">${e.venue ? `<i class="bi bi-geo-alt"></i> ${esc(e.venue)}` : ""}${e.venue && SURFACES.includes(e.surface) ? " · " : ""}${SURFACES.includes(e.surface) ? `<i class="bi ${SURFACE_ICONS[e.surface]}"></i> ${esc(EX[`surface_${e.surface}`])}` : ""}</div>` : ""}
        ${(e.divisions || []).length || e.registrationOpen ? `<div class="mt-2 d-flex flex-wrap gap-1">${e.registrationOpen ? `<span class="ev-chip ev-chip--ok">${esc(EX.regOpen)}</span>` : ""}${(e.divisions || []).map((d) => `<span class="ev-chip">${esc(d.name)}</span>`).join("")}</div>` : ""}
      </a>
    </div>`;
}

(async function init() {
  showLoader();
  try {
    const user = await waitForUser();
    renderNav({ active: "dir", user, isAdmin: isGoogleUser(user) && (await isPlatformAdmin(user.uid)) });
    const events = await listPublicEvents();
    const current = events.filter((e) => (e.endDate || e.startDate || "9999") >= todayKey).reverse();
    const past = events.filter((e) => (e.endDate || e.startDate || "9999") < todayKey);
    root.innerHTML = `
      <section class="ev-hero mb-4 d-flex justify-content-between align-items-end flex-wrap gap-3">
        <div>
          <h1>${esc(EX.dirTitle)}</h1>
          <div class="ev-hero__meta">${esc(EX.dirSubtitle)}</div>
        </div>
        <a class="btn tn-btn-grad" href="/torneos/organizar.html"><i class="bi bi-plus-lg me-1"></i>${esc(EX.dirOrganize)}</a>
      </section>
      ${current.length ? `<h2 class="h6 mb-2">${esc(EX.dirLive)}</h2><div class="row g-3 mb-4">${current.map(card).join("")}</div>` : ""}
      ${past.length ? `<h2 class="h6 mb-2">${esc(EX.dirPast)}</h2><div class="row g-3">${past.map(card).join("")}</div>` : ""}
      ${events.length ? "" : `<div class="ev-card ev-muted">${esc(EX.dirEmpty)}</div>`}`;
  } catch (err) {
    console.error("[directory]", err);
    root.innerHTML = `<div class="ev-card ev-muted">${esc(EX.error)}</div>`;
  } finally {
    hideLoader();
  }
})();
