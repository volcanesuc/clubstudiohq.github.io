// /assets/landing.js
// Portada: datos reales de la plataforma de torneos (torneo destacado en vivo + carrusel de torneos publicados).
// Si Firebase no responde, la portada sigue funcionando sin esta sección.
import { listPublicEvents, listTeams, subscribeGames } from "/torneos/js/services.js";
import { GAME_STATUS, standings } from "/torneos/js/model.js";
import { esc, eventUrl, fmtDateRange, fmtTimeOnly, fmtWhen, gameUrl, teamBadge, toMillis, withLiveTeams } from "/torneos/js/ui.js";

const $ = (id) => document.getElementById(id);
const pad = (n) => String(n).padStart(2, "0");
const localKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const TODAY = localKey(new Date());

// en curso / próximo / finalizado según las fechas del torneo
function phaseOf(e) {
  const start = e.startDate || "";
  const end = e.endDate || start;
  if (!start) return "soon";
  if (start <= TODAY && TODAY <= end) return "live";
  return start > TODAY ? "soon" : "done";
}

const daysUntil = (dateStr) => Math.round((new Date(`${dateStr}T12:00:00`) - new Date(`${TODAY}T12:00:00`)) / 86400000);

function chip(e) {
  const p = phaseOf(e);
  if (p === "live") return `<span class="lp-chip lp-chip--live"><span class="lp-dot"></span>En curso</span>`;
  if (p === "soon") {
    const d = e.startDate ? daysUntil(e.startDate) : null;
    return `<span class="lp-chip lp-chip--soon">${d === 1 ? "Mañana" : d ? `En ${d} días` : "Próximamente"}</span>`;
  }
  return `<span class="lp-chip lp-chip--done">Finalizado</span>`;
}

// orden: destacados y en curso primero, luego próximos (el más cercano primero) y después los terminados
function sortEvents(events) {
  const rank = { live: 0, soon: 1, done: 2 };
  return events.slice().sort((a, b) => {
    const pa = phaseOf(a);
    const pb = phaseOf(b);
    if (pa !== pb) return rank[pa] - rank[pb];
    if (!!b.featured !== !!a.featured) return b.featured ? 1 : -1;
    const sa = a.startDate || "";
    const sb = b.startDate || "";
    return pa === "done" ? sb.localeCompare(sa) : sa.localeCompare(sb);
  });
}

/* =========================
   Torneo destacado
========================= */
function gameRow(game, teams, eventId) {
  const g = withLiveTeams(game, teams);
  const live = g.status === GAME_STATUS.LIVE;
  const final = g.status === GAME_STATUS.FINAL;
  const mid = live || final
    ? `<div class="lp-game__score">${g.scoreA || 0} – ${g.scoreB || 0}</div><div class="lp-game__meta ${live ? "is-live" : ""}">${live ? "● En vivo" : "Final"}</div>`
    : `<div class="lp-game__score" style="font-size:1rem">${esc(fmtTimeOnly(g.startAt) || "vs")}</div><div class="lp-game__meta">${esc(g.field || fmtWhen(g.startAt, { weekday: "short", day: "numeric" }) || "")}</div>`;
  return `
    <a class="lp-game" href="${esc(gameUrl(eventId, g.id))}">
      <div class="lp-game__team">${teamBadge(g.teamA || {}, 28)}<span>${esc(g.teamA?.name || "—")}</span></div>
      <div class="lp-game__mid">${mid}</div>
      <div class="lp-game__team lp-game__team--b"><span>${esc(g.teamB?.name || "—")}</span>${teamBadge(g.teamB || {}, 28)}</div>
    </a>`;
}

