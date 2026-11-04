// /tournaments/js/export.js
// Exportar el torneo a Excel (una hoja por sección) y a PDF (tablas): partidos, posiciones, equipos,
// jugadores y espíritu. Las librerías se cargan solo cuando alguien toca "Descargar".
import { EX } from "/tournaments/js/strings.js";
import { GAME_STATUS, SPIRIT_KEYS, eventRules, playerTotals, spiritTable, standings } from "/tournaments/js/model.js";
import { phaseLabel, playerLabel, toMillis } from "/tournaments/js/ui.js";

const LIBS = {
  xlsx: "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js",
  jspdf: "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js",
  autotable: "https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js",
};

const loaded = new Map();
function loadScript(src) {
  if (!loaded.has(src)) {
    loaded.set(src, new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error(`No se pudo cargar ${src}`));
      document.head.appendChild(s);
    }));
  }
  return loaded.get(src);
}

const fmtDate = (v) => (toMillis(v) ? new Date(toMillis(v)).toLocaleDateString("es", { weekday: "short", day: "numeric", month: "short" }) : "");
const fmtTime = (v) => (toMillis(v) ? new Date(toMillis(v)).toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" }) : "");
const statusText = (g) => (g.status === GAME_STATUS.FINAL ? EX.gameFinal : g.status === GAME_STATUS.LIVE ? EX.gameLive : EX.exScheduled);

/**
 * Arma todas las tablas del torneo (mismo contenido para Excel y PDF).
 * @returns {{ title: string, sheets: { name: string, head: string[], rows: (string|number)[][] }[] }}
 */
export function tournamentTables(event, teams = [], games = []) {
  const rules = eventRules(event);
  const divisions = event.divisions?.length ? event.divisions : [{ id: "", name: "" }];
  const divName = (id) => (divisions.length > 1 ? divisions.find((d) => d.id === id)?.name || "" : "");
  const byDiv = (list, d) => list.filter((x) => (x.divisionId || divisions[0].id) === d.id);

  const gamesSheet = {
    name: EX.exGames,
    head: [EX.exDate, EX.exTime, EX.field, EX.exDivision, EX.phase, EX.teamA, EX.exScore, EX.teamB, EX.exStatus],
    rows: games.slice().sort((a, b) => toMillis(a.startAt) - toMillis(b.startAt)).map((g) => [
      fmtDate(g.startAt), fmtTime(g.startAt), g.field || "", divName(g.divisionId), phaseLabel(g),
      g.teamA?.name || "", g.status === GAME_STATUS.SCHEDULED ? "" : `${g.scoreA || 0}-${g.scoreB || 0}`, g.teamB?.name || "", statusText(g),
    ]),
  };

  const standRows = [];
  divisions.forEach((d) => {
    const ts = byDiv(teams, d);
    const pools = [...new Set(ts.map((t) => (t.pool || "").toUpperCase()))].sort();
    pools.forEach((pool) => {
      const pts = ts.filter((t) => (t.pool || "").toUpperCase() === pool);
      const ids = new Set(pts.map((t) => t.id));
      const pg = byDiv(games, d).filter((g) => !g.phase && ids.has(g.teamA?.id) && ids.has(g.teamB?.id));
      standings(pts, pg).forEach((r, i) => standRows.push([divName(d.id), pool, i + 1, r.team.name, r.played, r.w, r.l, r.pf, r.pa, r.diff]));
    });
  });
  const standSheet = { name: EX.exStandings, head: [EX.exDivision, EX.teamPool, "#", EX.standTeam, EX.standPlayed, EX.standW, EX.standL, EX.standPF, EX.standPA, EX.standDiff], rows: standRows };

  const rosterRows = [];
  teams.forEach((t) => (t.players || []).forEach((p) => rosterRows.push([t.name, divName(t.divisionId), p.number ?? "", p.name, p.gender || "", p.id === t.captainId ? EX.captain : p.id === t.spiritCaptainId ? EX.spiritCaptain : ""])));
  const teamsSheet = { name: EX.exTeams, head: [EX.standTeam, EX.exDivision, "#", EX.playerName, "F/M", EX.exRole], rows: rosterRows };

  const played = games.filter((g) => g.status !== GAME_STATUS.SCHEDULED);
  const totals = playerTotals(played, teams, rules).sort((a, b) => (b.mvp || 0) - (a.mvp || 0));
  const playersSheet = {
    name: EX.exPlayers,
    head: [EX.playerName, EX.standTeam, EX.heroGoals, EX.heroAssists, EX.heroBlocks, "Callahan", EX.exGamesPlayed, "MVP"],
    rows: totals.map((p) => [playerLabel(p), p.teamName || "", p.goals || 0, p.assists || 0, p.blocks || 0, p.callahans || 0, p.games || 0, p.mvp || 0]),
  };

  const spirit = spiritTable(teams, games).filter((r) => r.count > 0);
  const spiritSheet = {
    name: EX.tabSpirit,
    head: ["#", EX.standTeam, EX.spiritAvgShort, ...SPIRIT_KEYS.map((k) => EX[`spCat${k[0].toUpperCase()}${k.slice(1)}`] || k), EX.spiritCount],
    rows: spirit.map((r, i) => [i + 1, r.team.name, Number(r.avg.toFixed(1)), ...SPIRIT_KEYS.map((k) => Number(r.catAvg[k].toFixed(1))), r.count]),
  };

  return { title: event.name || "Torneo", sheets: [gamesSheet, standSheet, teamsSheet, playersSheet, spiritSheet].filter((s) => s.rows.length) };
}

const fileBase = (event) => String(event.slug || event.name || "torneo").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/gi, "-").toLowerCase();

