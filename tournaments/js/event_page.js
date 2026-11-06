// /tournaments/js/event_page.js
// Página pública de un evento (?e=slug): resumen, posiciones, estadísticas (MVP y líderes), equipos,
// partidos y espíritu. Los partidos se actualizan en vivo.
import { countryName, flagOf } from "/tournaments/js/countries.js";
import { EX, exf } from "/tournaments/js/strings.js";
import {
  GAME_STATUS,
  SPIRIT_KEYS,
  SURFACES,
  SURFACE_ICONS,
  eventRules,
  slotMinutes,
  leaders,
  playerTotals,
  spiritTable,
  standings,
} from "/tournaments/js/model.js";
import { deadlineEnd, REG, isApproved, leaveHat, listMyHatEntries, listTeams, registrationIsOpen, loadEvent, loadPublicEventBySlug, subscribeGames, withdrawRegistration, fmtMoney, teamFee, listWaiverStatus, waiverOn } from "/tournaments/js/services.js";
import { isHatEvent } from "/tournaments/js/hat.js";
import { bracketHtml, finalPlaces, hasBracket } from "/tournaments/js/bracket_view.js";
import { myRegistrationsFor, loadProfile } from "/tournaments/js/squads.js";
import { avatarHtml, esc, fmtDateRange, fmtDayOnly, fmtTimeOnly, fmtWhen, gameRowHtml, gameUrl, hideLoader, isGoogleUser, phaseLabel, playerLabel, regChip, renderNav, revealActiveTab, showLoader, teamBadge, toMillis, waitForUser, withLiveTeams, atMinutes, downloadIcs, scheduleDays, scheduleGridHtml } from "/tournaments/js/ui.js";

const $ = (id) => document.getElementById(id);
const KEY = new URLSearchParams(location.search).get("e") || "";

const state = { event: null, rules: eventRules({}), teams: [], games: [], tab: location.hash.replace("#", "") || "overview", division: "", user: null, myRegs: [], gameFilter: "all", gameDay: "", gamesView: "list", statsView: "leaders", mvpPage: 0, statsSort: "mvp", statsQ: "", statsTeam: "", myHat: null };

// fila de partido con nombre, color y logo actuales del equipo
const row = (g) => gameRowHtml(g, { href: gameUrl(state.event.id, g.id), teams: state.teams });

// Consulta para el mapa: coordenadas o lugar del link de Google Maps; si no, sede + dirección
function mapQuery(e) {
  const url = e.mapsUrl || "";
  const at = url.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
  if (at) return `${at[1]},${at[2]}`;
  const q = url.match(/[?&](?:q|query|destination)=([^&]+)/);
  if (q) return decodeURIComponent(q[1].replace(/\+/g, " "));
  const place = url.match(/\/place\/([^/@?]+)/);
  if (place) return decodeURIComponent(place[1].replace(/\+/g, " "));
  return [e.venue, e.address].filter(Boolean).join(", ");
}

// Resumen › Inscripción: cuota, fechas límite y tamaño del roster (para ver antes de inscribirse)
function registrationInfoCard() {
  const e = state.event;
  const r = state.rules;
  const hat = isHatEvent(e);
  const fee = hat ? (e.fees?.playerMode && e.fees.playerMode !== "free" ? Number(e.fees.player) || 0 : 0) : teamFee(e);
  const items = [];
  if (fee) items.push(["cash-coin", hat ? EX.feePlayer : EX.feeTeam, fmtMoney(fee, e.fees?.currency || "CRC")]);
  if (e.registrationDeadline) items.push(["calendar-check", EX.regDeadline, fmtDayOnly(deadlineEnd(e.registrationDeadline))]);
  if (e.rosterDeadline) items.push(["lock", EX.rosterDeadline, fmtDayOnly(deadlineEnd(e.rosterDeadline))]);
  if (!hat && (r.rosterMin || r.rosterMax)) {

    items.push(["people", EX.roster, r.rosterMin && r.rosterMax ? `${r.rosterMin}–${r.rosterMax}` : r.rosterMin ? exf(EX.regRosterAtLeast, { n: r.rosterMin }).replace(/[()]/g, "") : exf(EX.regRosterAtMost, { n: r.rosterMax }).replace(/[()]/g, "")]);
  }
  if (!items.length && !e.fees?.info) return "";
  return `
    <section class="ev-card mt-3">
      <div class="d-flex justify-content-between align-items-center flex-wrap gap-2 mb-2">
        <h2 class="h6 mb-0">${esc(EX.regInfoTitle)}</h2>
        ${registrationIsOpen(e) ? `<span class="ev-chip ev-chip--ok">${esc(EX.regOpen)}</span>` : `<span class="ev-chip">${esc(EX.registrationClosedShort)}</span>`}
      </div>
      <div class="ev-info-grid">
        ${items.map(([icon, label, value]) => `<div class="ev-info"><i class="bi bi-${icon}"></i><div><div class="ev-info__label">${esc(label)}</div><div class="ev-info__value">${esc(value)}</div></div></div>`).join("")}
      </div>
      ${e.fees?.info ? `<div class="small ev-muted mt-2" style="white-space:pre-line">${esc(e.fees.info)}</div>` : ""}
    </section>`;
}

function venueCard() {
  const e = state.event;
  if (!e.mapsUrl && !e.address) return "";
  const q = mapQuery(e);
  return `
    <div class="ev-card mt-3">
      <div class="d-flex justify-content-between align-items-start gap-2 flex-wrap mb-2">
        <div>
          <div class="fw-bold"><i class="bi bi-geo-alt-fill text-danger me-1"></i>${esc(e.venue || EX.venueTitle)}</div>
          ${e.address ? `<div class="small ev-muted">${esc(e.address)}</div>` : ""}
        </div>
        ${e.mapsUrl ? `<a class="btn btn-sm btn-outline-primary" href="${esc(e.mapsUrl)}" target="_blank" rel="noopener"><i class="bi bi-map me-1"></i>${esc(EX.openMaps)}</a>` : ""}
      </div>
      ${q ? `<iframe class="tn-map" loading="lazy" referrerpolicy="no-referrer-when-downgrade" title="${esc(EX.venueTitle)}" src="https://maps.google.com/maps?q=${encodeURIComponent(q)}&z=15&output=embed"></iframe>` : ""}
    </div>`;
}

// Mis inscripciones en este torneo (si soy admin de un equipo) o el botón para inscribirme
// Si estoy en un roster y el torneo pide formulario que todavía no firmé
function waiverBanner() {
  const e = state.event;
  if (!waiverOn(e) || !state.user || !state.waivers) return "";
  // en un hat también firma quien está en el pool (todavía sin equipo)
  const inRoster = state.teams.some((t) => (t.players || []).some((p) => p.uid === state.user.uid)) || (state.myHat || []).length > 0;
  if (!inRoster || state.waivers.get(state.user.uid)?.version === e.waiver.version) return "";
  return `
    <div class="ev-waiver-banner mt-3">
      <i class="bi bi-file-earmark-text"></i>
      <span class="flex-grow-1">${esc(EX.waiverBanner)}</span>
      <a class="btn btn-sm btn-light fw-bold" href="/tournaments/waiver.html?e=${encodeURIComponent(e.slug || e.id)}">${esc(EX.waiverBannerBtn)}</a>
    </div>`;
}

