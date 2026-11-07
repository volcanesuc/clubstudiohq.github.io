// /tournaments/js/pickup_page.js
// /pickups/pickup.html?s=slug: página pública de un pickup.
// El jugador se anota con Google (y puede anotar amigos sin cuenta), sube el comprobante cuando quiera
// y se puede salir hasta la hora límite. Confirmado o en espera sale del orden de llegada (pickups.js).
import { EX, LOCALE } from "/tournaments/js/strings.js";
import { PK, pkf } from "/tournaments/js/pickups_strings.js";
import { countryName, flagOf } from "/tournaments/js/countries.js";
import { isPlatformAdmin } from "/tournaments/js/services.js";
import { loadProfile } from "/tournaments/js/squads.js";
import { isOrgAdmin, loadOrg } from "/tournaments/js/orgs.js";
import {
  PAY,
  PICKUP_STATUS,
  PLAYER_STATUS,
  RAFFLE,
  SPOT,
  canLeave,
  fmtMoney,
  hasStarted,
  isFull,
  isJoinOpen,
  owes,
  raffleState,
  splitSpots,
  spotOf,
} from "/tournaments/js/pickups.js";
import { playRaffle, raffleCard } from "/tournaments/js/pickups_raffle.js";
import { joinPickup, leavePickup, listPlayers, loadPickupBySlug, pickupAbsUrl, submitProof } from "/tournaments/js/pickups_services.js";
import { payChip, statusLabel } from "/tournaments/js/pickups_manage.js";
import {
  askConfirm,
  avatarHtml,
  esc,
  fmtWhen,
  hideLoader,
  isGoogleUser,
  renderNav,
  showLoader,
  shrinkImage,
  signInGoogle,
  teamBadge,
  waitForUser,
} from "/tournaments/js/ui.js";

const root = document.getElementById("tnRoot");
const params = new URLSearchParams(location.search);
const state = {
  user: null,
  profile: null,
  pickup: null,
  players: [],
  canManage: false,
  friends: [], // borrador del formulario: [{ name, tierId }]
  addingFriends: false,
};

const money = (v) => fmtMoney(v, state.pickup?.currency || "USD", LOCALE);
const priceLabel = (t) => (Number(t.price || 0) > 0 ? money(t.price) : PK.payFree);

function alertBox(msg, kind = "success") {
  const el = document.getElementById("tnAlert");
  el.className = `alert alert-${kind}`;
  el.textContent = msg;
  el.classList.toggle("d-none", !msg);
  if (msg && kind === "success") setTimeout(() => el.classList.add("d-none"), 2800);
}

async function run(fn, okMsg = "") {
  showLoader();
  try {
    await fn();
    if (okMsg) alertBox(okMsg);
  } catch (err) {
    console.error("[pickup]", err);
    alertBox(`${EX.error} ${err?.code || err?.message || ""}`, "danger");
  } finally {
    hideLoader();
  }
}

async function reload() {
  state.players = await listPlayers(state.pickup.id);
  render();
}

const me = () => (state.user ? state.players.find((x) => x.id === state.user.uid) || null : null);
const myFriends = () => (state.user ? state.players.filter((x) => x.source === "friend" && x.addedBy === state.user.uid && x.status === PLAYER_STATUS.ACTIVE) : []);

/* =========================
   Partes de la página
========================= */
function hero(p) {
  const place = [p.venue, p.city, p.country ? `${flagOf(p.country)} ${countryName(p.country)}` : ""].filter(Boolean).join(" · ");
  const when = [fmtWhen(p.startAt, { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }), p.endAt ? fmtWhen(p.endAt, { hour: "2-digit", minute: "2-digit" }) : ""].filter(Boolean).join(" – ");
  return `
    <section class="ev-hero mb-3">
      <div class="d-flex align-items-center gap-2 mb-2">
        ${teamBadge({ id: p.orgId, name: p.orgName, logo: p.orgLogo, color: p.orgColor }, 32)}
        <span class="small fw-semibold">${esc(p.orgName || "")}</span>
        <span class="pk-hero-chip ms-1">${esc(statusLabel(p))}</span>
      </div>
      <h1>${esc(p.title || "Pickup")}</h1>
      <div class="ev-hero__meta"><i class="bi bi-calendar-event me-1"></i>${esc(when)}</div>
      ${place ? `<div class="ev-hero__meta"><i class="bi bi-geo-alt me-1"></i>${esc(place)}</div>` : ""}
      <div class="d-flex gap-2 flex-wrap mt-3">
        <button class="btn btn-sm btn-light" data-act="share"><i class="bi bi-link-45deg me-1"></i>${esc(PK.pkCopy)}</button>
        ${state.canManage ? `<a class="btn btn-sm btn-light" href="/pickups/organize.html?org=${esc(p.orgId)}&tab=pickups&p=${esc(p.id)}"><i class="bi bi-gear me-1"></i>${esc(PK.pgManage)}</a>` : ""}
      </div>
    </section>`;
}

