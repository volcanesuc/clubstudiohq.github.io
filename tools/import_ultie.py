"""Convierte un torneo de ultie.org al formato de importación de ClubStudioHQ.

Uso:
    python tools/import_ultie.py ciuf2025            # -> tournaments/data/imports/ciuf2025.json
    python tools/import_ultie.py ciuf2025 --out x.json
    python tools/import_ultie.py cglow-2025 --hat    # torneo hat: equipos armados por el organizador, sin club

Lee la API pública de ultie (GraphQL) y arma un JSON con el torneo, sus equipos con roster,
los partidos con cada gol/asistencia/timeout/medio tiempo y las evaluaciones de espíritu.
Ese JSON se carga desde /tournaments/admin.html > Importar (admin de la plataforma): el navegador
calcula marcadores y estadísticas con la misma lógica que el planillero.

Los ids son estables (u + id de ultie), así que volver a importar actualiza en vez de duplicar
y conserva las cuentas ya asignadas a los jugadores.
"""
import argparse
import base64
import json
import sys
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

API = "https://api.ultie.org/graphql"
FORMAT = "cshq-import/1"
COLORS = ["#e63946", "#1d4ed8", "#059669", "#f59e0b", "#7c3aed", "#db2777", "#0891b2", "#65a30d", "#ea580c", "#475569"]

EVENT_QUERY = """
query Q($u: String!) { event { getByURLName(urlName: $u) {
  id urlName title titleShort startDate endDate status avatarId city { title country { title } }
  divisions { id title divisionType gameType teamMap
    teams { id title club { title avatarId city { title } }
      sotgStats { id gameId r f fm p c }
      players { id backNumber account { id firstName lastName gender } } }
    games { id status startedAt finishedAt timeslot logicalId homeTeamId visitorTeamId score { homeTeam visitorTeam } } }
} } }"""

GAME_QUERY = """
query Q($id: Int!) { game { get(id: $id) {
  id duration maxPoint
  actions { id actionType actionTime createdAt data { __typename
    ... on GameScoreActionData { isCallahan scoredTeam { id } scoredPlayer { id } assistPlayer { id } }
    ... on GameTimeoutActionData { team { id } } } }
} } }"""


def gql(query, variables):
    body = json.dumps({"query": query, "variables": variables}).encode()
    req = urllib.request.Request(API, data=body, headers={"Content-Type": "application/json", "User-Agent": "ClubStudioHQ-import/1"})
    with urllib.request.urlopen(req, timeout=60) as res:
        out = json.load(res)
    if out.get("errors"):
        raise RuntimeError(out["errors"])
    return out["data"]


def logo_data_url(avatar_id, size=256):
    """Logo del club como data URL (ultie sirve versiones ya reducidas: resized/<size>_<archivo>)."""
    if not avatar_id:
        return ""
    name = avatar_id.replace("resized/", "")
    url = f"https://avatar.ultie.org/upload/resized/{size}_{name}"
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "ClubStudioHQ-import/1"})
        with urllib.request.urlopen(req, timeout=30) as res:
            kind = res.headers.get_content_type()
            data = res.read()
        if not kind.startswith("image/") or len(data) > 200_000:
            return ""
        return f"data:{kind};base64,{base64.b64encode(data).decode()}"
    except Exception as err:  # sin logo no es un error
        print(f"  aviso: logo {url}: {err}", file=sys.stderr)
        return ""


def ms(iso):
    return int(datetime.fromisoformat(iso.replace("Z", "+00:00")).timestamp() * 1000) if iso else None


def number(v):
    s = str(v or "").strip().lstrip("#")
    return int(s) if s.isdigit() else None


def full_name(acc):
    return " ".join(x.strip() for x in [acc.get("firstName") or "", acc.get("lastName") or ""] if x.strip())


