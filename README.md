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
| `/torneos/admin.html` | Admins de la plataforma: aprobar torneos (prueba gratis / pagado) |

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
  - `teams/{id}`: equipos con roster
  - `games/{id}`: partidos (marcador, reloj, resumen de estadísticas, espíritu)
    - `plays/{id}`: jugadas (gol, drop, pase perdido, bloqueo, timeout, medio tiempo…)
- `game_keys/{token}`: links de planillero · `game_claims/{gameId}_{uid}`: sesiones que los usaron
- `platform_admins/{uid}`: quién aprueba torneos

## Fase 2

- Formatos: Swiss, eliminación directa, grupos + llave, personalizados (el organizador elige).
- Clubes de ClubStudioHQ: cargar el roster del club en un torneo.
- Pagos en línea para activar torneos.