// Hat: el botón "Unirme como jugador" o mi estado en el pool (en espera, con equipo, cerradas)
function myHatHtml() {
  const e = state.event;
  const open = isApproved(e) && registrationIsOpen(e);
  const join = `/tournaments/hat.html?e=${encodeURIComponent(e.id)}`;
  const multiDiv = divisions().length > 1;
  const divName = (id) => divisions().find((d) => d.id === id)?.name || "";
  // con sesión: hasta saber si ya estoy en el pool no se muestra el botón (no parpadea)
  if (state.user && state.myHat === null) return "";
  const mine = state.myHat || [];
  const items = mine.map((m) => {
    const team = m.status === "assigned" ? state.teams.find((t) => t.id === m.teamId) : null;
    if (team) {
      return `
        <div class="tn-my-reg">
          ${teamBadge(team, 26)}<span class="fw-bold">${esc(exf(EX.hatMyTeamChip, { team: team.name }))}</span>
          <button class="btn btn-light btn-sm fw-bold" data-tab="teams"><i class="bi bi-people me-1"></i>${esc(EX.hatSeeMyTeam)}</button>
        </div>`;
    }
    const label = m.status === "waitlist" ? EX.hatWaitlistChip : EX.hatInHatChip;
    return `
      <div class="tn-my-reg">
        <span class="ev-chip ev-chip--wait"><i class="bi bi-hourglass-split me-1"></i>${esc(label)}${multiDiv ? ` · ${esc(divName(m.divisionId))}` : ""}</span>
        ${open ? `<a class="btn btn-light btn-sm fw-bold" href="${esc(`${join}&d=${encodeURIComponent(m.divisionId)}`)}"><i class="bi bi-pencil me-1"></i>${esc(EX.hatEditMine)}</a>` : ""}
        <button class="btn btn-outline-light btn-sm" data-hat-leave="${esc(m.id)}">${esc(EX.hatLeave)}</button>
      </div>`;
  }).join("");
  const more = !mine.length || e.hat?.multiDivision === true;
  const cta = more && open
    ? `<a class="btn btn-light btn-sm fw-bold" href="${esc(mine.length ? `${join}&new=1` : join)}"><i class="bi bi-person-plus me-1"></i>${esc(mine.length ? EX.hatAnotherDivision : EX.hatJoinCta)}</a>`
    : !mine.length ? `<span class="ev-chip">${esc(EX.registrationClosedShort)}</span>` : "";
  return `<div class="d-flex flex-wrap gap-2 mt-3">${items}${cta}</div>`;
}

function myRegistrationHtml() {
  const e = state.event;
  if (isHatEvent(e)) return myHatHtml();
  const items = state.myRegs.map(({ squad, reg }) => {
    const edit = `/tournaments/team.html?${new URLSearchParams({ e: e.id, r: reg.id })}`;
    return `
      <div class="tn-my-reg">
        ${teamBadge(squad, 26)}<span class="fw-bold">${esc(squad.name)}</span>${regChip(reg.status)}
        <a class="btn btn-light btn-sm fw-bold" href="${esc(edit)}"><i class="bi bi-pencil me-1"></i>${esc(EX.regEditMine)}</a>
        ${reg.status !== REG.APPROVED ? `<button class="btn btn-outline-light btn-sm" data-withdraw="${esc(reg.id)}" data-squad="${esc(squad.id)}">${esc(EX.regWithdrawMine)}</button>` : ""}
      </div>`;
  }).join("");
  // "inscribir otro" solo si me queda algún equipo sin inscribir
  const register = registrationIsOpen(e) && (!state.myRegs.length || state.myRegs.freeSquads > 0)
    ?`<a class="btn btn-light btn-sm fw-bold" href="/tournaments/team.html?e=${encodeURIComponent(e.id)}"><i class="bi bi-person-plus me-1"></i>${esc(state.myRegs.length ? EX.registerAnother : EX.registerTeam)}</a>`
    : "";
  if (!items && !register) return "";
  return `<div class="d-flex flex-wrap gap-2 mt-3">${items}${register}</div>`;
}

const divisions = () => (state.event.divisions?.length ? state.event.divisions : [{ id: "", name: "" }]);
const inDivision = (divId) => (x) => !state.division || (x.divisionId || divisions()[0].id) === divId;

/* =========================
   Pestañas
========================= */
function overview() {
  const games = state.games;
  const finals = games.filter((g) => g.status === GAME_STATUS.FINAL);
  const live = games.filter((g) => g.status === GAME_STATUS.LIVE);
  const upcoming = games.filter((g) => g.status === GAME_STATUS.SCHEDULED).slice(0, 6);
  const players = state.teams.reduce((n, t) => n + (t.players || []).length, 0);
  const goals = finals.concat(live).reduce((n, g) => n + (g.scoreA || 0) + (g.scoreB || 0), 0);
  const tile = (v, l) => `<div class="ev-stat"><div class="ev-stat__value">${esc(v)}</div><div class="ev-stat__label">${esc(l)}</div></div>`;
  const list = (title, arr) => (arr.length ? `<h2 class="h6 mt-4 mb-2">${esc(title)}</h2><div class="d-grid gap-2">${arr.map(row).join("")}</div>` : "");
  return `
    ${state.event.description ? `<div class="ev-card mb-3" style="white-space:pre-line">${esc(state.event.description)}</div>` : ""}
    <div class="ev-stat-grid">
      ${tile(state.teams.length, EX.overviewTeams)}
      ${tile(players, EX.overviewPlayers)}
      ${tile(`${finals.length}/${games.length}`, EX.overviewGames)}
      ${tile(goals, EX.overviewGoals)}
    </div>
    ${highlightsHtml()}
    ${registrationInfoCard()}
    ${venueCard()}
    ${list(EX.liveNow, live)}
    ${list(EX.upcoming, upcoming)}
    ${list(EX.results, finals.slice().reverse().slice(0, 6))}
    ${exportBar()}`;
}