# país de ultie (nombre en inglés) -> código ISO de la plataforma
COUNTRY_CODES = {
    "Costa Rica": "CR", "Panama": "PA", "Nicaragua": "NI", "Honduras": "HN", "El Salvador": "SV", "Guatemala": "GT",
    "Belize": "BZ", "Mexico": "MX", "Cuba": "CU", "Dominican Republic": "DO", "Puerto Rico": "PR", "Jamaica": "JM",
    "Colombia": "CO", "Venezuela": "VE", "Ecuador": "EC", "Peru": "PE", "Bolivia": "BO", "Chile": "CL", "Argentina": "AR",
    "Uruguay": "UY", "Paraguay": "PY", "Brazil": "BR", "United States": "US", "USA": "US", "Canada": "CA",
    "Spain": "ES", "Portugal": "PT", "France": "FR", "Italy": "IT", "Germany": "DE", "Austria": "AT", "Switzerland": "CH",
    "Belgium": "BE", "Netherlands": "NL", "United Kingdom": "GB", "Great Britain": "GB", "England": "GB", "Ireland": "IE",
    "Denmark": "DK", "Sweden": "SE", "Norway": "NO", "Finland": "FI", "Poland": "PL", "Czech Republic": "CZ", "Czechia": "CZ",
    "Slovakia": "SK", "Hungary": "HU", "Slovenia": "SI", "Croatia": "HR", "Romania": "RO", "Latvia": "LV", "Lithuania": "LT",
    "Estonia": "EE", "Japan": "JP", "China": "CN", "Taiwan": "TW", "South Korea": "KR", "Korea": "KR", "Philippines": "PH",
    "Singapore": "SG", "Malaysia": "MY", "Thailand": "TH", "India": "IN", "United Arab Emirates": "AE", "Australia": "AU",
    "New Zealand": "NZ", "South Africa": "ZA", "Kenya": "KE", "Uganda": "UG",
}


def swiss_round(logical_id):
    """Ronda de un partido suizo: /SWISS/<id>/Swiss/<ronda>/game/<n> -> ronda (None si no es suizo)."""
    parts = (logical_id or "").split("/Swiss/")
    if len(parts) == 2 and parts[1].split("/")[0].isdigit():
        return int(parts[1].split("/")[0])
    return None


def table_ranks(dv, team_key):
    """Orden oficial de la tabla de ultie (/SWISS/<id>/Swiss/out/<n>): en un suizo no alcanza con
    ganados y diferencia (ultie desempata por la fuerza de los rivales), así que se guarda tal cual."""
    out = {}
    for lid, s in (dv.get("teamMap") or {}).items():
        if s and lid.startswith("/SWISS/") and "/Swiss/out/" in lid and s.get("teamId") in team_key:
            out[team_key[s["teamId"]]] = int(lid.rsplit("/", 1)[1])
    return out


DIVISION_GENDER = {"MIXED": ("mixto", "Mixto", True), "OPEN": ("open", "Open", False), "WOMEN": ("femenino", "Femenino", False), "MEN": ("masculino", "Masculino", False)}
GAME_MODE = {"GAME_TYPE_7x7": ("7v7", 7), "GAME_TYPE_5x5": ("5v5", 5), "GAME_TYPE_4x4": ("4v4", 4), "GAME_TYPE_3x3": ("3v3", 3)}


PLACE_GAMES = {1: "Final", 2: "Tercer lugar", 3: "Quinto lugar", 4: "Séptimo lugar"}


