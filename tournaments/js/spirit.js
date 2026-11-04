// /tournaments/js/spirit.js
// Evaluación de espíritu (WFDF) que hace cada equipo al terminar el partido (?event=&game=&side=).
// Pueden evaluar los admins del equipo del torneo o su capitán(a) de espíritu; solo guardan su lado.
import { EX, exf } from "/tournaments/js/strings.js";
import { GAME_STATUS, SPIRIT_KEYS, spiritTotal } from "/tournaments/js/model.js";
import { isPlatformAdmin, listGames, listTeams, loadEvent, saveTeamSpirit } from "/tournaments/js/services.js";
import { canRateSpirit } from "/tournaments/js/squads.js";
import { esc, eventUrl, gameUrl, hideLoader, isGoogleUser, renderNav, showLoader, signInGoogle, teamBadge, waitForUser, withLiveTeams } from "/tournaments/js/ui.js";

const root = document.getElementById("tnRoot");
const $ = (sel) => root.querySelector(sel);
const params = new URLSearchParams(location.search);
const EID = params.get("event") || "";
const GID = params.get("game") || "";

const LABELS = { rules: EX.spiritRules, fouls: EX.spiritFouls, fair: EX.spiritFair, attitude: EX.spiritAttitude, comm: EX.spiritComm };
const HINTS = { rules: EX.spRulesHint, fouls: EX.spFoulsHint, fair: EX.spFairHint, attitude: EX.spAttitudeHint, comm: EX.spCommHint };

const state = { user: null, event: null, game: null, sides: [], side: "", card: null, done: false };

function alertBox(msg, kind = "danger") {
  const el = document.getElementById("tnAlert");
  el.className = `alert alert-${kind}`;
  el.textContent = msg;
  el.classList.toggle("d-none", !msg);
}

// WFDF: 2 es lo normal; 0, 1 o 4 (lejos de 2–3) piden explicar por qué.
const needsJustify = (card) => SPIRIT_KEYS.some((k) => [0, 1, 4].includes(Number(card[k])));

const wrap = (inner) => `<div class="mx-auto d-grid gap-3" style="max-width:640px">${inner}</div>`;
const teamOf = (side) => (side === "A" ? state.game.teamA : state.game.teamB);
const other = (side) => (side === "A" ? "B" : "A");

function matchHeader() {
  const g = state.game;
  return `
    <section class="sp-match">
      <div class="sp-match__event"><a class="text-reset text-decoration-none" href="${esc(eventUrl(state.event))}">${esc(state.event.name || "")}</a></div>
      <div class="sp-match__row">
        <div class="sp-match__team">${teamBadge(g.teamA || {}, 52)}<span>${esc(g.teamA?.name || "—")}</span></div>
        <div class="sp-match__score">${g.scoreA || 0}<span>–</span>${g.scoreB || 0}</div>
        <div class="sp-match__team">${teamBadge(g.teamB || {}, 52)}<span>${esc(g.teamB?.name || "—")}</span></div>
      </div>
      <a class="small text-white-50" href="${esc(gameUrl(EID, GID))}">${esc(EX.gameFinal)} · ${esc(EX.openPublic)}</a>
    </section>`;
}

function renderForm() {
  const side = state.side;
  const opp = teamOf(other(side));
  const prev = state.game.spirit?.[side];
  const card = state.card;
  const total = spiritTotal(card);
  root.innerHTML = wrap(`
    ${matchHeader()}
    <form id="spForm" class="ev-card d-grid gap-3">
      <div>
        <h1 class="h4 fw-bold mb-1">${esc(exf(EX.spRateTitle, { team: opp?.name || "—" }))}</h1>
        <div class="small ev-muted">${esc(EX.spRateSub)}</div>
        ${state.sides.length > 1 ? `
          <div class="mt-2 small"><span class="fw-semibold">${esc(EX.spPickSide)}</span>
            ${state.sides.map((s) => `<button type="button" class="btn btn-sm ${s === side ? "btn-primary" : "btn-outline-primary"} ms-1" data-side="${s}">${esc(teamOf(s)?.name || s)}</button>`).join("")}
          </div>` : `<div class="mt-2 small ev-muted">${esc(exf(EX.spAs, { team: teamOf(side)?.name || "" }))}</div>`}
        ${prev ? `<div class="alert alert-info py-2 small mt-2 mb-0">${esc(EX.spAlready)}</div>` : ""}
      </div>
      ${SPIRIT_KEYS.map((k) => `
        <div class="sp-cat">
          <div class="sp-cat__head"><div class="fw-bold">${esc(LABELS[k])}</div><div class="small ev-muted">${esc(HINTS[k])}</div></div>
          <div class="sp-scale" role="radiogroup" aria-label="${esc(LABELS[k])}">
            ${[0, 1, 2, 3, 4].map((n) => `<button type="button" class="sp-scale__btn ${Number(card[k]) === n ? "is-active" : ""}" data-cat="${k}" data-val="${n}" aria-pressed="${Number(card[k]) === n}">${n}</button>`).join("")}
          </div>
        </div>`).join("")}
      <div class="small ev-muted text-center">${esc(EX.spLevels)}</div>
      <div>
        ${needsJustify(card) ? `<label class="form-label small fw-semibold text-warning-emphasis" for="spComment">${esc(EX.spJustifyLabel)}</label>` : ""}
        <textarea class="form-control ${needsJustify(card) && !(card.comment || "").trim() ? "border-warning" : ""}" id="spComment" rows="${needsJustify(card) ? 3 : 2}" maxlength="500" placeholder="${esc(needsJustify(card) ? EX.spJustifyLabel : EX.spiritComment)}" ${needsJustify(card) ? "required" : ""}>${esc(card.comment || "")}</textarea>
      </div>
      <div class="d-flex justify-content-between align-items-center flex-wrap gap-2">
        <div class="sp-total"><span>${total}</span>/20</div>
        <button class="btn tn-btn-grad btn-lg px-4" type="submit"><i class="bi bi-heart-fill me-1"></i>${esc(prev ? EX.spUpdate : EX.spSubmit)}</button>
      </div>
    </form>`);
}