export async function exportExcel(event, teams, games) {
  await loadScript(LIBS.xlsx);
  const { sheets } = tournamentTables(event, teams, games);
  const wb = window.XLSX.utils.book_new();
  sheets.forEach((s) => {
    const ws = window.XLSX.utils.aoa_to_sheet([s.head, ...s.rows]);
    ws["!cols"] = s.head.map((h, i) => ({ wch: Math.min(40, Math.max(String(h).length, ...s.rows.map((r) => String(r[i] ?? "").length)) + 2) }));
    window.XLSX.utils.book_append_sheet(wb, ws, s.name.slice(0, 31));
  });
  window.XLSX.writeFile(wb, `${fileBase(event)}.xlsx`);
}

export async function exportPdf(event, teams, games) {
  await loadScript(LIBS.jspdf);
  await loadScript(LIBS.autotable);
  const { title, sheets } = tournamentTables(event, teams, games);
  const doc = new window.jspdf.jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  const brand = [109, 40, 217];
  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.text(title, 40, 44);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(110);
  doc.text([event.venue, event.startDate && `${event.startDate}${event.endDate && event.endDate !== event.startDate ? ` – ${event.endDate}` : ""}`].filter(Boolean).join(" · "), 40, 62);
  doc.setTextColor(0);
  let y = 80;
  sheets.forEach((s, i) => {
    if (i > 0) {
      doc.addPage();
      y = 44;
    }
    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.text(s.name, 40, y);
    doc.autoTable({
      startY: y + 10,
      head: [s.head],
      body: s.rows,
      styles: { fontSize: 8.5, cellPadding: 4 },
      headStyles: { fillColor: brand, textColor: 255 },
      alternateRowStyles: { fillColor: [246, 245, 251] },
      margin: { left: 40, right: 40 },
    });
  });
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setFontSize(8);
    doc.setTextColor(150);
    doc.text(`ClubStudioHQ · ${p}/${pages}`, doc.internal.pageSize.getWidth() - 40, doc.internal.pageSize.getHeight() - 20, { align: "right" });
  }
  doc.save(`${fileBase(event)}.pdf`);
}
