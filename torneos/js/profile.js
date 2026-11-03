// /torneos/js/profile.js
// Perfil del jugador (?u=UID, o el propio). Foto, número, equipos e historial de estadísticas
// en todos los torneos y partidos. El dueño del perfil lo edita.
import { EX, exf } from "/torneos/js/strings.js";
import { isPlatformAdmin } from "/torneos/js/services.js";
import { ensureProfile, loadProfile, loadSquad, playerHistory, saveProfile, squadUrl } from "/torneos/js/squads.js";
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
  shrinkImage,
  signInGoogle,
  teamBadge,
  waitForUser,
} from "/torneos/js/ui.js";

const root = document.getElementById("tnRoot");
const $ = (sel) => root.querySelector(sel);
const PARAM_UID = new URLSearchParams(location.search).get("u") || "";

const state = { user: null, uid: "", profile: null, squads: [], history: null, own: false };

function alertBox(msg, kind = "success") {
  const el = document.getElementById("tnAlert");
  el.className = `alert alert-${kind}`;
  el.textContent = msg;
  el.classList.toggle("d-none", !msg);
  if (msg && kind === "success") setTimeout(() => el.classList.add("d-none"), 2500);
}

const tile = (n, label) => `<div class="col-4 col-md-2"><div class="tn-stat-tile"><div class="tn-stat-tile__n">${esc(n)}</div><div class="tn-stat-tile__l">${esc(label)}</div></div></div>`;

function hero() {
  const p = state.profile;
  return `
    <section class="ev-card tn-profile-hero">
      ${avatarHtml(p, 96)}
      <div class="flex-grow-1 min-w-0">
        <h1 class="h3 fw-bold mb-1">${esc(p.name || EX.sqUnnamed)}${p.number !== null && p.number !== undefined && p.number !== "" ? ` <span class="ev-muted">#${esc(p.number)}</span>` : ""}</h1>
        <div class="d-flex flex-wrap gap-2 align-items-center">
          ${p.gender ? `<span class="ev-chip">${esc(p.gender)}</span>` : ""}
          ${state.squads.map((s) => `<a class="d-inline-flex align-items-center gap-1 text-decoration-none small fw-semibold" href="${esc(squadUrl(s.id))}">${teamBadge(s, 22)} ${esc(s.name)}</a>`).join("")}
        </div>
      </div>
    </section>`;
}

function editForm() {
  if (!state.own) return "";
  const p = state.profile;
  return `
    <details class="ev-card" ${p.gender ? "" : "open"}>
      <summary class="fw-bold">${esc(EX.pfEdit)}</summary>
      <form id="pfForm" class="row g-3 mt-1">
        <div class="col-12 d-flex align-items-center gap-3">
          <div id="pfPhotoPrev">${avatarHtml(p, 64)}</div>
          <div>
            <label class="btn btn-sm btn-outline-secondary mb-1"><i class="bi bi-camera me-1"></i>${esc(EX.pfPhoto)}<input type="file" accept="image/*" id="pfPhoto" hidden /></label>
            <button type="button" class="btn btn-sm btn-link text-danger ${p.photoURL ? "" : "d-none"}" id="pfPhotoDel">${esc(EX.pfPhotoRemove)}</button>
            <div class="form-text m-0">${esc(EX.pfPhotoHint)}</div>
          </div>
        </div>
        <div class="col-12 col-md-6"><label class="form-label small" for="pfName">${esc(EX.pfName)}</label><input class="form-control" id="pfName" value="${esc(p.name || "")}" required /></div>
        <div class="col-6 col-md-3"><label class="form-label small" for="pfNumber">${esc(EX.playerNumber)}</label><input class="form-control" id="pfNumber" type="number" min="0" max="999" value="${esc(p.number ?? "")}" /></div>
        <div class="col-6 col-md-3">
          <label class="form-label small" for="pfGender">${esc(EX.pfGender)}</label>
          <select class="form-select" id="pfGender"><option value="">—</option><option ${p.gender === "F" ? "selected" : ""}>F</option><option ${p.gender === "M" ? "selected" : ""}>M</option></select>
        </div>
        <div class="col-12 d-flex justify-content-between align-items-center gap-2">
          <div class="form-text m-0">${esc(EX.pfSyncHint)}</div>
          <button class="btn btn-primary" type="submit">${esc(EX.save)}</button>
        </div>
      </form>
    </details>`;
}

function historySection() {
  const h = state.history;
  if (!h) return `<section class="ev-card ev-muted small">${esc(EX.pfLoadingHistory)}</section>`;
  const t = h.totals;
  const stat = (r) => `<td class="num">${r.goals}</td><td class="num">${r.assists}</td><td class="num">${r.blocks}</td><td class="num">${r.turns}</td>`;
  return `
    <section class="ev-card">
      <h2 class="h6 mb-3">${esc(EX.pfCareer)}</h2>
      <div class="row g-2">
        ${tile(t.tournaments, EX.pfTournaments)}
        ${tile(t.games, EX.pfGames)}
        ${tile(t.goals, EX.statGoals)}
        ${tile(t.assists, EX.statAssists)}
        ${tile(t.blocks, EX.statBlocks)}
        ${tile(t.callahans, EX.pfCallahans)}
      </div>
    </section>
    <section class="ev-card">
      <h2 class="h6 mb-2">${esc(EX.pfByTournament)}</h2>
      ${h.rows.length ? h.rows.map((r) => `
        <details class="border-bottom py-2">
          <summary class="d-flex align-items-center gap-2 flex-wrap">
            ${teamBadge(r.team, 28)}
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
  root.innerHTML = `<div class="d-grid gap-3">${hero()}${editForm()}${historySection()}</div>`;
  bind();
}

function bind() {
  if (!state.own) return;
  $("#pfPhoto").onchange = async (ev) => {
    const file = ev.target.files?.[0];
    if (!file) return;
    try {
      const photo = await shrinkImage(file, 192);
      if (photo.length > 200000) return alertBox(EX.teamLogoTooBig, "warning");
      state.profile.photoURL = photo;
      $("#pfPhotoPrev").innerHTML = avatarHtml(state.profile, 64);
      $("#pfPhotoDel").classList.remove("d-none");
    } catch {
      alertBox(EX.teamLogoTooBig, "warning");
    }
  };
  $("#pfPhotoDel").onclick = () => {
    state.profile.photoURL = "";
    $("#pfPhotoPrev").innerHTML = avatarHtml(state.profile, 64);
    $("#pfPhotoDel").classList.add("d-none");
  };
  $("#pfForm").onsubmit = async (ev) => {
    ev.preventDefault();
    const name = $("#pfName").value.trim();
    if (!name) return;
    const num = $("#pfNumber").value;
    showLoader();
    try {
      const data = { name, number: num === "" ? null : Number(num), gender: $("#pfGender").value, photoURL: state.profile.photoURL || "" };
      await saveProfile(state.user, data);
      Object.assign(state.profile, data);
      alertBox(EX.saved);
      render();
    } catch (err) {
      console.error(err);
      alertBox(`${EX.error} ${err?.code || ""}`, "danger");
    } finally {
      hideLoader();
    }
  };
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
    state.squads = (await Promise.all((state.profile.squadIds || []).map((id) => loadSquad(id).catch(() => null)))).filter(Boolean);
    render();
    hideLoader();
    // el historial puede tardar (lee los partidos de cada torneo)
    state.history = await playerHistory(state.uid, state.profile.squadIds || []);
    render();
  } catch (err) {
    console.error(err);
    alertBox(`${EX.error} ${err?.code || err?.message || ""}`, "danger");
  } finally {
    hideLoader();
  }
})();