/* ---------- Resumen: podio y mejores jugadores por división (femenino primero) ---------- */
const GENDER_ORDER = { femenino: 0, mixto: 1 };
function highlightsHtml() {
  const divs = divisions().slice().sort((a, b) => (GENDER_ORDER[a.gender] ?? 2) - (GENDER_ORDER[b.gender] ?? 2));
  const multi = divs.length > 1;
  const blocks = divs.map((d) => {
    const inDiv = (x) => (x.divisionId || divisions()[0].id) === d.id;
    const teams = state.teams.filter(inDiv);
    const games = state.games.filter(inDiv);
    const finals = games.filter((g) => g.status === GAME_STATUS.FINAL);
    if (!finals.length) return "";
    // podio: puestos finales; si todavía no hay, los líderes de la tabla
    const places = finalPlaces(teams, games);
    const byId = new Map(teams.map((t) => [t.id, t]));
    const done = places.size > 0;
    const top = done
      ? [...places].sort((a, b) => a[1] - b[1]).slice(0, 3).map(([id, p]) => ({ team: byId.get(id), place: p })).filter((x) => x.team)
      : standings(teams, finals.filter((g) => !g.phase && !g.key)).filter((r) => r.played).slice(0, 3).map((r, i) => ({ team: r.team, place: i + 1, rec: `${r.w}-${r.l}` }));
    const podium = top.length ? `
      <div class="hl-card">
        <div class="hl-card__title"><i class="bi bi-trophy-fill"></i>${esc(done ? EX.hlPodium : EX.hlLeaders)}</div>
        ${top.map((x) => `
          <div class="hl-row hl-row--${x.place}">
            <span class="hl-pos">${x.place}</span>
            ${teamBadge(x.team, 30)}
            <span class="hl-name">${esc(x.team.name)}</span>
            ${x.rec ? `<span class="hl-val">${esc(x.rec)}</span>` : ""}
          </div>`).join("")}
        <button class="btn btn-link btn-sm p-0 mt-1" data-tab="standings">${esc(EX.hlSeeStandings)} <i class="bi bi-chevron-right"></i></button>
      </div>` : "";
    // mejores jugadores (puntaje MVP); en mixto, mujeres y hombres por separado (mujeres primero)
    const totals = playerTotals(finals, teams, state.rules).filter((p) => p.teamId);
    const rank = (list) => list.slice().sort((a, b) => (b.mvp || 0) - (a.mvp || 0) || (b.goals || 0) - (a.goals || 0)).filter((p) => p.mvp > 0).slice(0, 3);
    const mixed = d.gender === "mixto" || d.mixed;
    const groups = mixed
      ? [[EX.hlMvpWomen, rank(totals.filter((p) => p.gender === "F"))], [EX.hlMvpMen, rank(totals.filter((p) => p.gender === "M"))]]
      : [[EX.hlMvp, rank(totals)]];
    ensurePhotos([...new Set(groups.flatMap(([, l]) => l.map((p) => p.uid)).filter(Boolean))]);
    const mvp = groups.filter(([, l]) => l.length).map(([title, list]) => `
      <div class="hl-card">
        <div class="hl-card__title"><i class="bi bi-star-fill"></i>${esc(title)}</div>
        ${list.map((p, i) => `
          <div class="hl-row hl-row--${i + 1}">
            <span class="hl-pos">${i + 1}</span>
            ${avatarHtml({ name: p.name, photoURL: photos.get(p.uid) || "" }, 30)}
            <span class="hl-name">${esc(p.name)}<small>${esc(p.teamName || "")}</small></span>
            <span class="hl-val" title="${esc(EX.stMvpLong)}">${p.mvp}</span>
          </div>`).join("")}
        <button class="btn btn-link btn-sm p-0 mt-1" data-tab="stats">${esc(EX.hlSeeStats)} <i class="bi bi-chevron-right"></i></button>
      </div>`).join("");
    if (!podium && !mvp) return "";
    return `
      <section class="hl-block">
        ${multi ? `<h2 class="h6 mb-2">${esc(d.name)}</h2>` : ""}
        <div class="hl-grid">${podium}${mvp}</div>
      </section>`;
  }).join("");
  return blocks ? `<div class="mt-3">${blocks}</div>` : "";
}

// Descargar el torneo (partidos, posiciones, equipos, jugadores, espíritu)
const exportBar = () => `
  <div class="tn-export mt-4">
    <span class="small fw-semibold ev-muted"><i class="bi bi-download me-1"></i>${esc(EX.exDownload)}</span>
    <button class="btn btn-sm btn-outline-secondary" data-export="pdf"><i class="bi bi-file-earmark-pdf me-1"></i>${esc(EX.exPdf)}</button>
    <button class="btn btn-sm btn-outline-secondary" data-export="xlsx"><i class="bi bi-file-earmark-spreadsheet me-1"></i>${esc(EX.exExcel)}</button>
  </div>`;

function divisionPicker() {
  if (divisions().length < 2) return "";
  return `
    <div class="mb-3">
      <select class="form-select form-select-sm w-auto" id="evpDivision">
        ${divisions().map((d) => `<option value="${esc(d.id)}" ${d.id === state.division ? "selected" : ""}>${esc(d.name)}</option>`).join("")}
      </select>
    </div>`;
}

/* ---------- Posiciones (tabla tipo transmisión deportiva) ---------- */
// Últimos resultados de un equipo (más reciente al final): "W" / "L" / "E"
function recentResults(teamId, games, n = 5) {
  return games
    .filter((g) => g.status === GAME_STATUS.FINAL && (g.teamA?.id === teamId || g.teamB?.id === teamId))
    .sort((a, b) => toMillis(a.startAt) - toMillis(b.startAt))
    .slice(-n)
    .map((g) => {
      const us = g.teamA?.id === teamId ? g.scoreA || 0 : g.scoreB || 0;
      const them = g.teamA?.id === teamId ? g.scoreB || 0 : g.scoreA || 0;
      return us > them ? "W" : us < them ? "L" : "E";
    });
}

const streakDots = (res) => `<span class="st-streak">${res.map((r) => `<i class="st-dot st-dot--${r}" title="${esc(r === "W" ? EX.resWin : r === "L" ? EX.resLoss : EX.resTie)}">${esc(r === "W" ? "G" : r === "L" ? "P" : "E")}</i>`).join("") || "<span class=\"ev-muted\">—</span>"}</span>`;