def phase_of(logical_id, finals_rr_teams):
    """Fase del partido según su logicalId de ultie ('' = fase de grupos, cuenta para posiciones)."""
    lid = logical_id or ""
    if lid.startswith("/GROUP/") or lid.startswith("/SWISS/"):
        return ""  # grupos o rondas suizas: cuentan para la tabla
    if lid.startswith("/S_"):
        # llave por puestos: /S_1_4/ = cuartos (de ahí salen 1º-4º), /S_1_2/ = semis
        span = lid.split("/")[1].split("_")[-1]
        return {"2": "Semifinal", "4": "Cuartos de final", "8": "Octavos de final"}.get(span, "Eliminatoria")
    if lid.startswith("/CROSSOVER/"):
        return "Cruce"  # cruces entre grupos antes de la llave (no cuentan para la tabla)
    if "/GameUnion/game/" in lid:
        # finales por puesto: game/1 = 1º-2º, game/2 = 3º-4º, game/3 = 5º-6º…
        k = int(lid.rsplit("/", 1)[1])
        return PLACE_GAMES.get(k, f"Puesto {2 * k - 1}-{2 * k}")
    if lid.startswith("/FINALS/") and "/RR/" in lid:
        return finals_rr_teams.get(lid.split("/RR/")[0], "Clasificación")
    return "Eliminatoria"