function spotsCard(p) {
  const { in: inList, waitlist } = splitSpots(p, state.players);
  const cap = Number(p.capacity || 0);
  const pct = cap ? Math.min(100, Math.round((inList.length / cap) * 100)) : 100;
  return `
    <div class="ev-card mb-3">
      <div class="d-flex justify-content-between align-items-baseline flex-wrap gap-2 mb-2">
        <span class="fw-bold">${esc(cap ? pkf(PK.pgSpots, { in: inList.length, cap }) : pkf(PK.pgSpotsNoCap, { in: inList.length }))}</span>
        ${waitlist.length ? `<span class="small ev-muted">${esc(pkf(PK.pgWaitN, { n: waitlist.length }))}</span>` : ""}
      </div>
      ${cap ? `<div class="pk-bar mb-3"><i style="width:${pct}%"></i></div>` : ""}
      ${(p.tiers || []).length ? `
        <div class="small fw-semibold mb-1">${esc(PK.pgPrices)}</div>
        <div class="d-flex flex-wrap gap-2 mb-2">${p.tiers.map((t) => `<span class="ev-chip">${esc(t.name)} · ${esc(priceLabel(t))}</span>`).join("")}</div>` : ""}
      ${p.payInfo ? `<div class="small fw-semibold mt-2 mb-1">${esc(PK.pgHowPay)}</div><div class="small" style="white-space:pre-line">${esc(p.payInfo)}</div>` : ""}
    </div>`;
}

function tierSelect(id, value) {
  const tiers = state.pickup.tiers || [];
  return `<select class="form-select" id="${id}">${tiers.map((t) => `<option value="${esc(t.id)}" ${t.id === value ? "selected" : ""}>${esc(t.name)} · ${esc(priceLabel(t))}</option>`).join("")}</select>`;
}

function friendRows() {
  return state.friends.map((f, i) => `
    <div class="d-flex gap-2 mb-2" data-friend="${i}">
      <input class="form-control" data-fr-name="${i}" value="${esc(f.name)}" placeholder="${esc(PK.pgFriendName)}" maxlength="80" />
      ${(state.pickup.tiers || []).length > 1 ? `<div style="max-width:12rem">${tierSelect(`frTier${i}`, f.tierId).replace("<select", `<select data-fr-tier="${i}"`)}</div>` : ""}
      <button class="btn btn-light flex-shrink-0" data-fr-del="${i}" aria-label="${esc(PK.plRemove)}"><i class="bi bi-x-lg"></i></button>
    </div>`).join("");
}

function friendsEditor() {
  return `
    <div class="mt-3">
      <div id="pgFriends">${friendRows()}</div>
      <button class="btn btn-sm btn-light" data-act="add-friend"><i class="bi bi-person-plus me-1"></i>${esc(PK.pgAddFriend)}</button>
      <div class="form-text">${esc(PK.pgFriendHint)}</div>
    </div>`;
}

const ruleText = (p) => pkf(PK.pgRule, { when: fmtWhen(p.leaveDeadlineAt || p.startAt) });

