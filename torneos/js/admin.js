// /torneos/js/admin.js
// Admin de la plataforma: aprobar torneos (prueba gratis o pagado), rechazar y desactivar.
// Un admin es quien tenga un doc en platform_admins/{uid} (se crea a mano en la consola de Firebase).
import { EX, exf } from "/torneos/js/strings.js";
import { APPROVAL, isPlatformAdmin, listApprovalRequests, listApprovedEvents, setApproval } from "/torneos/js/services.js";
import { avatarHtml, esc, eventUrl, fmtDateRange, fmtWhen, hideLoader, isGoogleUser, renderNav, showLoader, toMillis, waitForUser } from "/torneos/js/ui.js";

const root = document.getElementById("tnRoot");
const state = { pending: [], active: [], tab: "", search: "" };
const DAY = 86400000;

function alertBox(msg, kind = "success") {
  const el = document.getElementById("tnAlert");
  el.className = `alert alert-${kind}`;
  el.textContent = msg;
  el.classList.toggle("d-none", !msg);
  if (kind === "success") setTimeout(() => el.classList.add("d-none"), 2500);
}

// "hace 3 h", "hace 2 días"
function ago(v) {
  const ms = toMillis(v);
  if (!ms) return "";
  const min = Math.round((Date.now() - ms) / 60000);
  if (min < 1) return EX.adAgoNow;
  if (min < 60) return exf(EX.adAgoMin, { n: min });
  const h = Math.round(min / 60);
  if (h < 24) return exf(EX.adAgoHours, { n: h });
  return exf(EX.adAgoDays, { n: Math.round(h / 24) });
}

const daysLeft = (v) => {
  const ms = toMillis(v);
  return ms ? Math.ceil((ms - Date.now()) / DAY) : null;
};

const isoIn = (days) => new Date(Date.now() + days * DAY).toISOString().slice(0, 10);

const thumb = (e, size = 64) => (e.image
  ? `<div class="pa-thumb" style="width:${size}px;height:${size}px;background-image:url('${esc(e.image)}')"></div>`
  : `<div class="pa-thumb pa-thumb--plain" style="width:${size}px;height:${size}px">🏆</div>`);

function ownerLine(e) {
  return `
    <div class="pa-owner">
      ${avatarHtml({ name: e.ownerName || e.ownerEmail || "?" }, 26)}
      <span class="fw-semibold">${esc(e.ownerName || EX.sqUnnamed)}</span>
      ${e.ownerEmail ? `<a class="ev-muted" href="mailto:${esc(e.ownerEmail)}">${esc(e.ownerEmail)}</a>` : ""}
    </div>`;
}

/* =========================
   Solicitudes pendientes
========================= */
function pendingCard(e) {
  const id = e.id;
  return `
    <form class="pa-card" data-event="${esc(id)}">
      <div class="pa-card__top">
        ${thumb(e, 72)}
        <div class="flex-grow-1 min-w-0">
          <div class="d-flex justify-content-between align-items-start gap-2 flex-wrap">
            <a class="pa-card__name" href="${esc(eventUrl({ id }))}" target="_blank" rel="noopener">${esc(e.name || "—")} <i class="bi bi-box-arrow-up-right small"></i></a>
            <span class="pa-pill pa-pill--wait"><i class="bi bi-hourglass-split"></i> ${esc(ago(e.approval?.requestedAt) || EX.adminPending)}</span>
          </div>
          <div class="small ev-muted">${esc([fmtDateRange(e.startDate, e.endDate), e.venue].filter(Boolean).join(" · "))}</div>
          ${(e.divisions || []).length ? `<div class="d-flex flex-wrap gap-1 mt-1">${e.divisions.map((d) => `<span class="ev-chip">${esc(d.name)}</span>`).join("")}</div>` : ""}
          ${ownerLine(e)}
          ${e.approval?.note ? `<div class="pa-note"><i class="bi bi-chat-left-quote me-1"></i>${esc(e.approval.note)}</div>` : ""}
        </div>
      </div>
      <div class="pa-card__form">
        <div>
          <div class="pa-label">${esc(EX.adminPlan)}</div>
          <div class="pa-seg">
            <input type="radio" class="btn-check" name="plan-${esc(id)}" id="pt-${esc(id)}" value="trial" checked />
            <label class="btn" for="pt-${esc(id)}"><i class="bi bi-gift me-1"></i>${esc(EX.planTrial)}</label>
            <input type="radio" class="btn-check" name="plan-${esc(id)}" id="pp-${esc(id)}" value="paid" />
            <label class="btn" for="pp-${esc(id)}"><i class="bi bi-credit-card me-1"></i>${esc(EX.planPaid)}</label>
          </div>
        </div>
        <div>
          <div class="pa-label">${esc(EX.adminExpires)}</div>
          <div class="d-flex flex-wrap gap-1 align-items-center">
            <button type="button" class="pa-preset" data-days="14">${esc(exf(EX.adDays, { n: 14 }))}</button>
            <button type="button" class="pa-preset" data-days="30">${esc(exf(EX.adDays, { n: 30 }))}</button>
            <button type="button" class="pa-preset is-active" data-days="">${esc(EX.adNoExpiry)}</button>
            <input class="form-control form-control-sm" style="width:auto" type="date" data-f="expires" aria-label="${esc(EX.adminExpires)}" />
          </div>
        </div>
        <div class="flex-grow-1" style="min-width:14rem">
          <div class="pa-label">${esc(EX.adminNote)}</div>
          <input class="form-control form-control-sm" data-f="note" maxlength="500" placeholder="${esc(EX.adNotePh)}" />
        </div>
        <div class="d-flex gap-2 ms-auto align-self-end">
          <button type="button" class="btn btn-outline-danger" data-act="reject"><i class="bi bi-x-lg me-1"></i>${esc(EX.adminReject)}</button>
          <button type="submit" class="btn btn-success"><i class="bi bi-check-lg me-1"></i>${esc(EX.adminApprove)}</button>
        </div>
      </div>
    </form>`;
}

