// /tournaments/js/pickups_manage.js
// Pestaña Pickups de la organización: lista, crear/editar y la lista de jugadores de cada pickup
// (pagos, comprobantes, lista de espera, agregar a mano, asistencia).
import { EX, LOCALE } from "/tournaments/js/strings.js";
import { PK, pkf } from "/tournaments/js/pickups_strings.js";
import {
  PAY,
  PICKUP_STATUS,
  PLAYER_STATUS,
  RAFFLE,
  SPOT,
  canLeave,
  raffleState,
  defaultPickupSettings,
  fmtMoney,
  hasStarted,
  owes,
  pickupMs,
  splitSpots,
  totals,
} from "/tournaments/js/pickups.js";
import {
  addManualPlayer,
  deletePickup,
  listOrgPickups,
  listPlayers,
  loadPickup,
  loadProof,
  pickupAbsUrl,
  pickupUrl,
  removePlayer,
  savePickup,
  saveRaffle,
  setPayment,
  setPickupCapacity,
  setPickupStatus,
  setPlayerTier,
  updatePlayer,
} from "/tournaments/js/pickups_services.js";
import { askConfirm, avatarHtml, esc, fmtWhen } from "/tournaments/js/ui.js";
import { pickWinner, playRaffle, raffleCard } from "/tournaments/js/pickups_raffle.js";

