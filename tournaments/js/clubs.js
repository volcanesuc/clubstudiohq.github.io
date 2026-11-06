// /tournaments/js/clubs.js
// Clubes: todos los equipos de la plataforma, con filtro por rama (según los torneos que jugaron)
// y búsqueda. Cada club abre su página (jugadores, torneos, resultados).
import { EX, LOCALE, exf, trData } from "/tournaments/js/strings.js";
import { loadDivisionOptions } from "/tournaments/js/services.js";
import { listClubDirectory, squadUrl } from "/tournaments/js/squads.js";
import { countryName, flagOf } from "/tournaments/js/countries.js";
import { esc, hideLoader, renderNav, revealActiveTab, showLoader, teamBadge, waitForUser } from "/tournaments/js/ui.js";

const root = document.getElementById("tnRoot");
const params = new URLSearchParams(location.search);
// filtros (quedan en la URL para compartir): rama, categoría y país
// (rama/cat/pais: nombres viejos de los parámetros, se siguen aceptando)
const state = { clubs: [], genders: [], filter: params.get("division") || params.get("rama") || "all", level: params.get("level") || params.get("cat") || "", country: params.get("country") || params.get("pais") || "", term: "" };

const norm = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

function visible() {
  const term = norm(state.term);
  return state.clubs.filter((c) =>
    (state.filter === "all" || c.genders.includes(state.filter))
    && (!state.level || c.levels.includes(state.level))
    && (!state.country || c.squad.country === state.country)
    && (!term || norm(`${c.squad.name} ${c.squad.city} ${countryName(c.squad.country)}`).includes(term)));
}

function card(c) {
  const s = c.squad;
  const names = c.genders.map((g) => state.genders.find((x) => x.id === g)?.name || g);
  return `
    <a class="ev-card cl-card" href="${esc(squadUrl(s.id))}">
      ${teamBadge(s, 48)}
      <div class="min-w-0 flex-grow-1">
        <div class="fw-bold text-truncate">${esc(s.name || "—")}</div>
        ${s.city || s.country ? `<div class="small ev-muted text-truncate">${s.country ? `${flagOf(s.country)} ` : ""}${esc([s.city, countryName(s.country)].filter(Boolean).join(", "))}</div>` : ""}
        <div class="small ev-muted">${esc([c.players === 1 ? EX.clPlayer : exf(EX.clPlayers, { n: c.players }), c.tournaments === 1 ? EX.clTournament : exf(EX.clTournaments, { n: c.tournaments })].join(" · "))}</div>
        ${names.length || c.levels.length ? `<div class="d-flex flex-wrap gap-1 mt-1">${[...c.levels.map(trData), ...names].map((n) => `<span class="ev-chip">${esc(n)}</span>`).join("")}</div>` : ""}
      </div>
      <i class="bi bi-chevron-right ev-muted"></i>
    </a>`;
}

function renderList() {
  const items = visible();
  root.querySelector("#clList").innerHTML = items.length
    ? items.map(card).join("")
    : `<div class="ev-card ev-muted">${esc(state.clubs.length ? EX.clNoMatch : EX.clEmpty)}</div>`;
  root.querySelectorAll("[data-rama]").forEach((b) => b.classList.toggle("is-active", b.dataset.rama === state.filter));
}

function render() {
  // solo las ramas que algún club jugó (más "Todos")
  const used = state.genders.filter((g) => state.clubs.some((c) => c.genders.includes(g.id)));
  const countries = [...new Set(state.clubs.map((c) => c.squad.country).filter(Boolean))].sort((a, b) => countryName(a).localeCompare(countryName(b), LOCALE));
  const levels = [...new Set(state.clubs.flatMap((c) => c.levels))].sort((a, b) => a.localeCompare(b, LOCALE));
  const count = (id) => (id === "all" ? state.clubs.length : state.clubs.filter((c) => c.genders.includes(id)).length);
  root.innerHTML = `
    <section class="ev-hero mb-3">
      <h1>${esc(EX.clTitle)}</h1>
      <div class="ev-hero__meta">${esc(EX.clSubtitle)}</div>
    </section>
    <div class="sb-filters mb-2" role="tablist">
      ${[{ id: "all", name: EX.clAll }, ...used].map((g) => `<button class="sb-filter ${state.filter === g.id ? "is-active" : ""}" data-rama="${esc(g.id)}">${esc(g.name)} <span>${count(g.id)}</span></button>`).join("")}
    </div>
    <div class="cl-selects mb-2">
      ${countries.length ? `<select class="form-select" id="clCountry" aria-label="${esc(EX.teamCountry)}">
        <option value="">${esc(EX.clAllCountries)}</option>
        ${countries.map((c) => `<option value="${esc(c)}" ${state.country === c ? "selected" : ""}>${flagOf(c)} ${esc(countryName(c))}</option>`).join("")}
      </select>` : ""}
      ${levels.length ? `<select class="form-select" id="clLevel" aria-label="${esc(EX.clAllLevels)}">
        <option value="">${esc(EX.clAllLevels)}</option>
        ${levels.map((l) => `<option value="${esc(l)}" ${state.level === l ? "selected" : ""}>${esc(trData(l))}</option>`).join("")}
      </select>` : ""}
    </div>
    <div class="ui-search-wrap mb-3">
      <i class="bi bi-search"></i>
      <input type="search" class="form-control" id="clSearch" placeholder="${esc(EX.clSearch)}" value="${esc(state.term)}" />
    </div>
    <div id="clList" class="d-grid gap-2"></div>`;
  renderList();
  revealActiveTab(root.querySelector(".sb-filters"));
}

function syncUrl() {
  const url = new URL(location.href);
  ["rama", "cat", "pais"].forEach((k) => url.searchParams.delete(k));
  [["division", state.filter === "all" ? "" : state.filter], ["level", state.level], ["country", state.country]]
    .forEach(([k, v]) => (v ? url.searchParams.set(k, v) : url.searchParams.delete(k)));
  history.replaceState({}, "", url);
}

root.addEventListener("click", (ev) => {
  const b = ev.target.closest("[data-rama]");
  if (!b) return;
  state.filter = b.dataset.rama;
  syncUrl();
  renderList();
});

root.addEventListener("change", (ev) => {
  if (ev.target.id === "clCountry") state.country = ev.target.value;
  else if (ev.target.id === "clLevel") state.level = ev.target.value;
  else return;
  syncUrl();
  renderList();
});

root.addEventListener("input", (ev) => {
  if (ev.target.id !== "clSearch") return;
  state.term = ev.target.value;
  renderList();
});

(async function init() {
  showLoader();
  try {
    const user = await waitForUser();
    renderNav({ active: "clubs", user });
    const [clubs, opts] = await Promise.all([listClubDirectory(), loadDivisionOptions()]);
    state.clubs = clubs;
    state.genders = (opts.genders || []).map((g) => ({ ...g, name: trData(g.name) }));
    if (state.filter !== "all" && !state.genders.some((g) => g.id === state.filter)) state.filter = "all";
    render();
  } catch (err) {
    console.error("[clubes]", err);
    root.innerHTML = `<div class="ev-card ev-muted">${esc(EX.error)}</div>`;
  } finally {
    hideLoader();
  }
})();