def convert(slug, hat=False, country=None):
    ev = gql(EVENT_QUERY, {"u": slug})["event"]["getByURLName"]
    if not ev:
        raise SystemExit(f"No existe el torneo '{slug}' en ultie")
    ultie_country = (((ev.get("city") or {}).get("country") or {}).get("title") or "").strip()
    country = country or COUNTRY_CODES.get(ultie_country) or "CR"
    max_points = []  # "juego a N" de cada partido (el más común es el del torneo)

    divisions, teams, games = [], [], []
    team_key = {}
    color_i = 0
    for dv in ev["divisions"]:
        g_id, g_name, mixed = DIVISION_GENDER.get(dv["divisionType"], ("open", "Open", False))
        div_id = g_id if len(ev["divisions"]) == 1 else f"{g_id}-{dv['id']}"
        divisions.append({"id": div_id, "name": dv["title"] or f"Open {g_name}", "level": "Open", "gender": g_id, "mixed": mixed})

        rr_size = {}
        for lid, slot in (dv.get("teamMap") or {}).items():
            if not slot:
                continue
            stage = lid.split("/RR/")[0] if "/RR/" in lid else lid
            if lid.startswith("/FINALS/") and "/RR/" in lid:
                rr_size.setdefault(stage, set()).add(slot["teamId"])
        # mini round robin por puestos (ej. 5-7): lo nombra con los puestos que reparte
        finals_rr = {}
        n_teams = len(dv["teams"])
        for stage, ids in rr_size.items():
            lo = n_teams - len(ids) + 1
            finals_rr[stage] = f"Puestos {lo}-{n_teams}" if lo < n_teams else f"Puesto {n_teams}"

        # grupos (/GROUP/<id>/RR/in/<n>): A, B… según el orden del sorteo (el grupo del 1º sembrado es A)
        group_of, draw_pos = {}, {}
        for lid, slot in (dv.get("teamMap") or {}).items():
            if slot and lid.startswith("/GROUP/") and "/RR/in/" in lid:
                gid = lid.split("/")[2]
                group_of[slot["teamId"]] = gid
                pos = (slot.get("logicalId") or "").rsplit("/", 1)[-1]
                draw_pos[gid] = min(draw_pos.get(gid, 999), int(pos) if pos.isdigit() else 999)
        letters = {gid: chr(65 + i) for i, gid in enumerate(sorted(draw_pos, key=lambda g: (draw_pos[g], g)))}
        # solo si de verdad se jugó en grupos (algunos torneos traen grupos del sorteo y juegan suizo)
        played_groups = any((x.get("logicalId") or "").startswith("/GROUP/") for x in dv["games"])
        pool_of = {tid: letters[gid] for tid, gid in group_of.items()} if len(letters) > 1 and played_groups else {}

        for t in dv["teams"]:
            key = f"tmu{t['id']}"
            team_key[t["id"]] = key
            club = t.get("club") or {}
            players = []
            for p in t["players"]:
                acc = p.get("account") or {}
                players.append({
                    "id": f"pu{p['id']}",
                    "uid": None,
                    "name": full_name(acc) or "—",
                    "number": number(p.get("backNumber")),
                    "gender": {"FEMALE": "F", "MALE": "M"}.get(acc.get("gender"), ""),
                    "source": {"provider": "ultie", "accountId": acc.get("id"), "playerId": p["id"]},
                })
            players.sort(key=lambda x: x["name"].lower())
            teams.append({
                "id": key,
                "name": " ".join((t["title"] or "").split()),
                "city": ((club.get("city") or {}).get("title") or "").strip(),
                "color": COLORS[color_i % len(COLORS)],
                "logo": logo_data_url(club.get("avatarId")),
                "divisionId": div_id,
                "pool": pool_of.get(t["id"], ""),
                "players": players,
                **({"hat": True} if hat else {}),
                "source": {"provider": "ultie", "teamId": t["id"]},
            })
            color_i += 1

        # espíritu: cada equipo trae lo que recibió; id = juego-quien_da-quien_recibe
        spirit = {}
        for t in dv["teams"]:
            for s in t.get("sotgStats") or []:
                gid, giver, receiver = (int(x) for x in s["id"].split("-"))
                spirit[(gid, giver)] = {"rules": s["r"], "fouls": s["f"], "fair": s["fm"], "attitude": s["p"], "comm": s["c"]}

        for g in dv["games"]:
            detail = gql(GAME_QUERY, {"id": g["id"]})["game"]["get"]
            if detail.get("maxPoint"):
                max_points.append(int(detail["maxPoint"]))
            home, away = g["homeTeamId"], g["visitorTeamId"]
            side = {home: "A", away: "B"}
            start = ms(g["startedAt"])
            plays, score = [], {"A": 0, "B": 0}
            actions = sorted(detail["actions"], key=lambda a: (ms(a["actionTime"]) or 0, ms(a["createdAt"]) or 0))
            first_goal_team = None
            for a in actions:
                at = ms(a["actionTime"]) or start
                base = {"id": f"u{a['id']}", "t": max(0, round((at - start) / 1000)) if start else 0, "at": at}
                kind, data = a["actionType"], a.get("data") or {}
                if kind == "GameStartAction":
                    plays.append({**base, "type": "start"})
                elif kind == "GameScoreAction":
                    s = side.get((data.get("scoredTeam") or {}).get("id"))
                    if not s:
                        continue
                    first_goal_team = first_goal_team or s
                    score[s] += 1
                    scorer = (data.get("scoredPlayer") or {}).get("id")
                    assist = (data.get("assistPlayer") or {}).get("id")
                    plays.append({**base, "type": "goal", "team": s,
                                  "scorerId": f"pu{scorer}" if scorer else "",
                                  "assistId": f"pu{assist}" if assist and not data.get("isCallahan") else "",
                                  "callahan": bool(data.get("isCallahan")), "scoreA": score["A"], "scoreB": score["B"]})
                elif kind == "GameTimeoutAction":
                    s = side.get((data.get("team") or {}).get("id"))
                    if s:
                        plays.append({**base, "type": "timeout", "team": s})
                elif kind == "GameHalftimeStartAction":
                    plays.append({**base, "type": "halftime"})
                elif kind == "GameFinishAction":
                    plays.append({**base, "type": "end"})
            final = g["status"] == "FINISHED"
            if final and not any(p["type"] == "end" for p in plays):
                plays.append({"id": f"u{g['id']}end", "type": "end", "t": plays[-1]["t"] if plays else 0, "at": ms(g["finishedAt"]) or (plays[-1]["at"] if plays else start)})
            # ultie no guarda quién arrancó en ofensiva: A por defecto (solo afecta holds/breaks)
            start_play = next((p for p in plays if p["type"] == "start"), None)
            if start_play:
                start_play["team"] = "A"
            sc = g.get("score") or {}
            official = {"A": sc.get("homeTeam"), "B": sc.get("visitorTeam")}
            if final and None not in official.values() and official != score:
                score = reconcile(plays, official, g["id"], score)
            card_a, card_b = spirit.get((g["id"], home)), spirit.get((g["id"], away))
            games.append({
                "id": f"gmu{g['id']}",
                "divisionId": div_id,
                "phase": phase_of(g["logicalId"], finals_rr),
                "pool": pool_of.get(g["homeTeamId"], "") if (g["logicalId"] or "").startswith("/GROUP/") else "",
                "round": swiss_round(g["logicalId"]),
                "field": "",
                "startAt": g["startedAt"],
                "finishedAt": g["finishedAt"],
                "teamA": team_key[home],
                "teamB": team_key[away],
                "status": "final" if final else "scheduled",
                "offenseFirst": "A",
                "spirit": {k: v for k, v in (("A", card_a), ("B", card_b)) if v},
                "plays": plays,
                "source": {"provider": "ultie", "gameId": g["id"], "logicalId": g["logicalId"]},
            })

        # puesto final de cada equipo según la llave (para mostrarlo y para el historial)
        div_games = [g for g in games if g["divisionId"] == div_id]
        relabel_place_games(dv, div_games, team_key)
        # suizo de una sola ronda (ultie lo usa como contenedor de todos contra todos): sin número de ronda
        if len({g["round"] for g in div_games if g["round"]}) == 1:
            for g in div_games:
                g["round"] = None
        places = final_places(dv, games, team_key)
        ranks = table_ranks(dv, team_key)
        for t in teams:
            if t["divisionId"] == div_id and t["id"] in places:
                t["finalPlace"] = places[t["id"]]
            if t["divisionId"] == div_id and t["id"] in ranks:
                t["tableRank"] = ranks[t["id"]]

    games.sort(key=lambda g: g["startAt"] or "")
    game_to = max(set(max_points), key=max_points.count) if max_points else 13
    first = ev["divisions"][0]
    mode, on_field = GAME_MODE.get(first["gameType"], ("7v7", 7))
    return {
        "format": FORMAT,
        "source": {"provider": "ultie", "url": f"https://ultie.org/{ev['urlName']}", "eventId": ev["id"], "fetchedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")},
        "event": {
            "id": f"evu{ev['id']}",
            "name": ev["title"],
            "shortName": ev.get("titleShort") or "",
            "slug": ev["urlName"],
            "startDate": ev["startDate"],
            "endDate": ev["endDate"],
            "venue": (ev.get("city") or {}).get("title") or "",
            "country": country,
            "logo": logo_data_url(ev.get("avatarId"), 400),
            "description": f"Resultados importados de ultie.org/{ev['urlName']}.",
            "divisions": divisions,
            "fields": [],
            "format": "round_robin",
            "rules": {"mode": mode, "playersOnField": on_field, "gameTo": game_to, "halftimeAt": (game_to + 1) // 2, "gameMinutes": 90},
            **({"type": "hat", "hat": {"multiDivision": False}} if hat else {}),
        },
        "teams": teams,
        "games": games,
    }


