// /torneos/js/profile.js
// Perfil del jugador (?u=UID, o el propio). Foto, número, F/M, equipos (con rol) e historial de
// estadísticas en todos los torneos y partidos. El dueño del perfil lo edita.
import { EX, exf } from "/torneos/js/strings.js";
import { isPlatformAdmin } from "/torneos/js/services.js";
import { cropFromInput } from "/torneos/js/cropper.js";
import { ensureProfile, isSquadAdmin, loadProfile, loadSquad, pendingSpirit, playerHistory, profileUrl, saveProfile, squadUrl } from "/torneos/js/squads.js";
import {
  avatarHtml,
  esc,
  eventUrl,
  fmtDateRange,
  fmtWhen,
  gameUrl,
  hideLoader,
  isGoogleUser,
  renderNav,
  showLoader,
  signInGoogle,
  spiritPendingHtml,
  teamBadge,
  waitForUser,
} from "/torneos/js/ui.js";

const root = document.getElementById("tnRoot");
const $ = (sel) => root.querySelector(sel);
const PARAM_UID = new URLSearchParams(location.search).get("u") || "";

const state = { user: null, uid: "", profile: null, squads: [], history: null, own: false, editing: false, spirit: [] };

function alertBox(msg, kind = "success") {
  const el = document.getElementById("tnAlert");
  el.className = `alert alert-${kind}`;
  el.textContent = msg;
  el.classList.toggle("d-none", !msg);
  if (msg && kind === "success") setTimeout(() => el.classList.add("d-none"), 2500);
}

async function run(fn) {
  showLoader();
  try {
    await fn();
  } catch (err) {
    console.error(err);
    alertBox(`${EX.error} ${err?.code || err?.message || ""}`, "danger");
  } finally {
    hideLoader();
  }
}

const hasNumber = (p) => p.number !== null && p.number !== undefined && p.number !== "";
const tile = (n, label, accent = false) => `
  <div class="col-4">
    <div class="tn-stat-tile ${accent ? "tn-stat-tile--accent" : ""}"><div class="tn-stat-tile__n">${esc(n)}</div><div class="tn-stat-tile__l">${esc(label)}</div></div>
  </div>`;