/* =========================
   Torneos activos
========================= */
function expiryPill(a) {
  if (!a.expiresAt) return `<span class="pa-pill">${esc(EX.adNoExpiry)}</span>`;
  const d = daysLeft(a.expiresAt);
  const date = fmtWhen(a.expiresAt, { day: "numeric", month: "short", year: "numeric" });
  if (d < 0) return `<span class="pa-pill pa-pill--bad"><i class="bi bi-exclamation-triangle"></i> ${esc(exf(EX.adExpired, { date }))}</span>`;
  if (d <= 7) return `<span class="pa-pill pa-pill--warn"><i class="bi bi-clock"></i> ${esc(exf(EX.adExpiresIn, { n: d }))}</span>`;
  return `<span class="pa-pill">${esc(exf(EX.approvalExpires, { date }))}</span>`;
}

function activeRow(e) {
  const a = e.approval || {};
  return `
    <div class="pa-row" data-event="${esc(e.id)}">
      ${thumb(e, 52)}
      <div class="flex-grow-1 min-w-0">
        <a class="fw-bold text-decoration-none" href="${esc(eventUrl({ id: e.id }))}" target="_blank" rel="noopener">${esc(e.name || "—")}</a>
        <div class="small ev-muted text-truncate">${esc([fmtDateRange(e.startDate, e.endDate), e.ownerName || e.ownerEmail].filter(Boolean).join(" · "))}</div>
        <div class="d-flex flex-wrap gap-1 mt-1">
          <span class="pa-pill ${a.plan === "paid" ? "pa-pill--paid" : "pa-pill--trial"}"><i class="bi ${a.plan === "paid" ? "bi-credit-card" : "bi-gift"}"></i> ${esc(a.plan === "paid" ? EX.planPaid : EX.planTrial)}</span>
          ${expiryPill(a)}
          <span class="pa-pill ${e.isPublic ? "pa-pill--ok" : ""}"><i class="bi ${e.isPublic ? "bi-globe2" : "bi-eye-slash"}"></i> ${esc(e.isPublic ? EX.adPublic : EX.adPrivate)}</span>
        </div>
      </div>
      <div class="d-flex gap-1 flex-shrink-0">
        <a class="btn btn-sm btn-light" href="${esc(eventUrl({ id: e.id }))}" target="_blank" rel="noopener" title="${esc(EX.openPublic)}"><i class="bi bi-eye"></i></a>
        <button class="btn btn-sm btn-outline-danger" data-act="revoke">${esc(EX.adminRevoke)}</button>
      </div>
    </div>`;
}