function standingsTab() {
  const teams = state.teams.filter(inDivision(state.division));
  const games = state.games.filter(inDivision(state.division)).filter((g) => !g.phase); // fase de grupos
  const hasBracket = state.games.some((g) => inDivision(state.division)(g) && g.phase);
  const pools = [...new Set(teams.map((t) => (t.pool || "").toUpperCase()))].sort();
  const divName = divisions().find((d) => d.id === state.division)?.name || divisions()[0]?.name || "";
  const table = (pool) => {
    const ts = teams.filter((t) => (t.pool || "").toUpperCase() === pool);
    const ids = new Set(ts.map((t) => t.id));
    const poolGames = games.filter((g) => ids.has(g.teamA?.id) && ids.has(g.teamB?.id));
    const rows = standings(ts, poolGames);
    const played = poolGames.filter((g) => g.status === GAME_STATUS.FINAL).length;
    return `
      <section class="st-card">
        <header class="st-card__head">
          <div>
            <div class="st-card__title">${esc(pool ? exf(EX.phasePool, { pool }) : divName || EX.tabStandings)}</div>
            <div class="st-card__sub">${hasBracket ? `${esc(EX.standGroupStage)} · ` : ""}${esc(exf(EX.standGamesPlayed, { n: played, total: poolGames.length }))}</div>
          </div>
          ${state.event.status === "finished" ? "" : `<span class="st-live"><i class="bi bi-broadcast"></i> ${esc(EX.standUpdated)}</span>`}
        </header>
        <div class="table-responsive">
          <table class="st-table">
            <thead><tr>
              <th class="st-pos">#</th>
              <th class="st-team">${esc(EX.standTeam)}</th>
              <th class="num" title="${esc(EX.standPlayedLong)}">${esc(EX.standPlayed)}</th>
              <th class="num" title="${esc(EX.standWLong)}">${esc(EX.standW)}</th>
              <th class="num" title="${esc(EX.standLLong)}">${esc(EX.standL)}</th>
              <th class="num d-none d-md-table-cell" title="${esc(EX.standPctLong)}">${esc(EX.standPct)}</th>
              <th class="num d-none d-sm-table-cell" title="${esc(EX.standPFLong)}">${esc(EX.standPF)}</th>
              <th class="num d-none d-sm-table-cell" title="${esc(EX.standPALong)}">${esc(EX.standPA)}</th>
              <th class="num" title="${esc(EX.standDiffLong)}">${esc(EX.standDiff)}</th>
              <th class="d-none d-md-table-cell">${esc(EX.standStreak)}</th>
            </tr></thead>
            <tbody>${rows.map((r, i) => {
              const pct = r.played ? (r.w / r.played).toFixed(3).replace(/^0/, "") : ".000";
              return `
              <tr class="${i === 0 && r.played ? "is-leader" : ""}">
                <td class="st-pos"><span class="st-rank">${i + 1}</span></td>
                <td class="st-team">
                  <div class="d-flex align-items-center gap-2">
                    ${teamBadge(r.team, 30)}
                    <div class="min-w-0">
                      <div class="st-team__name">${esc(r.team.name)}</div>
                      ${r.team.city ? `<div class="st-team__sub d-none d-sm-block">${esc(r.team.city)}</div>` : ""}
                    </div>
                  </div>
                </td>
                <td class="num">${r.played}</td>
                <td class="num fw-bold">${r.w}</td>
                <td class="num">${r.l}</td>
                <td class="num d-none d-md-table-cell">${pct}</td>
                <td class="num d-none d-sm-table-cell">${r.pf}</td>
                <td class="num d-none d-sm-table-cell">${r.pa}</td>
                <td class="num"><span class="st-diff ${r.diff > 0 ? "is-pos" : r.diff < 0 ? "is-neg" : ""}">${r.diff > 0 ? "+" : ""}${r.diff}</span></td>
                <td class="d-none d-md-table-cell">${streakDots(recentResults(r.team.id, poolGames))}</td>
              </tr>`;
            }).join("")}
            </tbody>
          </table>
        </div>
      </section>`;
  };
  // puesto final después de la llave (ej. torneos importados): se muestra arriba de la tabla de grupos
  // puesto guardado (importados) o el que sale de los partidos por puesto (final, 3º, 5º…)
  const placeOf = finalPlaces(teams, state.games.filter(inDivision(state.division)));
  const placed = teams.filter((t) => placeOf.has(t.id)).map((t) => ({ ...t, finalPlace: placeOf.get(t.id) })).sort((a, b) => a.finalPlace - b.finalPlace);
  // récord de todo el torneo (grupos + llave) junto al puesto final
  const allGames = state.games.filter(inDivision(state.division)).filter((g) => g.status === GAME_STATUS.FINAL);
  const overall = new Map(standings(teams, allGames).map((r) => [r.team.id, r]));
  const recordOf = (t) => {
    const r = overall.get(t.id);
    if (!r?.played) return "";
    return `<div class="st-final__rec" title="${esc(EX.standOverall)}">${r.w}-${r.l}</div>`;
  };
  const finalCard = placed.length ? `
    <section class="st-card">
      <header class="st-card__head"><div><div class="st-card__title">${esc(EX.finalStandings)}</div><div class="st-card__sub">${esc(divName)}</div></div></header>
      <div class="st-final">${placed.map((t) => `
        <div class="st-final__row ${t.finalPlace <= 3 ? `is-top is-top-${t.finalPlace}` : ""}">
          <span class="st-final__pos">${t.finalPlace}</span>
          ${teamBadge(t, 28)}
          <div class="min-w-0"><div class="st-team__name text-truncate">${esc(t.name)}</div>${t.city ? `<div class="st-team__sub">${esc(t.city)}</div>` : ""}</div>
          ${recordOf(t)}
        </div>`).join("")}
      </div>
    </section>` : "";
  return `
    <div class="sb-toolbar">${divisionPicker()}</div>
    ${finalCard}
    ${teams.length ? pools.map(table).join("") : `<div class="ev-card ev-muted">${esc(EX.noStats)}</div>`}
    ${teams.length ? `<div class="st-legend">${esc(EX.standLegend)}</div>` : ""}`;
}

// Fotos de perfil de los jugadores con cuenta (perfil público), se cargan una vez y se repinta
const photos = new Map();
let photosLoading = false;
function ensurePhotos(uids) {
  const missing = uids.filter((u) => u && !photos.has(u));
  if (!missing.length || photosLoading) return;
  photosLoading = true;
  Promise.all(missing.map(async (u) => photos.set(u, (await loadProfile(u).catch(() => null))?.photoURL || "")))
    .finally(() => {
      photosLoading = false;
      if (state.tab === "stats" || state.tab === "overview") render();
    });
}