def reconcile(plays, official, game_id, score):
    """Ajusta las jugadas al marcador oficial de ultie (el que vio todo el mundo):
    1. goles anotados después del final quedan marcados como borrados (siguen en Jugadas);
    2. si aún falta algún gol, se agrega uno sin anotador justo antes del final.
    Los marcadores parciales (scoreA/scoreB) se recalculan."""
    end_i = next((i for i, p in enumerate(plays) if p["type"] == "end"), None)
    if end_i is not None:
        for p in plays[end_i + 1:]:
            if p["type"] == "goal":
                p["deleted"] = True
                p["note"] = "Anotado después del final en ultie; no cuenta"
    live = lambda: [p for p in plays if p["type"] == "goal" and not p.get("deleted")]
    # goles de más (ej. partido dado por perdido): los últimos de ese equipo no cuentan
    for s in ("A", "B"):
        extra = sum(p["team"] == s for p in live()) - official[s]
        for p in [p for p in live() if p["team"] == s][::-1][:max(0, extra)]:
            p["deleted"] = True
            p["note"] = "No cuenta en el marcador oficial de ultie"
    for s in ("A", "B"):
        missing = official[s] - sum(p["team"] == s for p in live())
        for k in range(max(0, missing)):
            end_i = next((i for i, p in enumerate(plays) if p["type"] == "end"), len(plays))
            ref = plays[end_i - 1] if end_i else {"t": 0, "at": None}
            plays.insert(end_i, {"id": f"u{game_id}fix{s}{k}", "type": "goal", "team": s, "t": ref["t"], "at": ref["at"],
                                 "scorerId": "", "assistId": "", "callahan": False,
                                 "note": "Gol sin registrar en ultie (marcador oficial)"})
    new = {"A": 0, "B": 0}
    for p in live():
        new[p["team"]] += 1
        p["scoreA"], p["scoreB"] = new["A"], new["B"]
    msg = "ajustado" if new == official else "NO coincide"
    print(f"  aviso: partido {game_id} jugadas {score} -> {new}, oficial {official} ({msg})", file=sys.stderr)
    return new


