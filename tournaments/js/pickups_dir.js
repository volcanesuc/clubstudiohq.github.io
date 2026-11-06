// /tournaments/js/pickups_dir.js
// /pickups/: directorio público de pickups. Arriba "Mis pickups" (donde estoy anotado), después próximos y anteriores.
import { EX, LOCALE } from "/tournaments/js/strings.js";
import { PK, pkf } from "/tournaments/js/pickups_strings.js";
import { isPlatformAdmin } from "/tournaments/js/services.js";
import { PICKUP_STATUS, SPOT, fmtMoney, hasStarted, minPrice, pickupMs, spotOf } from "/tournaments/js/pickups.js";
import { listPlayers, listPublicPickups, myPickups, pickupUrl } from "/tournaments/js/pickups_services.js";
import { dateStamp, payChip, statusLabel } from "/tournaments/js/pickups_manage.js";
import { esc, fmtWhen, hideLoader, isGoogleUser, renderNav, showLoader, teamBadge, waitForUser } from "/tournaments/js/ui.js";

const root = document.getElementById("tnRoot");
const isUpcoming = (p) => p.status === PICKUP_STATUS.PUBLISHED && !hasStarted(p);

function priceText(p) {
  const min = minPrice(p);
  return min > 0 ? pkf(PK.dirFrom, { amount: fmtMoney(min, p.currency || "USD", LOCALE) }) : PK.payFree;
}

function card(p, extra = "") {
  const meta = [fmtWhen(p.startAt, { weekday: "short", hour: "2-digit", minute: "2-digit" }), p.venue || p.city].filter(Boolean).join(" · ");
  const sub = [p.orgName, Number(p.capacity || 0) ? pkf(PK.dirCap, { n: p.capacity }) : PK.dirNoCap, priceText(p)].filter(Boolean).join(" · ");
  const past = !isUpcoming(p);
  return `
    <div class="col-12 col-md-6 col-lg-4">
      <a class="dir-card dir-row h-100" href="${esc(pickupUrl(p))}">
        ${dateStamp(pickupMs(p.startAt))}
        <span class="dir-row__main">
          <span class="dir-card__name">${esc(p.title || "Pickup")}</span>
          <span class="dir-card__meta">${esc(meta)}</span>
          <span class="dir-card__meta d-flex align-items-center gap-1">${teamBadge({ id: p.orgId, name: p.orgName, logo: p.orgLogo, color: p.orgColor }, 16)} ${esc(sub)}</span>
          ${past ? `<span class="d-flex gap-1 mt-1"><span class="ev-chip">${esc(statusLabel(p))}</span></span>` : ""}
          ${extra}
        </span>
        <i class="bi bi-chevron-right dir-row__go"></i>
      </a>
    </div>`;
}

function section(title, items, empty = "") {
  if (!items.length && !empty) return "";
  return `
    <h2 class="h6 fw-bold text-uppercase ev-muted mt-4 mb-2">${esc(title)}</h2>
    ${items.length ? `<div class="row g-2">${items.join("")}</div>` : `<div class="ev-card small ev-muted">${esc(empty)}</div>`}`;
}

async function mineRows(user, upcoming) {
  if (!user || !upcoming.length) return [];
  const rows = await myPickups(user.uid, upcoming).catch(() => []);
  return Promise.all(rows.map(async ({ pickup, me }) => {
    const players = await listPlayers(pickup.id).catch(() => [me]);
    const spot = spotOf(pickup, players, me.id);
    const chips = `<span class="d-flex flex-wrap gap-1 mt-1"><span class="ev-chip ${spot === SPOT.IN ? "pk-pay-ok" : "pk-pay-review"}">${esc(spot === SPOT.IN ? PK.kIn : PK.spotWait)}</span>${payChip(me, pickup, spot)}</span>`;
    return card(pickup, chips);
  }));
}

(async function init() {
  showLoader();
  try {
    const raw = await waitForUser();
    const user = isGoogleUser(raw) ? raw : null;
    const platformAdmin = !!user && (await isPlatformAdmin(user.uid).catch(() => false));
    renderNav({ active: "pickups", user: raw, isAdmin: platformAdmin });
    const all = await listPublicPickups();
    const upcoming = all.filter(isUpcoming);
    const past = all.filter((p) => !isUpcoming(p)).sort((a, b) => pickupMs(b.startAt) - pickupMs(a.startAt)).slice(0, 24);
    const mine = await mineRows(user, upcoming);
    root.innerHTML = `
      <section class="ev-hero mb-3 d-flex justify-content-between align-items-end flex-wrap gap-3">
        <div>
          <h1>${esc(PK.dirTitle)}</h1>
          <div class="ev-hero__meta">${esc(PK.dirLead)}</div>
        </div>
        <a class="btn btn-light" href="/pickups/organize.html"><i class="bi bi-calendar-plus me-1"></i>${esc(PK.dirOrganize)}</a>
      </section>
      ${section(PK.dirMine, mine)}
      ${section(PK.dirUpcoming, upcoming.map((p) => card(p)), PK.dirEmpty)}
      ${section(PK.dirPast, past.map((p) => card(p)))}`;
  } catch (err) {
    console.error("[pickups]", err);
    const el = document.getElementById("tnAlert");
    el.className = "alert alert-danger";
    el.textContent = `${EX.error} ${err?.code || err?.message || ""}`;
  } finally {
    hideLoader();
  }
})();