const pad = (n) => String(n).padStart(2, "0");
const dateInput = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const timeInput = (ms) => { const d = new Date(ms); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const atLocal = (day, time) => (day && time ? new Date(`${day}T${time}`) : null);

export function payChip(pl, pickup, spot) {
  const late = owes(pickup, pl, spot);
  const map = {
    [PAY.APPROVED]: ["pk-pay-ok", PK.payApproved],
    [PAY.FREE]: ["pk-pay-free", PK.payFree],
    [PAY.SUBMITTED]: ["pk-pay-review", PK.payReview],
    [PAY.REJECTED]: ["pk-pay-no", PK.payRejected],
    [PAY.NONE]: [late ? "pk-pay-no" : "pk-pay-pending", late ? PK.payOwes : PK.payNone],
  };
  if (pl.raffleWinner) return `<span class="ev-chip pk-pay-free"><i class="bi bi-ticket-perforated-fill me-1"></i>${esc(PK.rfChip)}</span>`;
  const [cls, label] = Number(pl.price || 0) <= 0 ? map[PAY.FREE] : map[pl.paymentStatus] || map[PAY.NONE];
  return `<span class="ev-chip ${cls}">${esc(label)}</span>`;
}

export function statusLabel(p) {
  if (p.status === PICKUP_STATUS.CANCELLED) return PK.stCancelled;
  if (p.status === PICKUP_STATUS.DRAFT) return PK.stDraft;
  if (p.status === PICKUP_STATUS.FINISHED || hasStarted(p)) return PK.stFinished;
  return PK.stPublished;
}

export function dateStamp(ms) {
  const d = new Date(ms);
  return `<span class="pk-date"><b>${d.getDate()}</b><small>${esc(d.toLocaleDateString(LOCALE, { month: "short" }).replace(".", ""))}</small></span>`;
}

export function mountPickups(box, ctx) {
  const { org, alertBox, run } = ctx;
  // permiso vencido: ve las listas y marca pagos, pero no crea, edita ni publica pickups
  const locked = !!ctx.locked;
  const settings = { ...defaultPickupSettings(org.country), ...(org.pickupSettings || {}) };
  const money = (v, p) => fmtMoney(v, p?.currency || settings.currency, LOCALE);
  const st = { list: null, pickup: null, players: [], form: null, showLeft: false };

  const setP = (id) => {
    const u = new URL(location.href);
    if (id) u.searchParams.set("p", id);
    else u.searchParams.delete("p");
    history.replaceState(null, "", u);
  };

  /* ----- lista ----- */
  async function showList() {
    st.pickup = null;
    st.form = null;
    setP("");
    st.list = await listOrgPickups(org.id);
    const now = Date.now();
    const upcoming = st.list.filter((p) => pickupMs(p.startAt) >= now - 3 * 3600000 && p.status !== PICKUP_STATUS.CANCELLED).reverse();
    const past = st.list.filter((p) => !upcoming.includes(p));
    const row = (p) => `
      <a class="dir-card dir-row mb-2" href="?org=${esc(org.id)}&tab=pickups&p=${esc(p.id)}" data-open="${esc(p.id)}">
        ${dateStamp(pickupMs(p.startAt))}
        <span class="dir-row__main">
          <span class="dir-card__name">${esc(p.title || "—")}</span>
          <span class="dir-card__meta">${esc([fmtWhen(p.startAt, { weekday: "short", hour: "2-digit", minute: "2-digit" }), p.venue].filter(Boolean).join(" · "))}</span>
        </span>
        <span class="ev-chip">${esc(statusLabel(p))}</span>
        <i class="bi bi-chevron-right dir-row__go"></i>
      </a>`;
    box.innerHTML = `
      <div class="d-flex justify-content-between align-items-center gap-2 mb-3 flex-wrap">
        <div class="small ev-muted">${esc(PK.pkListLead)}</div>
        ${locked ? "" : `<button class="btn tn-btn-grad" data-pk="new"><i class="bi bi-plus-lg me-1"></i>${esc(PK.pkNew)}</button>`}
      </div>
      ${upcoming.length ? `<div class="pk-sec">${esc(PK.pkUpcoming)}</div>${upcoming.map(row).join("")}` : `<div class="ev-card ev-muted small mb-3">${esc(PK.pkNoUpcoming)}</div>`}
      ${past.length ? `<div class="pk-sec mt-3">${esc(PK.pkPast)}</div>${past.map(row).join("")}` : ""}`;
  }

  /* ----- crear / editar ----- */
  function showForm(p = null) {
    st.form = p || {};
    const start = p ? pickupMs(p.startAt) : (() => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(19, 0, 0, 0); return d.getTime(); })();
    const end = p?.endAt ? pickupMs(p.endAt) : start + 2 * 3600000;
    const used = new Map((p?.tiers || []).map((t) => [t.id, t]));
    const tiers = [...settings.tiers];
    (p?.tiers || []).forEach((t) => { if (!tiers.some((x) => x.id === t.id)) tiers.push(t); });
    const hours = [0, 1, 2, 3, 6, 12, 24, 48];
    const lh = Number(p?.leaveHours ?? settings.leaveHours);
    if (!hours.includes(lh)) hours.push(lh);
    box.innerHTML = `
      <div class="ev-card">
        <div class="d-flex justify-content-between align-items-center mb-3 gap-2 flex-wrap">
          <h2 class="h5 fw-bold mb-0">${esc(p ? PK.pkEdit : PK.pkNew)}</h2>
          <span class="ev-chip">${esc(p ? statusLabel(p) : PK.stDraft)}</span>
        </div>
        <div class="row g-3">
          <div class="col-12 col-md-6"><label class="form-label small fw-semibold" for="pfTitle">${esc(PK.pfTitle)}</label><input class="form-control" id="pfTitle" value="${esc(p?.title || "")}" placeholder="${esc(PK.pfTitlePh)}" maxlength="80" /></div>
          <div class="col-12 col-md-6"><label class="form-label small fw-semibold" for="pfVenue">${esc(PK.pfVenue)}</label><input class="form-control" id="pfVenue" value="${esc(p?.venue || "")}" placeholder="${esc(PK.pfVenuePh)}" maxlength="120" /></div>
          <div class="col-12 col-md-4"><label class="form-label small fw-semibold" for="pfDay">${esc(PK.pfDay)}</label><input class="form-control" type="date" id="pfDay" value="${dateInput(start)}" /></div>
          <div class="col-6 col-md-2"><label class="form-label small fw-semibold" for="pfStart">${esc(PK.pfStart)}</label><input class="form-control" type="time" id="pfStart" value="${timeInput(start)}" /></div>
          <div class="col-6 col-md-2"><label class="form-label small fw-semibold" for="pfEnd">${esc(PK.pfEnd)}</label><input class="form-control" type="time" id="pfEnd" value="${timeInput(end)}" /></div>
          <div class="col-6 col-md-4"><label class="form-label small fw-semibold" for="pfCity">${esc(PK.orgCity)}</label><input class="form-control" id="pfCity" value="${esc(p?.city ?? org.city ?? "")}" maxlength="60" /></div>
          <div class="col-6 col-md-4"><label class="form-label small fw-semibold" for="pfCap">${esc(PK.pfCapacity)}</label><input class="form-control" type="number" min="0" id="pfCap" value="${esc(p?.capacity ?? settings.defaultCapacity)}" /><div class="form-text">${esc(PK.pfCapacityHint)}</div></div>
          <div class="col-12 col-md-8"><label class="form-label small fw-semibold" for="pfLeave">${esc(PK.setLeaveHours)}</label>
            <select class="form-select" id="pfLeave">${hours.sort((a, b) => a - b).map((h) => `<option value="${h}" ${h === lh ? "selected" : ""}>${esc(h ? pkf(PK.setLeaveOpt, { n: h }) : PK.setLeaveStart)}</option>`).join("")}</select>
            <div class="form-text">${esc(PK.pfLeaveHint)}</div></div>
          <div class="col-12">
            <div class="pk-box p-2">
              <div class="d-flex align-items-center gap-2 flex-wrap">
                <div class="form-check form-switch mb-0 flex-grow-1">
                  <input class="form-check-input" type="checkbox" role="switch" id="pfRaffle" ${p?.raffle?.enabled ? "checked" : ""} ${p?.raffle?.winnerId ? "disabled" : ""} />
                  <label class="form-check-label fw-semibold small" for="pfRaffle"><i class="bi bi-ticket-perforated me-1"></i>${esc(PK.pfRaffle)}</label>
                </div>
                <label class="small ev-muted" for="pfRaffleMin">${esc(PK.pfRaffleMin)}</label>
                <input class="form-control form-control-sm" type="number" min="2" id="pfRaffleMin" value="${esc(p?.raffle?.minPlayers ?? Math.max(2, Math.round((p?.capacity ?? settings.defaultCapacity) / 2) || 10))}" style="width:90px" ${p?.raffle?.winnerId ? "disabled" : ""} />
              </div>
              <div class="form-text mt-1">${esc(p?.raffle?.winnerId ? PK.pfRaffleDone : PK.pfRaffleHint)}</div>
            </div>
          </div>
        </div>
        <div class="fw-semibold small mt-3 mb-1">${esc(PK.pfTiers)}</div>
        <div class="pk-box">
          ${tiers.map((t) => {
            const on = p ? used.has(t.id) : true;
            const price = used.get(t.id)?.price ?? t.price;
            return `<label class="pk-tier-pick" data-tid="${esc(t.id)}" data-name="${esc(t.name)}" data-rule="${esc(t.rule || "any")}">
              <input type="checkbox" class="form-check-input" ${on ? "checked" : ""} />
              <span class="flex-grow-1">${esc(t.name)} <span class="small ev-muted">· ${esc(PK.setRules[t.rule] || "")}</span></span>
              <input class="form-control form-control-sm" type="number" min="0" value="${esc(price)}" aria-label="${esc(PK.setTierPrice)}" style="width:110px" />
            </label>`;
          }).join("") || `<div class="small ev-muted p-2">${esc(PK.setNoTiers)}</div>`}
        </div>
        <div class="small ev-muted mt-1">${esc(PK.pfTiersHint)} · ${esc(settings.currency)}</div>
        <label class="form-label small fw-semibold mt-3" for="pfPay">${esc(PK.setPayInfo)}</label>
        <textarea class="form-control" id="pfPay" rows="2" maxlength="400" placeholder="${esc(PK.setPayInfoPh)}">${esc(p?.payInfo ?? settings.payInfo ?? "")}</textarea>
        <div class="d-flex justify-content-end gap-2 mt-3 flex-wrap">
          <button class="btn btn-light" data-pk="${p ? "open" : "list"}" ${p ? `data-id="${esc(p.id)}"` : ""}>${esc(EX.cancel)}</button>
          <button class="btn ${!p || p.status === PICKUP_STATUS.DRAFT ? "btn-light" : "tn-btn-grad"}" data-pk="save">${esc(!p || p.status === PICKUP_STATUS.DRAFT ? PK.pfSaveDraft : PK.orgSave)}</button>
          ${!p || p.status === PICKUP_STATUS.DRAFT ? `<button class="btn tn-btn-grad" data-pk="save" data-publish="1"><i class="bi bi-send me-1"></i>${esc(PK.pfPublish)}</button>` : ""}
        </div>
      </div>`;
  }

  function readForm() {
    const v = (id) => box.querySelector(`#${id}`).value.trim();
    const startAt = atLocal(v("pfDay"), v("pfStart"));
    let endAt = atLocal(v("pfDay"), v("pfEnd"));
    if (startAt && endAt && endAt <= startAt) endAt = new Date(endAt.getTime() + 86400000); // termina pasada la medianoche
    const tiers = [...box.querySelectorAll("[data-tid]")].filter((l) => l.querySelector("input[type=checkbox]").checked).map((l) => ({
      id: l.dataset.tid,
      name: l.dataset.name,
      rule: l.dataset.rule,
      price: Math.max(0, Number(l.querySelector("input[type=number]").value || 0)),
    }));
    const raffle = { enabled: box.querySelector("#pfRaffle").checked, minPlayers: Number(v("pfRaffleMin")) || 2 };
    return { title: v("pfTitle"), venue: v("pfVenue"), city: v("pfCity"), startAt, endAt, capacity: v("pfCap"), leaveHours: Number(v("pfLeave")), tiers, payInfo: v("pfPay"), currency: st.form?.currency || settings.currency, raffle };
  }

  /* ----- un pickup ----- */
  async function showPickup(id) {
    st.form = null;
    const [p, players] = await Promise.all([loadPickup(id), listPlayers(id)]);
    if (!p || p.orgId !== org.id) return showList();
    st.pickup = p;
    st.players = players;
    setP(p.id);
    renderPickup();
  }

  function playerRow(pl, spot, i) {
    const p = st.pickup;
    const paidable = Number(pl.price || 0) > 0;
    const src = pl.source === "manual" ? PK.srcManual : pl.source === "friend" ? PK.srcFriend : "";
    const att = pl.attendance === "attended" ? ` · ${PK.attYes}` : pl.attendance === "no_show" ? ` · ${PK.attNo}` : "";
    let actions = "";
    if (spot === SPOT.WAITLIST) actions = `<button class="btn btn-sm btn-light" data-pl-act="promote"><i class="bi bi-arrow-up me-1"></i>${esc(PK.plPromote)}</button>`;
    else if (pl.paymentStatus === PAY.SUBMITTED) actions = `<button class="btn btn-sm btn-light" data-pl-act="proof"><i class="bi bi-eye me-1"></i>${esc(PK.plProof)}</button>`;
    else if (paidable && pl.paymentStatus !== PAY.APPROVED) actions = `<button class="btn btn-sm btn-light" data-pl-act="paid"><i class="bi bi-cash me-1"></i>${esc(PK.plMarkPaid)}</button>`;
    return `
      <div class="pa-row pk-player" data-pl="${esc(pl.id)}">
        ${spot === SPOT.WAITLIST ? `<span class="pk-num">${i + 1}</span>` : avatarHtml(pl, 34)}
        <div class="flex-grow-1 min-w-0">
          <div class="fw-semibold text-truncate">${esc(pl.name || "—")}${pl.number != null && pl.number !== "" ? ` <span class="ev-muted small">#${esc(pl.number)}</span>` : ""}</div>
          <div class="small ev-muted text-truncate">${esc([pl.tierName, paidable ? money(pl.price, p) : PK.payFree, src].filter(Boolean).join(" · ") + att)}</div>
        </div>
        ${spot === SPOT.WAITLIST ? `<span class="ev-chip">${esc(PK.spotWait)}</span>` : payChip(pl, p, spot)}
        <div class="d-flex gap-1 flex-shrink-0">${actions}<button class="btn btn-sm btn-light" data-pl-act="edit" title="${esc(EX.edit)}" aria-label="${esc(EX.edit)}"><i class="bi bi-three-dots"></i></button></div>
      </div>`;
  }

  function renderPickup() {
    const p = st.pickup;
    const { in: inList, waitlist } = splitSpots(p, st.players);
    const left = st.players.filter((x) => x.status === PLAYER_STATUS.LEFT);
    const t = totals(p, st.players);
    const open = canLeave(p);
    const stat = (label, n) => `<div class="pk-stat"><span>${esc(label)}</span><b>${esc(n)}</b></div>`;
    const draft = p.status === PICKUP_STATUS.DRAFT;
    const cancelled = p.status === PICKUP_STATUS.CANCELLED;
    box.innerHTML = `
      <button class="btn btn-sm btn-link px-0 mb-2" data-pk="list"><i class="bi bi-arrow-left me-1"></i>${esc(PK.pkBack)}</button>
      <div class="ev-card">
        <div class="d-flex justify-content-between gap-2 flex-wrap align-items-start">
          <div class="min-w-0">
            <h2 class="h5 fw-bold mb-1">${esc(p.title)} <span class="ev-chip align-middle">${esc(statusLabel(p))}</span></h2>
            <div class="small ev-muted"><i class="bi bi-calendar-event me-1"></i>${esc(fmtWhen(p.startAt))}${p.venue ? ` · <i class="bi bi-geo-alt"></i> ${esc(p.venue)}` : ""}</div>
          </div>
          <div class="d-flex gap-2 flex-wrap">
            ${draft && !locked ? `<button class="btn btn-sm tn-btn-grad" data-pk="publish"><i class="bi bi-send me-1"></i>${esc(PK.pfPublish)}</button>` : ""}
            ${!draft ? `<button class="btn btn-sm btn-light" data-pk="copy"><i class="bi bi-link-45deg me-1"></i>${esc(PK.pkCopy)}</button><a class="btn btn-sm btn-light" href="${esc(pickupUrl(p))}" target="_blank" rel="noopener"><i class="bi bi-eye"></i></a>` : ""}
            ${!cancelled ? `<button class="btn btn-sm btn-light" data-pk="add"><i class="bi bi-person-plus me-1"></i>${esc(PK.plAdd)}</button>` : ""}
            ${locked ? "" : `<button class="btn btn-sm btn-light" data-pk="edit"><i class="bi bi-pencil me-1"></i>${esc(EX.edit)}</button>`}
            <div class="dropdown">
              <button class="btn btn-sm btn-light" data-bs-toggle="dropdown" aria-label="${esc(PK.pkMore)}"><i class="bi bi-three-dots-vertical"></i></button>
              <ul class="dropdown-menu dropdown-menu-end">
                ${p.status === PICKUP_STATUS.PUBLISHED ? `<li><button class="dropdown-item" data-pk="finish">${esc(PK.pkFinish)}</button></li><li><button class="dropdown-item" data-pk="draft">${esc(PK.pkUnpublish)}</button></li>` : ""}
                ${!cancelled ? `<li><button class="dropdown-item text-danger" data-pk="cancel">${esc(PK.pkCancel)}</button></li>` : `<li><button class="dropdown-item" data-pk="draft">${esc(PK.pkReopen)}</button></li>`}
                ${draft || !st.players.length ? `<li><button class="dropdown-item text-danger" data-pk="delete">${esc(PK.pkDelete)}</button></li>` : ""}
              </ul>
            </div>
          </div>
        </div>
        <div class="pk-stats my-3">
          ${stat(PK.kIn, t.capacity ? `${t.in} / ${t.capacity}` : t.in)}
          ${stat(PK.kWait, t.waitlist)}
          ${stat(PK.kPaid, t.paid)}
          ${stat(PK.kDue, money(t.due, p))}
        </div>
        ${cancelled ? `<div class="pk-note pk-note--off">${esc(PK.pkCancelledNote)}</div>` : `<div class="pk-note ${open ? "" : "pk-note--off"}"><i class="bi bi-clock me-1"></i>${esc(open ? pkf(PK.deadlineOpen, { when: fmtWhen(p.leaveDeadlineAt) }) : PK.deadlinePassed)}</div>`}
        ${t.review ? `<div class="pk-note pk-note--review mt-2"><i class="bi bi-receipt me-1"></i>${esc(pkf(PK.reviewCount, { n: t.review }))}</div>` : ""}
        ${(() => {
          const rs = raffleState(p, st.players);
          if (rs.status === RAFFLE.OFF) return "";
          const w = rs.status === RAFFLE.DRAWN ? st.players.find((x) => x.id === rs.winnerId) : null;
          const refund = w && [PAY.APPROVED, PAY.SUBMITTED].includes(w.prevPaymentStatus) ? `<div class="pk-note mt-2"><i class="bi bi-arrow-counterclockwise me-1"></i>${esc(pkf(PK.rfRefund, { name: w.name }))}</div>` : "";
          return `<div class="mt-3">${raffleCard(rs, { pickup: p, admin: true, locked })}${refund}</div>`;
        })()}
        <div class="pk-sec mt-3">${esc(PK.secIn)} · ${inList.length}</div>
        ${inList.length ? `<div class="pa-list">${inList.map((pl, i) => playerRow(pl, SPOT.IN, i)).join("")}</div>` : `<div class="small ev-muted">${esc(PK.noPlayers)}</div>`}
        ${waitlist.length ? `<div class="pk-sec mt-3">${esc(PK.secWait)} · ${waitlist.length}</div><div class="small ev-muted mb-1">${esc(PK.secWaitHint)}</div><div class="pa-list">${waitlist.map((pl, i) => playerRow(pl, SPOT.WAITLIST, i)).join("")}</div>` : ""}
        ${left.length ? `<button class="btn btn-sm btn-link px-0 mt-3" data-pk="toggleLeft">${esc(pkf(PK.secLeft, { n: left.length }))} <i class="bi bi-chevron-${st.showLeft ? "up" : "down"}"></i></button>
          ${st.showLeft ? `<div class="small ev-muted">${left.map((x) => `${esc(x.name)} <span class="opacity-75">(${esc(fmtWhen(x.leftAt))})</span>`).join(" · ")}</div>` : ""}` : ""}
      </div>`;
  }

  const tierOptions = (p, sel = "") => (p.tiers || []).map((t) => `<option value="${esc(t.id)}" ${t.id === sel ? "selected" : ""}>${esc(t.name)} · ${esc(Number(t.price) > 0 ? money(t.price, p) : PK.payFree)}</option>`).join("");

  async function addPlayerDialog() {
    const p = st.pickup;
    let profiles = [];
    const data = await askConfirm("", {
      title: PK.plAdd,
      ok: PK.plAddOk,
      html: `
        <div class="text-start">
          <label class="form-label small fw-semibold" for="apName">${esc(PK.plName)}</label>
          <input class="form-control mb-1" id="apName" list="apProfiles" autocomplete="off" maxlength="80" />
          <datalist id="apProfiles"></datalist>
          <div class="form-text mb-2" id="apLinked">${esc(PK.plLinkHint)}</div>
          <label class="form-label small fw-semibold" for="apTier">${esc(PK.plTier)}</label>
          <select class="form-select mb-2" id="apTier">${tierOptions(p)}</select>
          <label class="d-flex align-items-center gap-2 small mb-2"><input type="checkbox" class="form-check-input m-0" id="apPaid" /> ${esc(PK.plPaidAlready)}</label>
          <select class="form-select form-select-sm" id="apMethod"><option value="cash">${esc(PK.mCash)}</option><option value="transfer">${esc(PK.mTransfer)}</option></select>
        </div>`,
      onOpen: (wrap) => {
        wrap.querySelector("#apName").focus();
        import("/tournaments/js/imports.js").then((m) => m.listAllProfiles()).then((list) => {
          profiles = list.filter((x) => x.name);
          wrap.querySelector("#apProfiles").innerHTML = profiles.map((x) => `<option value="${esc(x.name)}"></option>`).join("");
        }).catch(() => {});
        wrap.querySelector("#apName").addEventListener("input", (e) => {
          const hit = profiles.find((x) => x.name === e.target.value);
          wrap.querySelector("#apLinked").textContent = hit ? PK.plLinked : PK.plLinkHint;
        });
      },
      read: (wrap) => {
        const name = wrap.querySelector("#apName").value.trim();
        if (!name) return null;
        return {
          name,
          tierId: wrap.querySelector("#apTier").value,
          paid: wrap.querySelector("#apPaid").checked,
          method: wrap.querySelector("#apMethod").value,
          profile: profiles.find((x) => x.name === name) || null,
        };
      },
    });
    if (!data) return;
    if (data.profile && st.players.some((x) => x.id === data.profile.id && x.status === PLAYER_STATUS.ACTIVE)) return alertBox(PK.plAlready, "warning");
    await run(async () => {
      await addManualPlayer(p, data);
      await showPickup(p.id);
    }, PK.plAdded);
  }

  async function editPlayerDialog(pl) {
    const p = st.pickup;
    const payOpts = [PAY.NONE, PAY.SUBMITTED, PAY.APPROVED, PAY.REJECTED].map((s) => `<option value="${s}" ${pl.paymentStatus === s ? "selected" : ""}>${esc({ none: PK.payNone, submitted: PK.payReview, approved: PK.payApproved, rejected: PK.payRejected }[s])}</option>`).join("");
    const data = await askConfirm("", {
      title: pl.name,
      ok: PK.orgSave,
      html: `
        <div class="text-start">
          <label class="form-label small fw-semibold" for="epTier">${esc(PK.plTier)}</label>
          <select class="form-select mb-2" id="epTier">${tierOptions(p, pl.tierId)}</select>
          <label class="form-label small fw-semibold" for="epPay">${esc(PK.plPayment)}</label>
          <select class="form-select mb-2" id="epPay" ${Number(pl.price || 0) <= 0 ? "disabled" : ""}>${payOpts}</select>
          <label class="form-label small fw-semibold" for="epAtt">${esc(PK.plAttendance)}</label>
          <select class="form-select mb-3" id="epAtt">
            <option value="">—</option>
            <option value="attended" ${pl.attendance === "attended" ? "selected" : ""}>${esc(PK.attYes)}</option>
            <option value="no_show" ${pl.attendance === "no_show" ? "selected" : ""}>${esc(PK.attNo)}</option>
          </select>
          <label class="d-flex align-items-center gap-2 small text-danger"><input type="checkbox" class="form-check-input m-0" id="epRemove" /> ${esc(PK.plRemove)}</label>
        </div>`,
      read: (wrap) => ({
        tierId: wrap.querySelector("#epTier").value,
        pay: wrap.querySelector("#epPay").value,
        attendance: wrap.querySelector("#epAtt").value || null,
        remove: wrap.querySelector("#epRemove").checked,
      }),
    });
    if (!data) return;
    await run(async () => {
      if (data.remove) {
        await removePlayer(p.id, pl.id);
      } else {
        if (data.tierId !== pl.tierId) await setPlayerTier(p, pl.id, data.tierId, pl);
        const patch = { attendance: data.attendance };
        if (Number(pl.price || 0) > 0 && data.pay !== pl.paymentStatus && data.tierId === pl.tierId) patch.paymentStatus = data.pay;
        await updatePlayer(p.id, pl.id, patch);
      }
      await showPickup(p.id);
    }, PK.orgSaved);
  }

  async function proofDialog(pl) {
    const p = st.pickup;
    const proof = await loadProof(p.id, pl.id);
    const ok = await askConfirm("", {
      title: pkf(PK.proofTitle, { name: pl.name }),
      ok: PK.proofApprove,
      cancel: EX.close || "Cerrar",
      html: `<div class="text-center">${proof?.image ? `<img src="${esc(proof.image)}" alt="" class="img-fluid rounded mb-2" style="max-height:60vh" />` : `<div class="small ev-muted">${esc(PK.proofMissing)}</div>`}
        <div class="small ev-muted">${esc(pl.tierName)} · ${esc(money(pl.price, p))}</div>
        <button type="button" class="btn btn-sm btn-outline-danger mt-2" id="prReject">${esc(PK.proofReject)}</button></div>`,
      onOpen: (wrap) => wrap.querySelector("#prReject").addEventListener("click", () => {
        wrap.remove();
        run(async () => {
          await setPayment(p.id, pl.id, PAY.REJECTED);
          await showPickup(p.id);
        }, PK.proofRejected);
      }),
    });
    if (!ok) return;
    await run(async () => {
      await setPayment(p.id, pl.id, PAY.APPROVED, "transfer");
      await showPickup(p.id);
    }, PK.proofApproved);
  }

  /* ----- eventos ----- */
  box.addEventListener("click", async (ev) => {
    const open = ev.target.closest("[data-open]");
    if (open) {
      ev.preventDefault();
      return run(() => showPickup(open.dataset.open));
    }
    const pk = ev.target.closest("[data-pk]")?.dataset.pk;
    const p = st.pickup;
    if (pk === "new") return showForm(null);
    if (pk === "list") return run(showList);
    if (pk === "open") return run(() => showPickup(ev.target.closest("[data-pk]").dataset.id));
    if (pk === "edit") return showForm(p);
    if (pk === "toggleLeft") {
      st.showLeft = !st.showLeft;
      return renderPickup();
    }
    if (pk === "save") {
      const data = readForm();
      if (!data.title) return alertBox(PK.pfTitleMissing, "warning");
      if (!data.startAt) return alertBox(PK.pfDayMissing, "warning");
      if (!data.tiers.length) return alertBox(PK.setNoTiers, "warning");
      const publish = !!ev.target.closest("[data-publish]");
      return run(async () => {
        const id = await savePickup(st.form?.id || "", data, org);
        if (publish) await setPickupStatus(id, PICKUP_STATUS.PUBLISHED);
        await showPickup(id);
        if (publish) await copyLink();
      }, publish ? PK.pkPublished : PK.orgSaved);
    }
    if (pk === "publish") return run(async () => { await setPickupStatus(p.id, PICKUP_STATUS.PUBLISHED); await showPickup(p.id); await copyLink(); }, PK.pkPublished);
    if (pk === "copy") return copyLink();
    const rf = ev.target.closest("[data-raffle]")?.dataset.raffle;
    if (rf === "replay") {
      const r = p.raffle || {};
      const names = (r.pool || []).map((x) => x.name || "—");
      const i = (r.pool || []).findIndex((x) => x.id === r.winnerId);
      if (i >= 0) await playRaffle(names, i);
      return;
    }
    if (rf === "draw") {
      const rs = raffleState(p, st.players);
      if (rs.status !== RAFFLE.READY) return renderPickup();
      if (!(await askConfirm(pkf(PK.rfDrawConfirm, { n: rs.count }), { ok: PK.rfDraw }))) return;
      const winner = pickWinner(rs.pool);
      if (!winner) return;
      let saved = false;
      // primero se guarda (el ganador no cambia aunque se recargue), después se anima
      await run(async () => { await saveRaffle(p, rs.pool, winner); saved = true; });
      if (!saved) return;
      await playRaffle(rs.pool.map((x) => x.name || "—"), rs.pool.indexOf(winner));
      return run(() => showPickup(p.id), pkf(PK.rfDone, { name: winner.name }));
    }
    if (pk === "add") return addPlayerDialog();
    if (pk === "finish") return run(async () => { await setPickupStatus(p.id, PICKUP_STATUS.FINISHED); await showPickup(p.id); }, PK.orgSaved);
    if (pk === "draft") return run(async () => { await setPickupStatus(p.id, PICKUP_STATUS.DRAFT); await showPickup(p.id); }, PK.orgSaved);
    if (pk === "cancel") {
      if (!(await askConfirm(PK.pkCancelConfirm, { ok: PK.pkCancel, danger: true }))) return;
      return run(async () => { await setPickupStatus(p.id, PICKUP_STATUS.CANCELLED); await showPickup(p.id); }, PK.orgSaved);
    }
    if (pk === "delete") {
      if (!(await askConfirm(PK.pkDeleteConfirm, { ok: PK.pkDelete, danger: true }))) return;
      return run(async () => { await deletePickup(p.id); await showList(); });
    }
    const plAct = ev.target.closest("[data-pl-act]")?.dataset.plAct;
    if (!plAct) return;
    const pl = st.players.find((x) => x.id === ev.target.closest("[data-pl]").dataset.pl);
    if (!pl) return;
    if (plAct === "edit") return editPlayerDialog(pl);
    if (plAct === "proof") return proofDialog(pl);
    if (plAct === "paid") {
      const method = await askConfirm(pkf(PK.paidConfirm, { name: pl.name, amount: money(pl.price, p) }), {
        ok: PK.plMarkPaid,
        html: `<select class="form-select mt-2" id="pmMethod"><option value="cash">${esc(PK.mCash)}</option><option value="transfer">${esc(PK.mTransfer)}</option></select>`,
        read: (wrap) => wrap.querySelector("#pmMethod").value,
      });
      if (!method) return;
      return run(async () => { await setPayment(p.id, pl.id, PAY.APPROVED, method); await showPickup(p.id); }, PK.orgSaved);
    }
    if (plAct === "promote") {
      // sube sin sacar a nadie: el cupo crece en 1
      if (!(await askConfirm(pkf(PK.promoteConfirm, { name: pl.name, n: Number(p.capacity || 0) + 1 }), { ok: PK.plPromote }))) return;
      return run(async () => { await setPickupCapacity(p.id, Number(p.capacity || 0) + 1); await showPickup(p.id); }, PK.orgSaved);
    }
  });

  async function copyLink() {
    const url = pickupAbsUrl(st.pickup);
    try {
      await navigator.clipboard.writeText(url);
      alertBox(PK.pkCopied);
    } catch {
      await askConfirm(url, { title: PK.pkCopy, cancel: false });
    }
  }

  run(() => (ctx.pickupId ? showPickup(ctx.pickupId) : showList()));
}