/* =========================
   Secciones
========================= */
function banner() {
  const p = state.profile;
  const avatar = state.own
    ? `<label class="tn-photo-pick" for="pfPhoto" title="${esc(EX.pfPhotoTap)}">
        ${avatarHtml(p, 112)}
        <span class="tn-photo-pick__badge"><i class="bi bi-camera-fill"></i></span>
        <input type="file" accept="image/*" id="pfPhoto" hidden />
      </label>`
    : avatarHtml(p, 112);
  return `
    <section class="tn-banner">
      <div class="tn-banner__top"></div>
      <div class="tn-banner__body">
        <div class="d-flex align-items-end justify-content-between flex-wrap gap-2">
          ${avatar}
          <div class="d-flex gap-2 mb-1">
            <button class="btn btn-sm btn-light" id="pfShare"><i class="bi bi-share me-1"></i>${esc(EX.pfShare)}</button>
            ${state.own ? `<button class="btn btn-sm btn-primary" id="pfEditToggle"><i class="bi bi-pencil me-1"></i>${esc(EX.pfEdit)}</button>` : ""}
          </div>
        </div>
        <h1 class="h3 fw-bold mt-2 mb-1">${esc(p.name || EX.sqUnnamed)}${hasNumber(p) ? ` <span class="ev-muted">#${esc(p.number)}</span>` : ""}</h1>
        <div class="d-flex flex-wrap gap-2 align-items-center">
          ${p.gender ? `<span class="ev-chip">${esc(p.gender)}</span>` : ""}
          ${state.squads.map((s) => `<a class="d-inline-flex align-items-center gap-1 text-decoration-none small fw-semibold" href="${esc(squadUrl(s.id))}">${teamBadge(s, 22)} ${esc(s.name)}</a>`).join("")}
        </div>
        ${state.own && p.photoURL ? `<button class="btn btn-sm btn-link text-danger p-0 mt-2" id="pfPhotoDel">${esc(EX.pfPhotoRemove)}</button>` : ""}
      </div>
    </section>`;
}

function editForm() {
  if (!state.own || !state.editing) return "";
  const p = state.profile;
  return `
    <form id="pfForm" class="ev-card row g-3 m-0">
      <h2 class="h6 fw-bold col-12 mb-0">${esc(EX.pfEdit)}</h2>
      <div class="col-12 col-md-6"><label class="form-label small" for="pfName">${esc(EX.pfName)}</label><input class="form-control" id="pfName" value="${esc(p.name || "")}" required /></div>
      <div class="col-6 col-md-3"><label class="form-label small" for="pfNumber">${esc(EX.playerNumber)}</label><input class="form-control" id="pfNumber" type="number" min="0" max="999" value="${esc(p.number ?? "")}" /></div>
      <div class="col-6 col-md-3">
        <label class="form-label small" for="pfGender">${esc(EX.pfGender)}</label>
        <select class="form-select" id="pfGender"><option value="">—</option><option ${p.gender === "F" ? "selected" : ""}>F</option><option ${p.gender === "M" ? "selected" : ""}>M</option></select>
      </div>
      <div class="col-12 d-flex justify-content-between align-items-center flex-wrap gap-2">
        <div class="form-text m-0">${esc(EX.pfSyncHint)}</div>
        <div class="d-flex gap-2">
          <button class="btn btn-light" type="button" id="pfCancel">${esc(EX.cancel)}</button>
          <button class="btn btn-primary" type="submit">${esc(EX.save)}</button>
        </div>
      </div>
    </form>`;
}

function teamsSection() {
  return `
    <section class="ev-card">
      <h2 class="h6 fw-bold mb-3">${esc(state.own ? EX.pfMyTeams : EX.pfTeams)}</h2>
      ${state.squads.length ? `<div class="row g-2">${state.squads.map((s) => `
        <div class="col-12 col-md-6 col-lg-12">
          <a class="tn-team-tile" href="${esc(squadUrl(s.id))}">
            ${teamBadge(s, 44)}
            <div class="flex-grow-1 min-w-0">
              <div class="fw-bold text-truncate">${esc(s.name)}</div>
              <div class="small ev-muted text-truncate">${esc(s.city || "")}</div>
            </div>
            <span class="ev-chip ${isSquadAdmin(s, state.uid) ? "ev-chip--ok" : ""}">${esc(isSquadAdmin(s, state.uid) ? EX.pfRoleAdmin : EX.pfRolePlayer)}</span>
          </a>
        </div>`).join("")}</div>` : `<div class="ev-muted small">${esc(EX.pfNoTeams)}</div>`}
    </section>`;
}

function statsSection() {
  const h = state.history;
  if (!h) return `<section class="ev-card ev-muted small"><span class="spinner-border spinner-border-sm me-2"></span>${esc(EX.pfLoadingHistory)}</section>`;
  const t = h.totals;
  const per = (n) => (t.games ? (n / t.games).toFixed(1) : "0");
  // mejor partido: más goles + asistencias
  let best = null;
  h.rows.forEach((r) => r.gameRows.forEach((gr) => {
    const v = (gr.stats.goals || 0) + (gr.stats.assists || 0);
    if (v > 0 && (!best || v > best.v)) best = { v, gr, row: r };
  }));
  const bestOpp = best ? (best.gr.side === "A" ? best.gr.game.teamB : best.gr.game.teamA) : null;
  return `
    <section class="ev-card">
      <div class="d-flex justify-content-between align-items-end flex-wrap gap-2 mb-3">
        <h2 class="h6 fw-bold mb-0">${esc(EX.pfStats)}</h2>
        ${t.games ? `<span class="small ev-muted">${esc(exf(EX.pfPerGame, { g: per(t.goals), a: per(t.assists) }))}</span>` : ""}
      </div>
      <div class="row g-2">
        ${tile(t.tournaments, EX.pfTournaments)}
        ${tile(t.games, EX.pfGames)}
        ${tile(t.goals, EX.pfGoals, true)}
        ${tile(t.assists, EX.pfAssists, true)}
        ${tile(t.blocks, EX.pfBlocks)}
        ${tile(t.callahans, EX.pfCallahans)}
      </div>
      ${best ? `
        <div class="mt-3 small">
          <span class="ev-chip ev-chip--ok me-1"><i class="bi bi-star-fill me-1"></i>${esc(EX.pfBestGame)}</span>
          <a class="text-decoration-none" href="${esc(gameUrl(best.row.event.id, best.gr.game.id))}">${esc(exf(EX.pfBestGameText, { g: best.gr.stats.goals || 0, a: best.gr.stats.assists || 0, team: bestOpp?.name || "—" }))}</a>
          <span class="ev-muted"> · ${esc(best.row.event.name || "")}</span>
        </div>` : ""}
    </section>`;
}

function historySection() {
  const h = state.history;
  if (!h) return "";
  const stat = (r) => `<td class="num">${r.goals}</td><td class="num">${r.assists}</td><td class="num">${r.blocks}</td><td class="num">${r.turns}</td>`;
  return `
    <section class="ev-card">
      <h2 class="h6 fw-bold mb-2">${esc(EX.pfByTournament)}</h2>
      ${h.rows.length ? h.rows.map((r) => `
        <details class="border-bottom py-2">
          <summary class="d-flex align-items-center gap-2 flex-wrap">
            ${teamBadge(r.team, 30)}
            <div class="flex-grow-1 min-w-0">
              <a class="fw-semibold text-decoration-none" href="${esc(eventUrl(r.event))}">${esc(r.event.name || "—")}</a>
              <div class="small ev-muted">${esc([r.team.name, fmtDateRange(r.event.startDate, r.event.endDate)].filter(Boolean).join(" · "))}</div>
            </div>
            <span class="small text-nowrap"><b>${r.goals}</b> G · <b>${r.assists}</b> A · <b>${r.blocks}</b> B · ${esc(exf(EX.pfGamesN, { n: r.games }))}</span>
          </summary>
          ${r.gameRows.length ? `
          <div class="table-responsive mt-2">
            <table class="table table-sm ev-table mb-0">
              <thead><tr><th>${esc(EX.pfGame)}</th><th class="num">G</th><th class="num">A</th><th class="num">B</th><th class="num">T</th></tr></thead>
              <tbody>${r.gameRows.map(({ game: g, side, stats }) => {
                const opp = side === "A" ? g.teamB : g.teamA;
                const us = side === "A" ? g.scoreA || 0 : g.scoreB || 0;
                const them = side === "A" ? g.scoreB || 0 : g.scoreA || 0;
                const res = g.status === "final" ? (us > them ? "W" : us < them ? "L" : "E") : "";
                return `<tr>
                  <td><a class="text-decoration-none" href="${esc(gameUrl(r.event.id, g.id))}">${esc(exf(EX.pfVs, { team: opp?.name || "—" }))}</a>
                    <span class="small ev-muted">${res ? `${esc(res)} ` : ""}${us}–${them}${g.startAt ? ` · ${esc(fmtWhen(g.startAt, { day: "numeric", month: "short" }))}` : ""}</span></td>
                  ${stat({ goals: stats.goals || 0, assists: stats.assists || 0, blocks: stats.blocks || 0, turns: stats.turns || 0 })}
                </tr>`;
              }).join("")}</tbody>
            </table>
          </div>` : `<div class="small ev-muted mt-1">${esc(EX.pfNoGames)}</div>`}
        </details>`).join("") : `<div class="ev-muted small">${esc(EX.pfNoHistory)}</div>`}
    </section>`;
}

function render() {
  document.title = `${state.profile.name || EX.navProfile} · ClubStudioHQ`;
  root.innerHTML = `
    <div class="d-grid gap-3">
      ${banner()}
      ${state.own ? spiritPendingHtml(state.spirit) : ""}
      ${editForm()}
      <div class="row g-3">
        <div class="col-12 col-lg-7 d-grid gap-3 align-content-start">${statsSection()}${historySection()}</div>
        <div class="col-12 col-lg-5">${teamsSection()}</div>
      </div>
    </div>`;
  bind();
}

/* =========================
   Acciones
========================= */
function bind() {
  $("#pfShare").onclick = async () => {
    const url = `${location.origin}${profileUrl(state.uid)}`;
    try {
      await navigator.clipboard.writeText(url);
      alertBox(EX.pfLinkCopied);
    } catch {
      prompt(EX.pfShare, url);
    }
  };
  if (!state.own) return;

  $("#pfEditToggle").onclick = () => {
    state.editing = !state.editing;
    render();
    $("#pfName")?.focus();
  };
  $("#pfCancel")?.addEventListener("click", () => {
    state.editing = false;
    render();
  });

  // la foto se recorta y se guarda al momento (también en el roster de sus equipos)
  const savePhoto = (photoURL) => run(async () => {
    const p = state.profile;
    await saveProfile(state.user, { name: p.name, number: p.number, gender: p.gender, photoURL });
    state.profile.photoURL = photoURL;
    alertBox(EX.saved);
    render();
  });
  $("#pfPhoto").onchange = async (ev) => {
    try {
      const photo = await cropFromInput(ev.target, { aspect: 1, round: true, width: 256, maxChars: 120000, title: EX.cropPhoto });
      if (photo) savePhoto(photo);
    } catch {
      alertBox(EX.imageBad, "warning");
    }
  };
  $("#pfPhotoDel")?.addEventListener("click", () => savePhoto(""));

  $("#pfForm")?.addEventListener("submit", (ev) => {
    ev.preventDefault();
    const name = $("#pfName").value.trim();
    if (!name) return;
    const num = $("#pfNumber").value;
    run(async () => {
      const data = { name, number: num === "" ? null : Number(num), gender: $("#pfGender").value, photoURL: state.profile.photoURL || "" };
      await saveProfile(state.user, data);
      Object.assign(state.profile, data);
      state.editing = false;
      alertBox(EX.saved);
      render();
    });
  });
}

function renderSignIn() {
  root.innerHTML = `
    <div class="ev-card text-center py-5 mt-3" style="max-width:520px;margin:auto">
      <div class="display-6 mb-2">🥏</div>
      <h1 class="h4 fw-bold">${esc(EX.navProfile)}</h1>
      <p class="ev-muted">${esc(EX.pfSignIn)}</p>
      <button class="btn tn-btn-grad" id="tnLogin"><i class="bi bi-google me-1"></i>${esc(EX.signIn)}</button>
    </div>`;
  $("#tnLogin").onclick = async () => {
    try {
      await signInGoogle();
      location.reload();
    } catch (err) {
      alertBox(`${EX.error} ${err?.code || ""}`, "danger");
    }
  };
}

(async function init() {
  showLoader();
  try {
    const user = await waitForUser();
    state.user = isGoogleUser(user) ? user : null;
    state.uid = PARAM_UID || state.user?.uid || "";
    state.own = !!state.user && state.uid === state.user.uid;
    renderNav({ active: state.own ? "profile" : "", user, isAdmin: await isPlatformAdmin(state.user?.uid) });
    if (!state.uid) return renderSignIn();
    state.profile = state.own ? await ensureProfile(state.user) : await loadProfile(state.uid);
    if (!state.profile) return alertBox(EX.pfNotFound, "warning");
    // sin F/M todavía: abre la edición para completarlo
    state.editing = state.own && !state.profile.gender;
    state.squads = (await Promise.all((state.profile.squadIds || []).map((id) => loadSquad(id).catch(() => null)))).filter(Boolean);
    render();
    hideLoader();
    // el historial puede tardar (lee los partidos de cada torneo)
    if (state.own) pendingSpirit(state.user).then((list) => {
      state.spirit = list;
      if (list.length) render();
    }).catch(() => {});
    state.history = await playerHistory(state.uid, state.profile.squadIds || []);
    render();
  } catch (err) {
    console.error(err);
    alertBox(`${EX.error} ${err?.code || err?.message || ""}`, "danger");
  } finally {
    hideLoader();
  }
})();