def result_places(dv, team_key):
    """Tabla final oficial de ultie: /RESULT/<id>/Result/in/<puesto> -> equipo."""
    out = {}
    for lid, s in (dv.get("teamMap") or {}).items():
        if s and lid.startswith("/RESULT/") and "/Result/in/" in lid and s.get("teamId") in team_key:
            out[team_key[s["teamId"]]] = int(lid.rsplit("/", 1)[1])
    return out


def relabel_place_games(dv, games, team_key):
    """Con tabla oficial, cada partido por puesto se nombra por el puesto de su ganador
    (ej. la "final" de un bloque FINALS que reparte el 5º = "Quinto lugar")."""
    places = result_places(dv, team_key)
    if not places:
        return
    tm = dv.get("teamMap") or {}
    # semis/cuartos por puestos: según dónde terminaron sus dos equipos, el bloque que reparte el partido
    # (semis = 4 puestos, cuartos = 8…). Si no es el bloque del 1º, es "Puestos 5-8 · Semifinal".
    # (Una llave con bye para los 1º sigue siendo la principal: sus equipos caen en el bloque del 1º.)
    block = {"Semifinal": 4, "Cuartos de final": 8, "Octavos de final": 16}
    for g in games:
        lid = g["source"]["logicalId"] or ""
        n = block.get(g["phase"])
        pa, pb = places.get(g["teamA"]), places.get(g["teamB"])
        if not (lid.startswith("/S_") and n and pa and pb):
            continue
        lo = (min(pa, pb) - 1) // n * n + 1
        if lo > 1:
            g["phase"] = f"Puestos {lo}-{lo + n - 1} · {g['phase']}"
    for g in games:
        lid = g["source"]["logicalId"] or ""
        if not (lid.startswith("/FINALS/") and "/GameUnion/game/" in lid):
            continue
        w = (tm.get(lid + "/out/w") or {}).get("teamId")
        p = places.get(team_key.get(w))
        if p:
            k = (p + 1) // 2
            g["phase"] = PLACE_GAMES.get(k, f"Puesto {2 * k - 1}-{2 * k}")