function joinCard(p) {
  const open = isJoinOpen(p);
  if (!open) return "";
  if (!state.user) {
    return `
      <div class="ev-card mb-3 text-center">
        <p class="mb-2">${esc(PK.pgSignIn)}</p>
        <button class="btn tn-btn-grad" data-act="login"><i class="bi bi-google me-1"></i>${esc(EX.signIn)}</button>
        <div class="small ev-muted mt-2">${esc(ruleText(p))}</div>
      </div>`;
  }
  const mine = me();
  const full = isFull(p, state.players);
  if (mine && mine.status === PLAYER_STATUS.ACTIVE) {
    // ya estoy: puedo anotar más amigos
    if (!state.addingFriends) return "";
    return `
      <div class="ev-card mb-3">
        <h2 class="h6 fw-bold mb-1">${esc(PK.pgAddFriends)}</h2>
        ${full ? `<div class="pk-note pk-note--review small mb-2">${esc(PK.pgFullNote)}</div>` : ""}
        ${friendsEditor()}
        <div class="d-flex justify-content-end gap-2 mt-3">
          <button class="btn btn-light" data-act="cancel-friends">${esc(EX.cancel)}</button>
          <button class="btn tn-btn-grad" data-act="join-friends">${esc(PK.pgJoin)}</button>
        </div>
      </div>`;
  }
  const tierId = mine?.tierId || p.tiers?.[0]?.id || "";
  return `
    <div class="ev-card mb-3">
      <h2 class="h6 fw-bold mb-2">${esc(PK.pgJoinTitle)}</h2>
      <div class="d-flex align-items-center gap-2 mb-3">
        ${avatarHtml({ name: state.profile?.name || state.user.displayName, photoURL: state.profile?.photoURL || state.user.photoURL }, 36)}
        <span class="fw-semibold">${esc(state.profile?.name || state.user.displayName || "")}</span>
      </div>
      ${(p.tiers || []).length ? `<label class="form-label small fw-semibold" for="pgTier">${esc(PK.pgTier)}</label>${tierSelect("pgTier", tierId)}` : ""}
      ${friendsEditor()}
      ${full ? `<div class="pk-note pk-note--review small mt-3">${esc(PK.pgFullNote)}</div>` : ""}
      <div class="small ev-muted mt-3">${esc(ruleText(p))}</div>
      <div class="d-grid mt-3">
        <button class="btn tn-btn-grad" data-act="join">${esc(mine ? PK.pgRejoin : full ? PK.pgJoinWait : PK.pgJoin)}</button>
      </div>
    </div>`;
}

