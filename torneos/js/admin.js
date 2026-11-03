// /torneos/js/admin.js
// Admin de la plataforma: aprobar torneos (prueba gratis o pagado), rechazar y desactivar.
// Un admin es quien tenga un doc en platform_admins/{uid} (se crea a mano en la consola de Firebase).
import { EX, exf } from "/torneos/js/strings.js";
import { APPROVAL, isPlatformAdmin, listApprovalRequests, listApprovedEvents, setApproval } from "/torneos/js/services.js";
import { esc, eventUrl, fmtDateRange, fmtWhen, hideLoader, isGoogleUser, renderNav, showLoader, waitForUser } from "/torneos/js/ui.js";

const root = document.getElementById("tnRoot");

function alertBox(msg, kind = "success") {
  const el = document.getElementById("tnAlert");
  el.className = `alert alert-${kind}`;
  el.textContent = msg;
  if (kind === "success") setTimeout(() => el.classList.add("d-none"), 2500);
}

function owner(e) {
  return [e.ownerName, e.ownerEmail].filter(Boolean).join(" · ");
}

function pendingCard(e) {
  return `
    <form class="ev-card" data-event="${esc(e.id)}">
      <div class="d-flex justify-content-between flex-wrap gap-2">
        <div class="min-w-0">
          <a class="fw-bold" href="${esc(eventUrl({ id: e.id }))}" target="_blank" rel="noopener">${esc(e.name || "—")}</a>
          <div class="small ev-muted">${esc(fmtDateRange(e.startDate, e.endDate))}${e.venue ? ` · ${esc(e.venue)}` : ""}</div>
          <div class="small ev-muted">${esc(EX.adminOwner)}: ${esc(owner(e))}</div>
          <div class="small ev-muted">${esc(EX.adminRequestedAt)}: ${esc(fmtWhen(e.approval?.requestedAt))}</div>
          ${e.approval?.note ? `<div class="small mt-1">“${esc(e.approval.note)}”</div>` : ""}
        </div>
      </div>
      <div class="row g-2 mt-2 align-items-end">
        <div class="col-6 col-md-3">
          <label class="form-label small">${esc(EX.adminPlan)}</label>
          <select class="form-select form-select-sm" data-f="plan">
            <option value="trial">${esc(EX.planTrial)}</option>
            <option value="paid">${esc(EX.planPaid)}</option>
          </select>
        </div>
        <div class="col-6 col-md-3">
          <label class="form-label small">${esc(EX.adminExpires)}</label>
          <input class="form-control form-control-sm" type="date" data-f="expires" />
        </div>
        <div class="col-12 col-md-6">
          <label class="form-label small">${esc(EX.adminNote)}</label>
          <input class="form-control form-control-sm" data-f="note" maxlength="500" />
        </div>
        <div class="col-12 d-flex justify-content-end gap-2">
          <button type="button" class="btn btn-sm btn-outline-danger" data-act="reject">${esc(EX.adminReject)}</button>
          <button type="submit" class="btn btn-sm btn-primary">${esc(EX.adminApprove)}</button>
        </div>
      </div>
    </form>`;
}

function activeRow(e) {
  const a = e.approval || {};
  return `
    <tr data-event="${esc(e.id)}">
      <td><a href="${esc(eventUrl({ id: e.id }))}" target="_blank" rel="noopener">${esc(e.name || "—")}</a><div class="small ev-muted">${esc(owner(e))}</div></td>
      <td class="small">${esc(fmtDateRange(e.startDate, e.endDate))}</td>
      <td><span class="ev-chip ev-chip--final">${esc(a.plan === "paid" ? EX.planPaid : EX.planTrial)}</span>${a.expiresAt ? `<div class="small ev-muted">${esc(exf(EX.approvalExpires, { date: fmtWhen(a.expiresAt, { day: "numeric", month: "short", year: "numeric" }) }))}</div>` : ""}</td>
      <td class="text-end"><button class="btn btn-sm btn-outline-danger" data-act="revoke">${esc(EX.adminRevoke)}</button></td>
    </tr>`;
}

async function render() {
  const [pending, active] = await Promise.all([listApprovalRequests(), listApprovedEvents()]);
  root.innerHTML = `
    <h1 class="h3 fw-bold mb-1">${esc(EX.adminTitle)}</h1>
    <div class="ev-muted mb-3">${esc(EX.adminSubtitle)}</div>
    <h2 class="h6 mt-3 mb-2">${esc(EX.adminPending)} (${pending.length})</h2>
    ${pending.length ? pending.map(pendingCard).join("") : `<div class="ev-card ev-muted">${esc(EX.adminNoPending)}</div>`}
    <h2 class="h6 mt-4 mb-2">${esc(EX.adminActive)} (${active.length})</h2>
    <div class="ev-card p-0 overflow-hidden">
      <div class="table-responsive">
        <table class="table table-sm align-middle mb-0 ev-table"><tbody>${active.map(activeRow).join("")}</tbody></table>
      </div>
    </div>`;
}

async function act(fn) {
  showLoader();
  try {
    await fn();
    alertBox(EX.saved);
    await render();
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
  const f = (k) => form.querySelector(`[data-f=${k}]`).value.trim();
  act(() => setApproval(form.dataset.event, {
    status: APPROVAL.APPROVED,
    plan: f("plan"),
    expiresAt: f("expires") ? new Date(`${f("expires")}T23:59:59`) : null,
    adminNote: f("note"),
  }));
});

root.addEventListener("click", (ev) => {
  const btn = ev.target.closest("[data-act]");
  if (!btn) return;
  const holder = btn.closest("[data-event]");
  const note = holder.querySelector?.("[data-f=note]")?.value.trim() || "";
  if (btn.dataset.act === "reject") act(() => setApproval(holder.dataset.event, { status: APPROVAL.REJECTED, adminNote: note }));
  if (btn.dataset.act === "revoke" && confirm(EX.confirmDelete)) act(() => setApproval(holder.dataset.event, { status: APPROVAL.NONE }));
});

(async function init() {
  showLoader();
  try {
    const user = await waitForUser();
    const admin = isGoogleUser(user) && (await isPlatformAdmin(user.uid));
    renderNav({ active: "admin", user, isAdmin: admin });
    if (!admin) {
      root.innerHTML = `<div class="ev-card ev-muted">${esc(EX.adminOnly)}</div>`;
      return;
    }
    await render();
  } catch (err) {
    console.error("[admin]", err);
    alertBox(`${EX.error} ${err?.code || ""}`, "danger");
  } finally {
    hideLoader();
  }
})();