function renderFeatured(e, teams, games) {
  const byTime = (a, b) => toMillis(a.startAt) - toMillis(b.startAt);
  const live = games.filter((g) => g.status === GAME_STATUS.LIVE).sort(byTime);
  const upcoming = games.filter((g) => g.status === GAME_STATUS.SCHEDULED || !g.status).sort(byTime);
  const finals = games.filter((g) => g.status === GAME_STATUS.FINAL).sort(byTime).reverse();
  const [title, list] = live.length
    ? ["<span class=\"lp-dot\"></span>Jugándose ahora", live]
    : upcoming.length
      ? ["<i class=\"bi bi-clock\"></i>Próximos partidos", upcoming]
      : ["<i class=\"bi bi-flag\"></i>Últimos resultados", finals];
  const goals = games.reduce((n, g) => n + (g.status !== GAME_STATUS.SCHEDULED ? (g.scoreA || 0) + (g.scoreB || 0) : 0), 0);
  const table = standings(teams, games).slice(0, 5);
  const hasResults = finals.length > 0;
  const url = eventUrl(e);
  const cover = e.image
    ? `class="lp-feat__cover" style="background-image:url('${esc(e.image)}')"`
    : `class="lp-feat__cover lp-feat__cover--plain"`;

  $("lpFeatured").innerHTML = `
    <article class="lp-feat">
      <div ${cover}>
        <div class="d-flex gap-2 flex-wrap">${chip(e)}${e.registrationOpen ? `<span class="lp-chip" style="background:rgba(34,197,94,.22);color:#bbf7d0">Inscripciones abiertas</span>` : ""}</div>
        <div class="lp-feat__title">${esc(e.name || "Torneo")}</div>
        <div class="muted d-flex flex-wrap gap-3">
          ${e.startDate ? `<span><i class="bi bi-calendar-event me-1"></i>${esc(fmtDateRange(e.startDate, e.endDate))}</span>` : ""}
          ${e.venue ? `<span><i class="bi bi-geo-alt me-1"></i>${esc(e.venue)}</span>` : ""}
        </div>
        <div class="d-flex flex-wrap gap-2 mt-3">
          <a class="btn btn-lp" href="${esc(url)}">${phaseOf(e) === "live" ? "Seguir en vivo" : "Ver torneo"} <i class="bi bi-arrow-right ms-1"></i></a>
          ${e.registrationOpen ? `<a class="btn btn-lp-ghost" href="/torneos/equipo.html?e=${encodeURIComponent(e.id)}"><i class="bi bi-person-plus me-1"></i>Inscribir mi equipo</a>` : ""}
        </div>
      </div>
      <div class="lp-feat__body">
        <div class="row g-4">
          <div class="col-12 col-lg-7">
            <div class="row g-2">
              <div class="col-4"><div class="lp-stat"><div class="lp-stat__n">${teams.length}</div><div class="lp-stat__l">Equipos</div></div></div>
              <div class="col-4"><div class="lp-stat"><div class="lp-stat__n">${finals.length}<span class="muted fs-6">/${games.length}</span></div><div class="lp-stat__l">Partidos</div></div></div>
              <div class="col-4"><div class="lp-stat"><div class="lp-stat__n">${goals}</div><div class="lp-stat__l">Goles</div></div></div>
            </div>
            <div class="lp-block-title">${title}</div>
            ${list.length
              ? list.slice(0, 4).map((g) => gameRow(g, teams, e.id)).join("")
              : `<div class="muted tiny">El calendario de partidos se publica pronto.</div>`}
          </div>
          <div class="col-12 col-lg-5">
            <div class="lp-block-title mt-lg-0"><i class="bi bi-list-ol"></i>Posiciones</div>
            ${teams.length ? `
              <table class="lp-table">
                <thead><tr><th>#</th><th class="text-start">Equipo</th><th class="num">G</th><th class="num">P</th><th class="num">DIF</th></tr></thead>
                <tbody>${table.map((r, i) => `
                  <tr>
                    <td><span class="lp-rank">${i + 1}</span></td>
                    <td><div class="d-flex align-items-center gap-2 text-truncate">${teamBadge(r.team, 24)}<span class="text-truncate fw-semibold">${esc(r.team.name)}</span></div></td>
                    <td class="num fw-bold">${r.w}</td>
                    <td class="num">${r.l}</td>
                    <td class="num" style="color:${r.diff > 0 ? "#86efac" : r.diff < 0 ? "#fca5a5" : "inherit"}">${r.diff > 0 ? "+" : ""}${r.diff}</td>
                  </tr>`).join("")}
                </tbody>
              </table>
              ${hasResults ? "" : `<div class="muted tiny mt-2">Se completa a medida que se juegan los partidos.</div>`}
              <a class="d-inline-block mt-3 tiny fw-bold" style="color:#67e8f9" href="${esc(url)}#standings">Tabla completa y estadísticas <i class="bi bi-arrow-right"></i></a>`
              : `<div class="muted tiny">Los equipos se están inscribiendo.</div>`}
          </div>
        </div>
      </div>
    </article>`;
}