// Estado de un jugador mío (yo o un amigo): cupo, pago, comprobante y salirse
function myRow(p, pl, isMe) {
  const spot = spotOf(p, state.players, pl.id);
  const wait = splitSpots(p, state.players).waitlist.findIndex((x) => x.id === pl.id) + 1;
  const late = owes(p, pl, spot);
  const priced = Number(pl.price || 0) > 0;
  const canUpload = priced && [PAY.NONE, PAY.REJECTED].includes(pl.paymentStatus) && p.status !== PICKUP_STATUS.CANCELLED;
  const leave = canLeave(p) && p.status === PICKUP_STATUS.PUBLISHED;
  const title = isMe ? (spot === SPOT.IN ? PK.pgIn : pkf(PK.pgWait, { n: wait })) : pl.name;
  return `
    <div class="pk-me ${spot === SPOT.WAITLIST ? "pk-me--wait" : ""} mb-2">
      <div class="d-flex align-items-center gap-2 flex-wrap">
        <i class="bi ${spot === SPOT.IN ? "bi-check-circle-fill" : "bi-hourglass-split"}"></i>
        <span class="fw-bold flex-grow-1">${esc(title)}${!isMe && spot === SPOT.WAITLIST ? ` <span class="small fw-normal">· ${esc(PK.spotWait)} #${wait}</span>` : ""}</span>
        ${payChip(pl, p, spot)}
      </div>
      <div class="small mt-1">${esc(pl.tierName || "")}${priced ? ` · ${esc(money(pl.price))}` : ""}${isMe && spot === SPOT.WAITLIST ? ` · ${esc(PK.pgWaitHint)}` : ""}</div>
      ${late ? `<div class="small fw-bold mt-1">${esc(pkf(PK.pgOwe, { amount: money(pl.price) }))}</div>` : ""}
      <div class="d-flex gap-2 flex-wrap mt-2">
        ${canUpload ? `<label class="btn btn-sm btn-light mb-0"><i class="bi bi-upload me-1"></i>${esc(pl.paymentStatus === PAY.REJECTED ? PK.pgUploadAgain : PK.pgUpload)}<input type="file" accept="image/*" class="d-none" data-proof="${esc(pl.id)}" /></label>` : ""}
        ${leave ? `<button class="btn btn-sm btn-light" data-leave="${esc(pl.id)}"><i class="bi bi-box-arrow-right me-1"></i>${esc(isMe ? PK.pgLeave : PK.plRemove)}</button>` : ""}
      </div>
    </div>`;
}

function myCard(p) {
  if (!state.user) return "";
  const mine = me();
  const friends = myFriends();
  const active = mine && mine.status === PLAYER_STATUS.ACTIVE;
  if (!active && !friends.length) return "";
  const leaveNote = canLeave(p) ? pkf(PK.pgLeaveUntil, { when: fmtWhen(p.leaveDeadlineAt || p.startAt) }) : PK.pgNoLeave;
  return `
    <div class="mb-3">
      ${active ? myRow(p, mine, true) : ""}
      ${friends.length ? `<div class="small fw-semibold mt-3 mb-1">${esc(PK.pgMyFriends)}</div>${friends.map((f) => myRow(p, f, false)).join("")}` : ""}
      ${p.status === PICKUP_STATUS.PUBLISHED ? `<div class="small ev-muted mt-2"><i class="bi bi-clock me-1"></i>${esc(leaveNote)}</div>` : ""}
      ${active && isJoinOpen(p) && !state.addingFriends ? `<button class="btn btn-sm btn-light mt-2" data-act="more-friends"><i class="bi bi-person-plus me-1"></i>${esc(friends.length ? PK.pgMoreFriends : PK.pgAddFriends)}</button>` : ""}
    </div>`;
}

function whoCard(p) {
  const { in: inList, waitlist } = splitSpots(p, state.players);
  const row = (pl, n) => `
    <div class="pa-row pk-player">
      ${n ? `<span class="pk-num">${n}</span>` : avatarHtml(pl, 32)}
      <div class="flex-grow-1 min-w-0"><div class="fw-semibold text-truncate">${esc(pl.name || "—")}</div></div>
      ${pl.raffleWinner ? `<span class="ev-chip pk-pay-free"><i class="bi bi-ticket-perforated-fill me-1"></i>${esc(PK.rfChip)}</span>` : ""}
      ${state.user && pl.id === state.user.uid ? `<span class="ev-chip">${esc(PK.pgYou)}</span>` : ""}
    </div>`;
  return `
    <div class="ev-card mb-3">
      <h2 class="h6 fw-bold mb-2">${esc(PK.pgWho)} <span class="ev-muted fw-normal">· ${inList.length}</span></h2>
      ${inList.length ? `<div class="pa-list">${inList.map((pl) => row(pl)).join("")}</div>` : `<div class="small ev-muted">${esc(PK.pgNobody)}</div>`}
      ${waitlist.length ? `
        <div class="pk-sec mt-3">${esc(PK.secWait)} · ${waitlist.length}</div>
        <div class="pa-list">${waitlist.map((pl, i) => row(pl, i + 1)).join("")}</div>` : ""}
    </div>`;
}

function statusNote(p) {
  if (p.status === PICKUP_STATUS.DRAFT) return `<div class="pk-note pk-note--review mb-3">${esc(PK.pgDraftNote)}</div>`;
  if (p.status === PICKUP_STATUS.CANCELLED) return `<div class="pk-note pk-note--off mb-3">${esc(PK.pkCancelledNote)}</div>`;
  if (p.status === PICKUP_STATUS.FINISHED || hasStarted(p)) return `<div class="pk-note pk-note--off mb-3">${esc(PK.pgFinishedNote)}</div>`;
  return "";
}

function render() {
  const p = state.pickup;
  root.innerHTML = `
    ${hero(p)}
    ${statusNote(p)}
    <div class="row g-3">
      <div class="col-12 col-lg-7 order-2 order-lg-1">${whoCard(p)}</div>
      <div class="col-12 col-lg-5 order-1 order-lg-2">
        ${raffleCard(raffleState(p, state.players), { pickup: p, admin: state.canManage, meId: state.user?.uid || "" })}
        ${myCard(p)}
        ${joinCard(p)}
        ${spotsCard(p)}
      </div>
    </div>`;
}

function renderMissing() {
  root.innerHTML = `
    <div class="ev-card text-center py-5 mt-3" style="max-width:520px;margin:auto">
      <div class="display-6 mb-2"><i class="bi bi-question-circle"></i></div>
      <p class="ev-muted">${esc(PK.pgNotFound)}</p>
      <a class="btn tn-btn-grad" href="/pickups/">${esc(PK.pgBackDir)}</a>
    </div>`;
}

/* =========================
   Acciones
========================= */
const readFriends = () => state.friends.map((f) => ({ name: String(f.name || "").trim(), tierId: f.tierId })).filter((f) => f.name);

root.addEventListener("input", (ev) => {
  const i = ev.target.dataset.frName;
  if (i != null) state.friends[i].name = ev.target.value;
});

root.addEventListener("change", async (ev) => {
  const t = ev.target;
  if (t.dataset.frTier != null) state.friends[t.dataset.frTier].tierId = t.value;
  const plid = t.dataset.proof;
  if (plid && t.files?.[0]) {
    const file = t.files[0];
    await run(async () => {
      const image = await shrinkImage(file, 1100);
      await submitProof(state.pickup.id, plid, image);
      await reload();
    }, PK.pgUploaded);
  }
});

root.addEventListener("click", async (ev) => {
  const btn = ev.target.closest("button");
  if (!btn) return;
  const p = state.pickup;
  const act = btn.dataset.act;

  // rifa: volver a ver el sorteo (el ganador ya está guardado). Sortear se hace desde Organizar.
  if (btn.dataset.raffle === "replay") {
    const r = p.raffle || {};
    const i = (r.pool || []).findIndex((x) => x.id === r.winnerId);
    if (i >= 0) await playRaffle(r.pool.map((x) => x.name || "—"), i);
    return;
  }
  if (btn.dataset.raffle === "draw") {
    location.href = `/pickups/organize.html?org=${encodeURIComponent(p.orgId)}&tab=pickups&p=${encodeURIComponent(p.id)}`;
    return;
  }

  if (btn.dataset.frDel != null) {
    state.friends.splice(Number(btn.dataset.frDel), 1);
    return render();
  }
  if (btn.dataset.leave) {
    const id = btn.dataset.leave;
    const pl = state.players.find((x) => x.id === id);
    const isMe = id === state.user?.uid;
    const ok = await askConfirm(isMe ? PK.pgLeaveConfirm : pkf(PK.pgLeaveFriendConfirm, { name: pl?.name || "" }), { danger: true, ok: PK.pgLeave });
    if (!ok) return;
    return run(async () => {
      await leavePickup(p.id, id);
      await reload();
    }, isMe ? PK.pgLeft : "");
  }

  if (act === "share") {
    try {
      await navigator.clipboard.writeText(pickupAbsUrl(p));
      alertBox(PK.pkCopied);
    } catch {
      prompt(PK.pkCopy, pickupAbsUrl(p));
    }
  } else if (act === "login") {
    try {
      await signInGoogle();
      location.reload();
    } catch (err) {
      alertBox(`${EX.error} ${err?.code || ""}`, "danger");
    }
  } else if (act === "add-friend") {
    state.friends.push({ name: "", tierId: p.tiers?.[0]?.id || "" });
    render();
    root.querySelector(`[data-fr-name="${state.friends.length - 1}"]`)?.focus();
  } else if (act === "more-friends") {
    state.addingFriends = true;
    if (!state.friends.length) state.friends.push({ name: "", tierId: p.tiers?.[0]?.id || "" });
    render();
    root.querySelector('[data-fr-name="0"]')?.focus();
  } else if (act === "cancel-friends") {
    state.addingFriends = false;
    state.friends = [];
    render();
  } else if (act === "join" || act === "join-friends") {
    const friends = readFriends();
    const mine = me();
    const self = act === "join"
      ? {
          name: state.profile?.name || state.user.displayName || "",
          number: state.profile?.number ?? null,
          gender: state.profile?.gender || "",
          photoURL: state.profile?.photoURL || state.user.photoURL || "",
          tierId: root.querySelector("#pgTier")?.value || p.tiers?.[0]?.id || "",
        }
      : null;
    if (!self && !friends.length) return alertBox(PK.pgFriendName, "warning");
    await run(async () => {
      await joinPickup(state.user, p, self, friends, mine);
      state.friends = [];
      state.addingFriends = false;
      await reload();
    }, self ? PK.pgJoined : PK.pgFriendsAdded);
  }
});

/* =========================
   Inicio
========================= */
(async function init() {
  showLoader();
  try {
    const user = await waitForUser();
    state.user = isGoogleUser(user) ? user : null;
    const platformAdmin = !!state.user && (await isPlatformAdmin(state.user.uid).catch(() => false));
    renderNav({ active: "pickups", user, isAdmin: platformAdmin });
    state.pickup = await loadPickupBySlug(params.get("s") || params.get("id"));
    if (!state.pickup) return renderMissing();
    document.title = `${state.pickup.title || "Pickup"} · ClubStudioHQ`;
    const [players, profile, org] = await Promise.all([
      listPlayers(state.pickup.id),
      state.user ? loadProfile(state.user.uid).catch(() => null) : null,
      state.user ? loadOrg(state.pickup.orgId).catch(() => null) : null,
    ]);
    state.players = players;
    state.profile = profile;
    state.canManage = platformAdmin || (!!org && isOrgAdmin(org, state.user?.uid));
    render();
  } catch (err) {
    console.error("[pickup]", err);
    alertBox(`${EX.error} ${err?.code || err?.message || ""}`, "danger");
  } finally {
    hideLoader();
  }
})();