function renderDone() {
  const opp = teamOf(other(state.side));
  root.innerHTML = wrap(`
    ${matchHeader()}
    <section class="ev-card text-center py-4">
      <div class="display-5">💜</div>
      <h1 class="h4 fw-bold mt-2">${esc(EX.spThanks)}</h1>
      <p class="ev-muted">${esc(exf(EX.spThanksSub, { team: opp?.name || "", n: spiritTotal(state.card) }))}</p>
      <div class="d-flex justify-content-center gap-2 flex-wrap">
        <a class="btn btn-primary" href="/tournaments/team.html">${esc(EX.spBack)}</a>
        <a class="btn btn-light" href="${esc(eventUrl(state.event))}#spirit">${esc(EX.tabSpirit)}</a>
      </div>
    </section>`);
}

const message = (icon, text) => {
  root.innerHTML = wrap(`${state.game ? matchHeader() : ""}<div class="ev-card text-center py-4"><div class="display-6">${icon}</div><p class="mt-2 mb-0">${esc(text)}</p></div>`);
};

function pickSide(side) {
  state.side = side;
  const prev = state.game.spirit?.[side];
  state.card = prev ? { ...prev } : { rules: 2, fouls: 2, fair: 2, attitude: 2, comm: 2, comment: "" };
  renderForm();
}

root.addEventListener("click", (ev) => {
  const b = ev.target.closest("[data-cat]");
  if (b) {
    state.card[b.dataset.cat] = Number(b.dataset.val);
    state.card.comment = $("#spComment")?.value || "";
    return renderForm();
  }
  const s = ev.target.closest("[data-side]");
  if (s) pickSide(s.dataset.side);
});

root.addEventListener("submit", async (ev) => {
  if (ev.target.id !== "spForm") return;
  ev.preventDefault();
  const card = {};
  SPIRIT_KEYS.forEach((k) => (card[k] = Number(state.card[k]) || 0));
  card.comment = $("#spComment").value.trim();
  if (needsJustify(card) && !card.comment) {
    alertBox(EX.spJustifyRequired, "warning");
    $("#spComment").focus();
    return;
  }
  alertBox("");
  card.by = state.user.uid;
  card.byName = state.user.displayName || "";
  card.at = new Date();
  showLoader();
  try {
    await saveTeamSpirit(EID, GID, state.side, card);
    state.card = card;
    renderDone();
  } catch (err) {
    console.error(err);
    alertBox(`${EX.error} ${err?.code || ""}`);
  } finally {
    hideLoader();
  }
});

function renderSignIn() {
  root.innerHTML = wrap(`
    <div class="ev-card text-center py-5">
      <div class="display-6 mb-2">💜</div>
      <h1 class="h4 fw-bold">${esc(EX.spPageTitle)}</h1>
      <p class="ev-muted">${esc(EX.spSignIn)}</p>
      <button class="btn tn-btn-grad" id="tnLogin"><i class="bi bi-google me-1"></i>${esc(EX.signIn)}</button>
    </div>`);
  $("#tnLogin").onclick = async () => {
    try {
      await signInGoogle();
      location.reload();
    } catch (err) {
      alertBox(`${EX.error} ${err?.code || ""}`);
    }
  };
}

(async function init() {
  showLoader();
  try {
    const user = await waitForUser();
    state.user = isGoogleUser(user) ? user : null;
    renderNav({ active: "team", user, isAdmin: await isPlatformAdmin(state.user?.uid) });
    if (!state.user) return renderSignIn();
    const [event, teams, games] = await Promise.all([loadEvent(EID), listTeams(EID), listGames(EID)]);
    state.event = event;
    const raw = games.find((g) => g.id === GID);
    if (!event || !raw) return message("🔍", EX.eventNotFound);
    state.game = withLiveTeams(raw, teams);
    if (state.game.status !== GAME_STATUS.FINAL) return message("⏱️", EX.spNotFinal);
    const docs = { A: teams.find((t) => t.id === raw.teamA?.id), B: teams.find((t) => t.id === raw.teamB?.id) };
    const allowed = await Promise.all(["A", "B"].map(async (s) => ((await canRateSpirit(state.user, docs[s])) ? s : null)));
    state.sides = allowed.filter(Boolean);
    if (!state.sides.length) return message("🔒", EX.spNoAccess);
    const want = params.get("side");
    pickSide(state.sides.includes(want) ? want : state.sides[0]);
  } catch (err) {
    console.error(err);
    alertBox(`${EX.error} ${err?.code || err?.message || ""}`);
  } finally {
    hideLoader();
  }
})();