function renderEmpty() {
  $("lpFeatured").innerHTML = `
    <div class="lp-cta">
      <h3 class="fw-bold">Tu torneo puede ser el primero acá</h3>
      <p class="muted">Publicá tu torneo y aparece en la portada con marcador en vivo y estadísticas públicas.</p>
      <a class="btn btn-wa" target="_blank" rel="noopener" href="https://wa.me/50670567463?text=${encodeURIComponent("Hola! Quiero una demo gratis de ClubStudio Torneos.")}"><i class="bi bi-whatsapp me-1"></i>Pedir demo gratis</a>
    </div>`;
  $("lpTrack").closest(".lp-carousel").previousElementSibling.classList.add("d-none");
  $("lpTrack").closest(".lp-carousel").classList.add("d-none");
}

/* =========================
   Carrusel de torneos
========================= */
function eventCard(e) {
  const img = e.image
    ? `<div class="lp-ev__img" style="background-image:url('${esc(e.image)}')">${chip(e)}</div>`
    : `<div class="lp-ev__img lp-ev__img--plain">🥏${chip(e)}</div>`;
  return `
    <a class="lp-ev" href="${esc(eventUrl(e))}">
      ${img}
      <div class="lp-ev__body">
        <div class="lp-ev__name">${esc(e.name || "Torneo")}</div>
        ${e.startDate ? `<div class="lp-ev__meta"><i class="bi bi-calendar-event me-1"></i>${esc(fmtDateRange(e.startDate, e.endDate))}</div>` : ""}
        ${e.venue ? `<div class="lp-ev__meta text-truncate"><i class="bi bi-geo-alt me-1"></i>${esc(e.venue)}</div>` : ""}
        <div class="lp-ev__tags">
          ${e.registrationOpen ? `<span class="lp-tag lp-tag--open">Inscripciones abiertas</span>` : ""}
          ${(e.divisions || []).slice(0, 3).map((d) => `<span class="lp-tag">${esc(d.name)}</span>`).join("")}
        </div>
      </div>
    </a>`;
}

function bindCarousel() {
  const track = $("lpTrack");
  document.querySelectorAll("[data-scroll]").forEach((b) => {
    b.addEventListener("click", () => track.scrollBy({ left: Number(b.dataset.scroll) * (track.clientWidth * 0.85), behavior: "smooth" }));
  });
}

/* =========================
   Inicio
========================= */
(async function init() {
  bindCarousel();
  try {
    const events = sortEvents(await listPublicEvents());
    if (!events.length) return renderEmpty();
    $("lpTrack").innerHTML = events.map(eventCard).join("");
    const featured = events[0];
    const teams = await listTeams(featured.id).catch(() => []);
    renderFeatured(featured, teams, []);
    // marcadores en vivo del torneo destacado
    subscribeGames(featured.id, (games) => renderFeatured(featured, teams, games));
  } catch (err) {
    console.warn("[portada] torneos:", err?.code || err);
    $("lpFeatured").closest("section").classList.add("d-none");
  }
})();