function statsTab() {
  const teams = state.teams.filter(inDivision(state.division));
  const teamIds = new Set(teams.map((t) => t.id));
  const teamById = new Map(teams.map((t) => [t.id, t]));
  const games = state.games.filter((g) => g.status !== GAME_STATUS.SCHEDULED && (teamIds.has(g.teamA?.id) || teamIds.has(g.teamB?.id)));
  const totals = playerTotals(games, teams, state.rules).filter((p) => p.teamId && teamIds.has(p.teamId));
  if (!totals.length) return `<div class="sb-toolbar">${divisionPicker()}</div><div class="ev-card ev-muted">${esc(EX.noStats)}</div>`;
  ensurePhotos([...new Set(totals.map((p) => p.uid).filter(Boolean))]);
  const person = (p) => ({ name: p.name, photoURL: photos.get(p.uid) || "" });
  const sub = (p) => `${teamBadge(teamById.get(p.teamId) || { name: p.teamName }, 16)}<span class="text-truncate">${esc(p.teamName || "")}</span>`;
  const link = (p, inner) => (p.uid ? `<a class="text-reset text-decoration-none" href="/tournaments/profile.html?u=${encodeURIComponent(p.uid)}">${inner}</a>` : inner);

  // ranking general por puntaje MVP (desempate: goles, asistencias, nombre)
  const ranked = totals.slice().sort((a, b) => (b.mvp || 0) - (a.mvp || 0) || (b.goals || 0) - (a.goals || 0) || (b.assists || 0) - (a.assists || 0) || String(a.name).localeCompare(String(b.name)));
  const rankOf = new Map(ranked.map((p, i) => [p.id, i + 1]));
  const toggle = `
    <div class="pa-seg">
      <button type="button" class="btn ${state.statsView !== "all" ? "is-on" : ""}" data-sview="leaders"><i class="bi bi-trophy me-1"></i>${esc(EX.stLeaders)}</button>
      <button type="button" class="btn ${state.statsView === "all" ? "is-on" : ""}" data-sview="all"><i class="bi bi-list-ol me-1"></i>${esc(EX.stAllPlayers)}</button>
    </div>`;
  const head = `<div class="sb-toolbar d-flex flex-wrap gap-2 align-items-center justify-content-between">${divisionPicker()}${toggle}</div>`;
  if (state.statsView === "all") return head + allPlayersTable(ranked, rankOf, teamById, person, link);

  // MVP: 5 tarjetas por página; el mejor de la página al centro (4 · 2 · 1 · 3 · 5)
  const PER = 5;
  const pages = Math.max(1, Math.ceil(ranked.length / PER));
  const page = Math.min(state.mvpPage || 0, pages - 1);
  const chip = (label, v) => `<span class="mv-chip"><span>${esc(label)}</span><b>${v || 0}</b></span>`;
  const card = (p, i) => {
    const rank = rankOf.get(p.id);
    const cls = rank === 1 ? "is-first" : rank === 2 ? "is-second" : i === 0 ? "is-best" : "";
    return `
      <article class="mv-card ${cls} mv-pos-${i}">
        ${rank === 1 ? `<span class="mv-crown"><i class="bi bi-trophy-fill"></i></span>` : ""}
        <div class="mv-photo">${link(p, avatarHtml(person(p), i === 0 ? 84 : 68))}</div>
        <div class="mv-name">${link(p, esc(p.name || "—"))}</div>
        <div class="mv-team">${esc(p.teamName || "")}</div>
        <div class="mv-rank">#${rank}</div>
        <div class="mv-label">${esc(EX.stStats)}</div>
        <div class="mv-chips">${chip(EX.heroGoals, p.goals)}${chip(EX.stAssistShort, p.assists)}${chip(EX.stBlockShort, p.blocks)}<span class="mv-chip mv-chip--total" title="${esc(EX.stMvpLong)}"><span>${esc(EX.stTotalShort)}</span><b>${p.mvp || 0}</b></span></div>
      </article>`;
  };
  const first = Math.max(0, Math.min(page - 2, pages - 5));
  const nums = Array.from({ length: Math.min(5, pages) }, (_, i) => first + i);
  const mvpPanel = `
    <section class="mv-panel">
      <header class="mv-head"><h3>${esc(EX.leaderMvp)}</h3><span>${esc(exf(EX.stPageOf, { n: page + 1, total: pages }))}</span></header>
      <div class="mv-row">${ranked.slice(page * PER, page * PER + PER).map(card).join("")}</div>
      ${pages > 1 ? `
        <nav class="mv-pager">
          <button type="button" data-mvp-page="${page - 1}" ${page === 0 ? "disabled" : ""} aria-label="${esc(EX.stPrev)}"><i class="bi bi-chevron-left"></i></button>
          ${nums.map((n) => `<button type="button" class="${n === page ? "is-on" : ""}" data-mvp-page="${n}">${n + 1}</button>`).join("")}
          <button type="button" data-mvp-page="${page + 1}" ${page >= pages - 1 ? "disabled" : ""} aria-label="${esc(EX.stNext)}"><i class="bi bi-chevron-right"></i></button>
        </nav>` : ""}
    </section>`;

  // Líderes por categoría: el primero destacado y el top 5 debajo
  const board = (title, key, icon) => {
    const rows = leaders(totals, key, 5).filter((p) => (p[key] || 0) > 0);
    if (!rows.length) return "";
    const [top, ...rest] = rows;
    return `
      <section class="lb-card">
        <h3 class="lb-card__title"><i class="bi bi-${icon}"></i>${esc(title)}</h3>
        <div class="lb-top">
          ${link(top, avatarHtml(person(top), 56))}
          <div class="min-w-0 flex-grow-1">
            <div class="lb-top__name text-truncate">${link(top, esc(playerLabel(top)))}</div>
            <div class="lb-team">${sub(top)}</div>
          </div>
          <div class="lb-top__val">${top[key]}</div>
        </div>
        ${rest.map((p, i) => `
          <div class="lb-row">
            <span class="lb-row__pos">${i + 2}</span>
            ${link(p, avatarHtml(person(p), 32))}
            <div class="min-w-0 flex-grow-1">
              <div class="lb-row__name text-truncate">${link(p, esc(playerLabel(p)))}</div>
              <div class="lb-team">${sub(p)}</div>
            </div>
            <span class="lb-row__val">${p[key]}</span>
          </div>`).join("")}
      </section>`;
  };

  // las pérdidas no se muestran como "líderes" (nadie quiere ganar esa)
  return `
    ${head}
    ${mvpPanel}
    <div class="lb-grid">
      ${board(EX.leaderMvp, "mvp", "star-fill")}
      ${board(EX.leaderGoals, "goals", "bullseye")}
      ${board(EX.leaderAssists, "assists", "send-fill")}
      ${board(EX.leaderBlocks, "blocks", "shield-fill")}
    </div>
    <div class="text-center mt-3"><button type="button" class="btn btn-outline-dark btn-sm" data-sview="all"><i class="bi bi-list-ol me-1"></i>${esc(EX.stSeeAll)}</button></div>
    <div class="small ev-muted mt-2 text-center">${esc(EX.mvpHint)}</div>`;
}

// Todos los jugadores del torneo: buscar, filtrar por equipo y ordenar por columna
const STAT_COLS = [["games", "stGP"], ["goals", "stG"], ["assists", "stA"], ["blocks", "stB"], ["turns", "stT"], ["callahans", "stC"], ["mvp", "stMvp"]];
function allPlayersTable(ranked, rankOf, teamById, person, link) {
  const q = (state.statsQ || "").trim().toLowerCase();
  const key = state.statsSort || "mvp";
  const teamsIn = [...new Map(ranked.map((p) => [p.teamId, teamById.get(p.teamId) || { id: p.teamId, name: p.teamName }])).values()]
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));
  const rows = ranked
    .filter((p) => (!state.statsTeam || p.teamId === state.statsTeam) && (!q || `${p.name} ${p.teamName} ${p.number ?? ""}`.toLowerCase().includes(q)))
    .sort((a, b) => (key === "name" ? String(a.name).localeCompare(String(b.name)) : (b[key] || 0) - (a[key] || 0) || rankOf.get(a.id) - rankOf.get(b.id)));
  const th = (k, label, cls = "num") => `<th class="${cls} st-sort ${key === k ? "is-on" : ""}" data-ssort="${k}" title="${esc(EX[`${label}Long`] || EX[label])}">${esc(EX[label])}${key === k ? ' <i class="bi bi-caret-down-fill"></i>' : ""}</th>`;
  return `
    <section class="st-card">
      <header class="st-card__head flex-wrap">
        <div><div class="st-card__title">${esc(EX.stAllPlayers)}</div><div class="st-card__sub">${esc(exf(EX.stCount, { n: rows.length }))}</div></div>
        <div class="d-flex flex-wrap gap-2">
          <input class="form-control form-control-sm st-search" id="stQ" type="search" placeholder="${esc(EX.stSearch)}" value="${esc(state.statsQ || "")}" />
          <select class="form-select form-select-sm w-auto" id="stTeam">
            <option value="">${esc(EX.stAllTeams)}</option>
            ${teamsIn.map((t) => `<option value="${esc(t.id)}" ${t.id === state.statsTeam ? "selected" : ""}>${esc(t.name)}</option>`).join("")}
          </select>
        </div>
      </header>
      <div class="table-responsive">
        <table class="st-table st-all">
          <thead><tr><th class="st-pos">#</th>${th("name", "stPlayer", "st-team")}${STAT_COLS.map(([k, l]) => th(k, l)).join("")}</tr></thead>
          <tbody>${rows.map((p) => `
            <tr>
              <td class="st-pos"><span class="st-rank">${rankOf.get(p.id)}</span></td>
              <td class="st-team">
                <div class="d-flex align-items-center gap-2 min-w-0">
                  ${link(p, avatarHtml(person(p), 30))}
                  <div class="min-w-0">
                    <div class="st-team__name">${link(p, esc(playerLabel(p)))}</div>
                    <div class="lb-team">${teamBadge(teamById.get(p.teamId) || { name: p.teamName }, 14)}<span class="text-truncate">${esc(p.teamName || "")}</span></div>
                  </div>
                </div>
              </td>
              ${STAT_COLS.map(([k]) => `<td class="num ${k === key ? "fw-bold" : ""}">${p[k] || 0}</td>`).join("")}
            </tr>`).join("") || `<tr><td colspan="${STAT_COLS.length + 2}" class="text-center ev-muted py-3">${esc(EX.stNoMatch)}</td></tr>`}
          </tbody>
        </table>
      </div>
    </section>
    <div class="small ev-muted mt-2">${esc(EX.mvpHint)}</div>`;
}

