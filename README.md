# ClubStudioHQ

Landing de la plataforma (`index.html`) y módulo de **Torneos** (`/torneos/`), abierto a cualquier organizador
(no hace falta tener un club en ClubStudioHQ).

## Torneos

| Página | Para quién |
|---|---|
| `/torneos/` | Público: torneos publicados |
| `/torneos/organizar.html` | Organizadores (entrar con Google): equipos, calendario, links de planillero |
| `/torneos/evento.html?e=<link>` | Público: resumen, posiciones, estadísticas (MVP), partidos, equipos, espíritu |
| `/torneos/partido.html?event=&game=` | Público: marcador y jugadas en vivo |
| `/torneos/planillar.html?event=&game=&key=` | Planillero (link por partido, sin cuenta) |
| `/torneos/admin.html` | Admins de la plataforma: aprobar torneos, importar torneos y asignar cuentas a jugadores |

**Flujo:** cualquiera con Google crea un torneo (borrador privado) → arma equipos y calendario →
*Solicitar activación* → un admin lo aprueba con plan (prueba gratis o pagado, con vencimiento opcional) →
el organizador lo publica y crea links de planillero. Las reglas de Firestore hacen cumplir todo esto.

**Formatos:** round robin por grupo. Para agregar Swiss, eliminación, grupos + llave o uno personalizado,
se registra un generador en `torneos/js/formats.js` (`registerFormat`); el resto (partidos, planillaje,
estadísticas) no cambia.

## Configuración (proyecto de Firebase de la plataforma)

1. Crear un proyecto nuevo en Firebase (separado de los clubes).
2. **Authentication**: habilitar *Google* y *Anonymous* (el anónimo lo usan los planilleros).
   En *Settings > Authorized domains* agregar `www.clubstudiohq.com` y `clubstudiohq.com`.
3. **Firestore**: crear la base y pegar `firestore.rules` en *Reglas*.
4. Copiar la config web en `torneos/js/firebase-config.js`.
5. **Admins**: en Firestore crear el documento `platform_admins/{tu uid}` (cualquier contenido).
   Tu uid aparece en *Authentication > Users* después de entrar una vez con Google.

## Datos

- `events/{id}`: torneo (info, reglas, `ownerUid`, `organizerUids`, `organizerEmails`, `approval`)
  - `teams/{id}`: equipos con roster, logo, capitán(a) y capitán(a) de espíritu
  - `registrations/{id}`: inscripciones de equipos (pendiente / aprobada / rechazada)
  - `games/{id}`: partidos (marcador, reloj, resumen de estadísticas, espíritu)
    - `plays/{id}`: jugadas (gol, drop, pase perdido, bloqueo, timeout, medio tiempo…)
- `game_keys/{token}`: links de planillero · `game_claims/{gameId}_{uid}`: sesiones que los usaron
- `platform_admins/{uid}`: quién aprueba torneos
- `squads/{id}`: equipos permanentes (dueños/co-admins, logo, capitanes)
  - `members/{id}`: roster (id = uid si el jugador se unió con su cuenta) · `private/invites`: tokens · `tournaments/{eventId}`: inscripciones
- `squad_invites/{token}`: links para unirse (jugador o co-admin)
- `profiles/{uid}`: perfil del jugador (foto, número, F/M, equipos); el historial se calcula de los partidos
- `player_claims/{eventId}__{playerId}`: cuenta asignada por un admin a un jugador sin cuenta (el perfil muestra ese torneo)
- `platform_config/divisions`: (opcional) opciones de categorías y ramas `{ levels: ["Open", "Masters", …], genders: [{ id, name, mixed }] }`. Si no existe se usan las de `torneos/js/divisions-config.js`.

## Importar torneos y jugadores sin cuenta

1. `python tools/import_ultie.py <torneo>` (ej. `ciuf2025` de ultie.org) genera `torneos/data/imports/<torneo>.json`
   y lo agrega a `index.json`: equipos, rosters, partidos con cada gol/asistencia/timeout y espíritu.
2. En `/torneos/admin.html` > **Importar** se elige el archivo, se ve el resumen y se importa: el torneo queda
   activo, público y terminado (con puestos finales). Volver a importar actualiza sin perder cuentas asignadas.
3. En **Jugadores**, el admin asigna a cada jugador sin cuenta la cuenta de una persona (tiene que haber entrado
   una vez). Sus estadísticas aparecen en su perfil. Sirve también para jugadores cargados a mano por un organizador.

## Fase 2

- Formatos: Swiss, eliminación directa, grupos + llave, personalizados (el organizador elige).
- Clubes de ClubStudioHQ: cargar el roster del club en un torneo.
- Pagos en línea para activar torneos.