def final_places(dv, games, team_key):
    """Puesto final: la tabla final oficial de ultie (/RESULT/) si viene; si no,
    final (1-2), tercer lugar (3-4), y los demás por la tabla de su mini round robin."""
    official = result_places(dv, team_key)
    if official:
        return official
    out = {}
    div_games = [g for g in games if g["source"]["logicalId"] and any(g["source"]["gameId"] == x["id"] for x in dv["games"])]
    def winner_loser(g):
        last = [p for p in g["plays"] if p["type"] == "goal" and not p.get("deleted")]
        a = last[-1]["scoreA"] if last else 0
        b = last[-1]["scoreB"] if last else 0
        return (g["teamA"], g["teamB"]) if a > b else (g["teamB"], g["teamA"])
    for g in div_games:
        if g["phase"] == "Final":
            w, l = winner_loser(g)
            out[w], out[l] = 1, 2
        elif g["phase"] == "Tercer lugar":
            w, l = winner_loser(g)
            out[w], out[l] = 3, 4
        elif "/GameUnion/game/" in (g["source"]["logicalId"] or "") and g["source"]["logicalId"].startswith("/FINALS/"):
            k = int(g["source"]["logicalId"].rsplit("/", 1)[1])
            if k >= 3:
                w, l = winner_loser(g)
                out[w], out[l] = 2 * k - 1, 2 * k
    # el resto: tabla del mini round robin por puestos (ej. 5-7)
    rr_teams = [team_key[s["teamId"]] for lid, s in (dv.get("teamMap") or {}).items()
                if s and lid.startswith("/FINALS/") and "/RR/" in lid and s.get("teamId") in team_key]
    rr_teams = [t for t in dict.fromkeys(rr_teams) if out.get(t, 0) not in (1, 2, 3, 4)]
    if rr_teams:
        rows = {t: [0, 0] for t in rr_teams}  # ganados, diferencia
        for g in div_games:
            if g["teamA"] in rows and g["teamB"] in rows and g["phase"].startswith("Puesto"):
                goals = [p for p in g["plays"] if p["type"] == "goal" and not p.get("deleted")]
                a = goals[-1]["scoreA"] if goals else 0
                b = goals[-1]["scoreB"] if goals else 0
                rows[g["teamA"]][1] += a - b
                rows[g["teamB"]][1] += b - a
                rows[g["teamA" if a > b else "teamB"]][0] += 1
        start = 5
        for i, t in enumerate(sorted(rows, key=lambda t: (-rows[t][0], -rows[t][1]))):
            out[t] = start + i
    # los que no jugaron por un puesto (ej. suizo con solo final): siguen según su récord en la tabla
    rest = [team_key[t["id"]] for t in dv["teams"] if team_key.get(t["id"]) and team_key[t["id"]] not in out]
    if out and rest:
        rows = {t: [0, 0] for t in rest}
        for g in div_games:
            if g["phase"]:
                continue
            goals = [p for p in g["plays"] if p["type"] == "goal" and not p.get("deleted")]
            a = goals[-1]["scoreA"] if goals else 0
            b = goals[-1]["scoreB"] if goals else 0
            for side, us, them in (("teamA", a, b), ("teamB", b, a)):
                if g[side] in rows:
                    rows[g[side]][1] += us - them
                    rows[g[side]][0] += 1 if us > them else 0
        start = max(out.values()) + 1
        for i, t in enumerate(sorted(rows, key=lambda t: (-rows[t][0], -rows[t][1]))):
            out[t] = start + i
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("slug", help="url del torneo en ultie (ej. ciuf2025)")
    ap.add_argument("--out", help="archivo de salida")
    ap.add_argument("--country", default="", help="código ISO del país (por defecto el de ultie, o CR)")
    ap.add_argument("--hat", action="store_true", help="torneo hat (equipos armados por el organizador, sin club)")
    args = ap.parse_args()
    data = convert(args.slug, hat=args.hat, country=args.country.upper() or None)
    out = Path(args.out) if args.out else Path(__file__).resolve().parent.parent / "tournaments" / "data" / "imports" / f"{args.slug}.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
    # lista que muestra /tournaments/admin.html > Importar
    index = out.parent / "index.json"
    items = json.loads(index.read_text(encoding="utf-8")).get("imports", []) if index.exists() else []
    items = [i for i in items if i.get("file") != out.name]
    items.append({"file": out.name, "name": data["event"]["name"], "source": data["source"]["url"], "startDate": data["event"]["startDate"]})
    index.write_text(json.dumps({"imports": sorted(items, key=lambda i: i.get("startDate", ""), reverse=True)}, ensure_ascii=False, indent=1), encoding="utf-8")
    n_players = sum(len(t["players"]) for t in data["teams"])
    print(f"{data['event']['name']}: {len(data['teams'])} equipos, {n_players} jugadores, {len(data['games'])} partidos -> {out}")


if __name__ == "__main__":
    main()