function teamsTab() {
  const teams = state.teams.filter(inDivision(state.division));
  return `
    ${divisionPicker()}
    <div class="row g-3">
      ${teams.map((t) => {
        // con equipo en ClubStudioHQ: abre su página (jugadores, torneos, resultados)
        const href = t.squadId ? `/tournaments/club.html?s=${encodeURIComponent(t.squadId)}` : "";
        const tag = href ? "a" : "div";
        return `
        <div class="col-12 col-md-6">
          <${tag} class="ev-card ev-team-card h-100 ${href ? "is-link" : ""}" ${href ? `href="${esc(href)}"` : ""}>
            <div class="d-flex align-items-center gap-2">
              ${teamBadge(t, 40)}
              <div class="min-w-0 flex-grow-1">
                <div class="fw-bold text-truncate">${esc(t.name)}</div>
                <div class="small ev-muted">${esc([t.city, t.pool ? exf(EX.phasePool, { pool: t.pool }) : ""].filter(Boolean).join(" · "))}${t.city || t.pool ? " · " : ""}${esc(exf(EX.playersSummary, {
                  n: (t.players || []).length,
                  f: (t.players || []).filter((p) => p.gender === "F").length,
                  m: (t.players || []).filter((p) => p.gender === "M").length,
                }))}</div>
              </div>
              ${href ? `<i class="bi bi-chevron-right ev-muted"></i>` : ""}
            </div>
            ${t.hat && (t.players || []).length ? `
              <div class="small mt-2 ev-team-roster">${(t.players || []).map((p) => {
                const num = p.number !== null && p.number !== undefined && p.number !== "" ? ` <span class="ev-muted">#${esc(p.number)}</span>` : "";
                const me = state.user?.uid && p.uid === state.user.uid ? "fw-bold" : "";
                // con cuenta: abre su perfil (estadísticas de todos sus torneos)
                return p.uid && !href
                  ? `<a class="ev-roster-link ${me}" href="/tournaments/profile.html?u=${encodeURIComponent(p.uid)}" title="${esc(EX.rosterSeeProfile)}">${esc(p.name)}</a>${num}`
                  : `<span class="${me}">${esc(p.name)}${num}</span>`;
              }).join(" · ")}</div>` : ""}
          </${tag}>
        </div>`;
      }).join("") || `<div class="col-12"><div class="ev-card ev-muted">${esc(EX.noTeams)}</div></div>`}
    </div>`;
}

/* ---------- Partidos (marcadores tipo transmisión deportiva) ---------- */
const dayKey = (v) => {
  const ms = toMillis(v);
  if (!ms) return "";
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

// Récord G-P de cada equipo (partidos finalizados)
function teamRecords(games) {
  const rec = new Map();
  const add = (id, k) => {
    const r = rec.get(id) || { w: 0, l: 0 };
    r[k] += 1;
    rec.set(id, r);
  };
  games.filter((g) => g.status === GAME_STATUS.FINAL).forEach((g) => {
    const a = g.scoreA || 0;
    const b = g.scoreB || 0;
    if (a > b) { add(g.teamA?.id, "w"); add(g.teamB?.id, "l"); }
    if (b > a) { add(g.teamB?.id, "w"); add(g.teamA?.id, "l"); }
  });
  return rec;
}

function scoreCard(game, records) {
  const g = withLiveTeams(game, state.teams);
  const live = g.status === GAME_STATUS.LIVE;
  const final = g.status === GAME_STATUS.FINAL;
  const started = live || final;
  const a = g.scoreA || 0;
  const b = g.scoreB || 0;
  const status = live
    ? `<span class="sb-pill sb-pill--live"><i></i>${esc(EX.gameLive)}</span>`
    : final
      ? `<span class="sb-pill sb-pill--final"><i class="bi bi-check2"></i>${esc(EX.gameEnded)}</span>`
      : `<span class="sb-pill">${esc(fmtTimeOnly(g.startAt) || EX.vs)}</span>`;
  const team = (t, score, other) => {
    const r = records.get(t?.id);
    const cls = final ? (score > other ? "is-winner" : score < other ? "is-loser" : "") : "";
    return `
      <div class="sb-team ${cls}">
        ${teamBadge(t || {}, 36)}
        <div class="sb-team__info">
          <div class="sb-team__name">${esc(t?.name || "—")}</div>
          ${r ? `<div class="sb-team__rec">${r.w}-${r.l}</div>` : ""}
        </div>
        <div class="sb-team__score">${started ? score : ""}${final && score > other ? `<i class="bi bi-caret-left-fill sb-win-mark"></i>` : ""}</div>
      </div>`;
  };
  return `
    <a class="sb-card ${live ? "is-live" : ""}" href="${esc(gameUrl(state.event.id, g.id))}">
      <div class="sb-card__head">
        ${status}
        <span class="sb-card__meta">${esc([g.field, phaseLabel(g)].filter(Boolean).join(" · "))}</span>
      </div>
      ${team(g.teamA, a, b)}
      ${team(g.teamB, b, a)}
      <div class="sb-card__foot">${esc(live ? EX.sbFollow : final ? EX.sbRecap : EX.sbPreview)} <i class="bi bi-chevron-right"></i></div>
    </a>`;
}

function gamesTab() {
  const all = state.games.filter(inDivision(state.division));
  if (!all.length) return `<div class="sb-toolbar">${divisionPicker()}</div><div class="ev-card ev-muted">${esc(EX.noGames)}</div>`;
  const records = teamRecords(all);

  // días con partidos
  const days = [...new Set(all.map((g) => dayKey(g.startAt)).filter(Boolean))].sort();
  if (state.gameDay && !days.includes(state.gameDay)) state.gameDay = "";
  const byStatus = (s) => all.filter((g) => (s === "all" ? true : s === "upcoming" ? g.status === GAME_STATUS.SCHEDULED || !g.status : g.status === s));
  const filters = [
    ["all", EX.filterAll, all.length],
    [GAME_STATUS.LIVE, EX.filterLive, byStatus(GAME_STATUS.LIVE).length],
    ["upcoming", EX.filterUpcoming, byStatus("upcoming").length],
    [GAME_STATUS.FINAL, EX.filterFinal, byStatus(GAME_STATUS.FINAL).length],
  ];
  const games = byStatus(state.gameFilter)
    .filter((g) => !state.gameDay || dayKey(g.startAt) === state.gameDay)
    .sort((x, y) => toMillis(x.startAt) - toMillis(y.startAt));

  const grouped = new Map();
  games.forEach((g) => {
    const k = dayKey(g.startAt);
    if (!grouped.has(k)) grouped.set(k, []);
    grouped.get(k).push(g);
  });

  const dayLabel = (k) => {
    const sample = all.find((g) => dayKey(g.startAt) === k);
    return sample ? fmtWhen(sample.startAt, { weekday: "short", day: "numeric", month: "short" }) : EX.noSchedule;
  };

  // vista por hora: canchas en columnas, horas en filas (un día a la vez)
  const viewToggle = `
    <div class="sb-filters sb-view" role="tablist" aria-label="${esc(EX.schedViewGrid)}">
      <button class="sb-filter ${state.gamesView === "list" ? "is-active" : ""}" data-gview="list"><i class="bi bi-list-ul me-1"></i>${esc(EX.schedViewList)}</button>
      <button class="sb-filter ${state.gamesView === "grid" ? "is-active" : ""}" data-gview="grid"><i class="bi bi-calendar3-week me-1"></i>${esc(EX.schedViewGrid)}</button>
    </div>`;
  const calButton = `<button class="btn btn-sm btn-outline-primary" data-ics="all"><i class="bi bi-calendar-plus me-1"></i>${esc(EX.icsAll)}</button>`;
  if (state.gamesView === "grid") {
    const gdays = scheduleDays(all, state.event);
    const gday = gdays.includes(state.gameDay) ? state.gameDay : gdays[0] || "";
    return `
      <div class="sb-toolbar">${divisionPicker()}${viewToggle}${calButton}</div>
      ${gdays.length ? `<div class="sb-days">${gdays.map((k) => `<button class="sb-day ${gday === k ? "is-active" : ""}" data-gday="${k}">${esc(fmtWhen(atMinutes(k, 720), { weekday: "short", day: "numeric", month: "short" }))}<span>${all.filter((g) => dayKey(g.startAt) === k).length}</span></button>`).join("")}</div>` : ""}
      ${gday ? scheduleGridHtml({ games: all, fields: state.event.fields || [], day: gday, stepMin: slotMinutes(state.rules), href: (g) => gameUrl(state.event.id, g.id) }) : `<div class="ev-card ev-muted">${esc(EX.noSchedule)}</div>`}`;
  }
  return `
    <div class="sb-toolbar">
      ${divisionPicker()}
      ${viewToggle}
      ${calButton}
      <div class="sb-filters" role="tablist">
        ${filters.map(([id, label, n]) => `<button class="sb-filter ${state.gameFilter === id ? "is-active" : ""} ${id === GAME_STATUS.LIVE && n ? "has-live" : ""}" data-gfilter="${id}">${id === GAME_STATUS.LIVE && n ? "<i class=\"sb-live-dot\"></i>" : ""}${esc(label)} <span>${n}</span></button>`).join("")}
      </div>
    </div>
    ${days.length > 1 ? `
      <div class="sb-days">
        <button class="sb-day sb-day--all ${!state.gameDay ? "is-active" : ""}" data-gday="">${esc(EX.allDays)}</button>
        ${days.map((k) => `<button class="sb-day ${state.gameDay === k ? "is-active" : ""}" data-gday="${k}">${esc(dayLabel(k))}<span>${all.filter((g) => dayKey(g.startAt) === k).length}</span></button>`).join("")}
      </div>` : ""}
    ${games.length ? [...grouped.entries()].map(([k, list]) => `
      <div class="tn-day-title">${esc(k ? fmtDayOnly(list[0].startAt).replace(/^./, (c) => c.toUpperCase()) : EX.noSchedule)}</div>
      <div class="row g-3">${list.map((g) => `<div class="col-12 col-md-6 col-xl-4">${scoreCard(g, records)}</div>`).join("")}</div>`).join("")
      : `<div class="ev-card ev-muted text-center">${esc(EX.sbNoGamesFilter)}</div>`}`;
}

function spiritTab() {
  const teams = state.teams.filter(inDivision(state.division));
  const rows = spiritTable(teams, state.games).filter((r) => r.count > 0);
  if (!rows.length) return `<div class="sb-toolbar">${divisionPicker()}</div><div class="ev-card ev-muted">${esc(EX.noStats)}</div>`;
  const short = { rules: "R", fouls: "F", fair: "I", attitude: "A", comm: "C" };
  const titles = { rules: EX.spiritRules, fouls: EX.spiritFouls, fair: EX.spiritFair, attitude: EX.spiritAttitude, comm: EX.spiritComm };
  const divName = divisions().find((d) => d.id === state.division)?.name || divisions()[0]?.name || "";
  const reviews = rows.reduce((n, r) => n + r.count, 0);
  // mismo formato que Posiciones: tarjeta con encabezado, tabla y leyenda
  return `
    <div class="sb-toolbar">${divisionPicker()}</div>
    <section class="st-card">
      <header class="st-card__head">
        <div>
          <div class="st-card__title">${esc(divName ? `${EX.tabSpirit} · ${divName}` : EX.tabSpirit)}</div>
          <div class="st-card__sub">${esc(reviews === 1 ? EX.spOneReview : exf(EX.spReviews, { n: reviews }))}</div>
        </div>
        <span class="st-live"><i class="bi bi-heart-fill"></i> WFDF</span>
      </header>
      <div class="table-responsive">
        <table class="st-table">
          <thead><tr>
            <th class="st-pos">#</th>
            <th class="st-team">${esc(EX.standTeam)}</th>
            <th class="num" title="${esc(EX.spiritAvgLong)}">${esc(EX.spiritAvgShort)}</th>
            ${SPIRIT_KEYS.map((k) => `<th class="num d-none d-sm-table-cell" title="${esc(titles[k])}">${short[k]}</th>`).join("")}
            <th class="num" title="${esc(EX.spiritCount)}">${esc(EX.spiritCountShort)}</th>
          </tr></thead>
          <tbody>${rows.map((r, i) => `
            <tr class="${i === 0 ? "is-leader" : ""}">
              <td class="st-pos"><span class="st-rank">${i + 1}</span></td>
              <td class="st-team">
                <div class="d-flex align-items-center gap-2">
                  ${teamBadge(r.team, 30)}
                  <div class="min-w-0">
                    <div class="st-team__name">${esc(r.team.name)}</div>
                    ${r.team.city ? `<div class="st-team__sub d-none d-sm-block">${esc(r.team.city)}</div>` : ""}
                  </div>
                </div>
              </td>
              <td class="num"><span class="st-spirit ${r.avg >= 12 ? "is-high" : r.avg < 8 ? "is-low" : ""}">${r.avg.toFixed(1)}</span></td>
              ${SPIRIT_KEYS.map((k) => `<td class="num d-none d-sm-table-cell">${r.catAvg[k].toFixed(1)}</td>`).join("")}
              <td class="num">${r.count}</td>
            </tr>`).join("")}
          </tbody>
        </table>
      </div>
    </section>
    <div class="st-legend">${esc(EX.spLegendIntro)} ${SPIRIT_KEYS.map((k) => `${short[k]}: ${esc(titles[k])}`).join(" · ")}</div>`;
}

/* =========================
   Render
========================= */
const TABS = [
  ["overview", () => EX.tabOverview, overview],
  ["standings", () => EX.tabStandings, standingsTab],
  ["bracket", () => EX.tabBracket, bracketTab],
  ["stats", () => EX.tabStats, statsTab],
  ["games", () => EX.tabGamesPublic, gamesTab],
  ["teams", () => EX.tabTeamsPublic, teamsTab],
  ["spirit", () => EX.tabSpirit, spiritTab],
];

// "Llave" solo si el torneo tiene partidos de llave
const visibleTabs = () => TABS.filter(([id]) => id !== "bracket" || hasBracket(state.games));

function bracketTab() {
  const teams = state.teams.filter(inDivision(state.division));
  const games = state.games.filter(inDivision(state.division));
  const divName = divisions().find((d) => d.id === state.division)?.name || divisions()[0]?.name || "";
  return `
    <div class="sb-toolbar">${divisionPicker()}</div>
    ${bracketHtml({ teams, games, title: divName, section: state.bkSection, href: (g) => gameUrl(state.event.id, g.id) })}`;
}

function render() {
  const e = state.event;
  const tabs = visibleTabs();
  const tab = tabs.find((t) => t[0] === state.tab) || tabs[0];
  document.title = e.name || EX.appTitle;
  $("tnRoot").innerHTML = `
    <section class="ev-hero mb-3 ${e.image ? "ev-hero--image" : ""}" ${e.image ? `style="background: linear-gradient(to top, rgba(20, 8, 45, .92) 0%, rgba(20, 8, 45, .35) 55%, rgba(20, 8, 45, .1) 100%), url('${esc(e.image)}')"` : ""}>
      <div class="ev-hero__title">
        ${e.logo ? `<img class="ev-hero__logo" src="${esc(e.logo)}" alt="" />` : ""}
        <h1>${esc(e.name || "")}</h1>
      </div>
      <div class="ev-hero__meta">
        ${e.startDate ? `<span><i class="bi bi-calendar-event"></i> ${esc(fmtDateRange(e.startDate, e.endDate))}</span>` : ""}
        ${e.venue ? `<span><i class="bi bi-geo-alt"></i> ${esc(e.venue)}</span>` : ""}
        ${SURFACES.includes(e.surface) ? `<span><i class="bi ${SURFACE_ICONS[e.surface]}"></i> ${esc(EX[`surface_${e.surface}`])}</span>` : ""}
        ${e.country ? `<span>${flagOf(e.country)} ${esc(countryName(e.country))}</span>` : ""}
        ${e.mapsUrl ? `<a class="text-white" href="${esc(e.mapsUrl)}" target="_blank" rel="noopener"><i class="bi bi-map"></i></a>` : ""}
      </div>
      ${myRegistrationHtml()}
      ${waiverBanner()}
    </section>
    <ul class="nav nav-pills mb-3 ev-tabs">
      ${tabs.map(([id, label]) => `<li class="nav-item"><button class="nav-link ${tab[0] === id ? "active" : ""}" data-tab="${id}">${esc(label())}</button></li>`).join("")}
    </ul>
    <div id="evpTab">${tab[2]()}</div>`;
  revealActiveTab(document.querySelector(".ev-tabs"));
}

$("tnRoot").addEventListener("click", async (ev) => {
  const hl = ev.target.closest("[data-hat-leave]");
  if (hl) {
    if (!confirm(EX.hatLeaveConfirm)) return;
    showLoader();
    try {
      await leaveHat(state.event.id, hl.dataset.hatLeave);
      state.myHat = (state.myHat || []).filter((m) => m.id !== hl.dataset.hatLeave);
      render();
    } catch (err) {
      console.error(err);
      alert(EX.error);
    } finally {
      hideLoader();
    }
    return;
  }
  const wd = ev.target.closest("[data-withdraw]");
  if (wd) {
    if (!confirm(EX.regWithdrawConfirm)) return;
    showLoader();
    try {
      await withdrawRegistration(state.event.id, wd.dataset.withdraw, wd.dataset.squad);
      state.myRegs = state.myRegs.filter((x) => x.reg.id !== wd.dataset.withdraw);
      render();
    } catch (err) {
      console.error(err);
      alert(EX.error);
    } finally {
      hideLoader();
    }
    return;
  }
  const sv = ev.target.closest("[data-sview]");
  if (sv) {
    state.statsView = sv.dataset.sview;
    return render();
  }
  const mp = ev.target.closest("[data-mvp-page]");
  if (mp) {
    state.mvpPage = Math.max(0, Number(mp.dataset.mvpPage) || 0);
    return render();
  }
  const ss = ev.target.closest("[data-ssort]");
  if (ss) {
    state.statsSort = ss.dataset.ssort;
    return render();
  }
  const gf = ev.target.closest("[data-gfilter]");
  if (gf) {
    state.gameFilter = gf.dataset.gfilter;
    return render();
  }
  const ex = ev.target.closest("[data-export]");
  if (ex) {
    showLoader();
    try {
      const m = await import("/tournaments/js/export.js");
      await (ex.dataset.export === "pdf" ? m.exportPdf : m.exportExcel)(state.event, state.teams, state.games);
    } catch (err) {
      console.error("[export]", err);
    } finally {
      hideLoader();
    }
    return;
  }
    const gv = ev.target.closest("[data-gview]");
  if (gv) {
    state.gamesView = gv.dataset.gview;
    return render();
  }
  const ics = ev.target.closest("[data-ics]");
  if (ics) {
    const games = state.games.filter(inDivision(state.division)).filter((g) => toMillis(g.startAt));
    return downloadIcs(games, state.event, `${state.event.slug || "torneo"}.ics`);
  }
  const bks = ev.target.closest("[data-bk-section]");
  if (bks) {
    state.bkSection = bks.dataset.bkSection;
    return render();
  }
  const gd = ev.target.closest("[data-gday]");
  if (gd) {
    state.gameDay = gd.dataset.gday;
    return render();
  }
  const btn = ev.target.closest("[data-tab]");
  if (!btn) return;
  state.tab = btn.dataset.tab;
  history.replaceState(null, "", `#${state.tab}`);
  render();
});