/* =========================
   Página
========================= */
function render() {
  const { pending, active } = state;
  if (!state.tab) state.tab = pending.length ? "pending" : "active";
  const trial = active.filter((e) => e.approval?.plan !== "paid").length;
  const paid = active.length - trial;
  const soon = active.filter((e) => {
    const d = daysLeft(e.approval?.expiresAt);
    return d !== null && d <= 7;
  }).length;
  const q = state.search.trim().toLowerCase();
  const shown = q ? active.filter((e) => [e.name, e.ownerName, e.ownerEmail, e.venue].join(" ").toLowerCase().includes(q)) : active;
  const stat = (n, label, icon, cls = "") => `<div class="pa-stat ${cls}"><i class="bi ${icon}"></i><div><div class="pa-stat__n">${n}</div><div class="pa-stat__l">${esc(label)}</div></div></div>`;

  root.innerHTML = `
    <section class="pa-hero">
      <div>
        <div class="pa-hero__eyebrow"><i class="bi bi-shield-lock"></i> ${esc(EX.adPlatform)}</div>
        <h1>${esc(EX.adminTitle)}</h1>
        <div class="opacity-75">${esc(EX.adminSubtitle)}</div>
      </div>
      <div class="pa-stats">
        ${stat(pending.length, EX.adminPending, "bi-hourglass-split", pending.length ? "is-hot" : "")}
        ${stat(active.length, EX.adminActive, "bi-lightning-charge")}
        ${stat(trial, EX.planTrial, "bi-gift")}
        ${stat(paid, EX.planPaid, "bi-credit-card")}
        ${stat(soon, EX.adSoon, "bi-clock", soon ? "is-warn" : "")}
      </div>
    </section>

    <nav class="tp-tabs my-3" role="tablist">
      <button class="tp-tab ${state.tab === "pending" ? "is-active" : ""}" data-pa-tab="pending"><i class="bi bi-inbox"></i> ${esc(EX.adminPending)} <span class="pa-count">${pending.length}</span></button>
      <button class="tp-tab ${state.tab === "active" ? "is-active" : ""}" data-pa-tab="active"><i class="bi bi-check2-circle"></i> ${esc(EX.adminActive)} <span class="pa-count">${active.length}</span></button>
    </nav>

    ${state.tab === "pending"
      ? (pending.length ? `<div class="d-grid gap-3">${pending.map(pendingCard).join("")}</div>`
        : `<div class="pa-empty"><div class="display-6">🎉</div><div class="fw-bold mt-2">${esc(EX.adminNoPending)}</div><div class="small ev-muted">${esc(EX.adAllCaughtUp)}</div></div>`)
      : `
        <div class="pa-search">
          <i class="bi bi-search"></i>
          <input class="form-control" id="paSearch" placeholder="${esc(EX.adSearch)}" value="${esc(state.search)}" />
        </div>
        ${shown.length ? `<div class="pa-list">${shown.map(activeRow).join("")}</div>` : `<div class="pa-empty small ev-muted">${esc(EX.adNoActive)}</div>`}`}`;
}

async function reload() {
  const [pending, active] = await Promise.all([listApprovalRequests(), listApprovedEvents()]);
  state.pending = pending;
  state.active = active;
  render();
}

async function act(fn, msg = EX.saved) {
  showLoader();
  try {
    await fn();
    alertBox(msg);
    await reload();
  } catch (err) {
    console.error(err);
    alertBox(`${EX.error} ${err?.code || ""}`, "danger");
  } finally {
    hideLoader();
  }
}

root.addEventListener("submit", (ev) => {
  const form = ev.target.closest("[data-event]");
  if (!form) return;
  ev.preventDefault();
  const id = form.dataset.event;
  const f = (k) => form.querySelector(`[data-f=${k}]`).value.trim();
  const plan = form.querySelector(`input[name="plan-${CSS.escape(id)}"]:checked`)?.value || "trial";
  act(() => setApproval(id, {
    status: APPROVAL.APPROVED,
    plan,
    expiresAt: f("expires") ? new Date(`${f("expires")}T23:59:59`) : null,
    adminNote: f("note"),
  }), EX.adApproved);
});

root.addEventListener("click", (ev) => {
  const tab = ev.target.closest("[data-pa-tab]");
  if (tab) {
    state.tab = tab.dataset.paTab;
    return render();
  }
  // vencimiento rápido: +14 / +30 días o sin vencimiento
  const preset = ev.target.closest("[data-days]");
  if (preset) {
    const form = preset.closest("[data-event]");
    form.querySelectorAll("[data-days]").forEach((b) => b.classList.toggle("is-active", b === preset));
    form.querySelector("[data-f=expires]").value = preset.dataset.days ? isoIn(Number(preset.dataset.days)) : "";
    return;
  }
  const btn = ev.target.closest("[data-act]");
  if (!btn) return;
  const holder = btn.closest("[data-event]");
  const note = holder.querySelector?.("[data-f=note]")?.value.trim() || "";
  if (btn.dataset.act === "reject" && confirm(EX.adRejectConfirm)) act(() => setApproval(holder.dataset.event, { status: APPROVAL.REJECTED, adminNote: note }));
  if (btn.dataset.act === "revoke" && confirm(EX.adRevokeConfirm)) act(() => setApproval(holder.dataset.event, { status: APPROVAL.NONE }));
});

root.addEventListener("input", (ev) => {
  if (ev.target.id === "paSearch") {
    state.search = ev.target.value;
    const pos = ev.target.selectionStart;
    render();
    const input = document.getElementById("paSearch");
    input.focus();
    input.setSelectionRange(pos, pos);
  }
  if (ev.target.dataset.f === "expires") {
    ev.target.closest("[data-event]").querySelectorAll("[data-days]").forEach((b) => b.classList.remove("is-active"));
  }
});

(async function init() {
  showLoader();
  try {
    const user = await waitForUser();
    const admin = isGoogleUser(user) && (await isPlatformAdmin(user.uid));
    renderNav({ active: "admin", user, isAdmin: admin });
    if (!admin) {
      root.innerHTML = `<div class="pa-empty"><div class="display-6">🔒</div><div class="fw-bold mt-2">${esc(EX.adminOnly)}</div></div>`;
      return;
    }
    await reload();
  } catch (err) {
    console.error("[admin]", err);
    alertBox(`${EX.error} ${err?.code || ""}`, "danger");
  } finally {
    hideLoader();
  }
})();