$("tnRoot").addEventListener("change", (ev) => {
  if (ev.target.id === "stTeam") {
    state.statsTeam = ev.target.value;
    return render();
  }
  if (ev.target.id !== "evpDivision") return;
  state.division = ev.target.value;
  state.mvpPage = 0;
  state.statsTeam = "";
  render();
});

// buscador de la tabla de jugadores: repinta y deja el cursor donde estaba
$("tnRoot").addEventListener("input", (ev) => {
  if (ev.target.id !== "stQ") return;
  state.statsQ = ev.target.value;
  const pos = ev.target.selectionStart;
  render();
  const input = document.getElementById("stQ");
  input?.focus();
  input?.setSelectionRange(pos, pos);
});

(async function init() {
  showLoader();
  try {
    const user = await waitForUser();
    state.user = isGoogleUser(user) ? user : null;
    renderNav({ active: "dir", user });
    // público por link; el organizador también puede verlo antes de publicarlo (por id)
    const event = (await loadPublicEventBySlug(KEY).catch(() => null)) || (await loadEvent(KEY).catch(() => null));
    if (!event) {
      $("tnAlert").className = "alert alert-warning";
      $("tnAlert").textContent = EX.eventNotFound;
      return;
    }
    state.event = event;
    state.rules = eventRules(event);
    state.division = divisions().length > 1 ? divisions()[0].id : "";
    state.teams = await listTeams(event.id);
    render();
    // formulario: ¿ya firmé? (público: solo dice quién firmó)
    if (state.user && waiverOn(event)) {
      listWaiverStatus(event.id).then((ws) => {
        state.waivers = new Map(ws.map((w) => [w.uid, w]));
        render();
      }).catch(() => {});
    }
    // estado de mi inscripción (no bloquea la página)
    // hat: mi ficha en el pool
    if (state.user && isHatEvent(event)) {
      listMyHatEntries(event.id, state.user.uid).then((mine) => {
        state.myHat = mine;
        render();
      }).catch(() => {
        state.myHat = [];
        render();
      });
    }
    if (state.user && !isHatEvent(event)) {
      myRegistrationsFor(state.user, event.id).then((regs) => {
        state.myRegs = regs;
        if (regs.length) render();
      }).catch(() => {});
    }
    let firstLoad = true;
    subscribeGames(event.id, (games) => {
      state.games = games;
      if (firstLoad) {
        firstLoad = false;
        const today = dayKey(Date.now());
        if (games.some((g) => dayKey(g.startAt) === today)) state.gameDay = today;
      }
      render();
    });
  } catch (err) {
    console.error("[event_view]", err);
    $("tnAlert").className = "alert alert-warning";
      $("tnAlert").textContent = EX.error;
  } finally {
    hideLoader();
  }
})();
