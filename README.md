# VICIO — El club en números

Dashboard de actividad gamer en español. Diseño de marcador editorial: papel, tinta, verde ácido, tipografía condensada y gráficos sin dependencias de UI.

## Radar del sota

La pantalla principal prioriza a los integrantes que no aparecen. La lista de integrantes es independiente del historial: alguien con cero conexiones tiene su fila. Desde **Agregar integrante** se puede definir nombre, ID de Discord opcional, fecha de alta y si está en el radar o en pausa. El bot incorpora también a los miembros que estén offline al iniciar.

El radar muestra última señal, días sin conectar, días conectado en el período, días en voz y días con juego + voz. Ordena primero los que nunca registraron actividad, después los que no aparecieron en el período, los que llevan 7 días o más sin señal y los que estuvieron online sin entrar a voz. La pausa conserva los datos y evita marcar ausencias.

El radar usa el período y el jugador elegidos; los filtros de juego y actividad solo afectan a las estadísticas de debajo. Así, filtrar por un juego no convierte falsamente en ausente a quien jugó otro. Las fechas históricas se calculan hasta el final del período seleccionado, sin mirar conexiones posteriores.

“Sin registros” no demuestra una ausencia voluntaria. Invisible, permisos y cortes del bot dejan huecos. Sin calendario de encuentros pactados, no se inventa una tasa de faltazos. Juego + voz tampoco confirma que compartieran la misma partida.

Los respaldos JSON ahora incluyen `members`, que conserva también a quienes nunca se conectaron. Se siguen aceptando respaldos anteriores sin esa lista. Al importar, se agregan integrantes nuevos y se preservan las decisiones sobre los que ya estaban en la lista.

## Qué incluye

- Resumen de horas-persona, sesiones, jugadores y horas en voz.
- Fichas por jugador, juegos con nombres de participantes e historial paginado.
- Períodos de 7 días, 2 semanas, 1, 3 o 6 meses, un año y fechas personalizadas.
- Filtros combinables por jugador, juego, actividad, presencia, voz, habla, mute, sordera, transmisión y cámara.
- Carga manual con edición y eliminación de registros, validación de horarios y prevención de superposiciones por jugador.
- Respaldo JSON completo, importación sin duplicados y exportación CSV de la vista filtrada.
- Muestra ficticia de un año, separada del historial real. Los nombres y horas de la muestra no describen actividad real.
- Backend compartido SQLite y bot de Discord opcional. Estado actual de los miembros observados cuando el bot está conectado.

## Mi elección: Render para el bot

Para el proyecto completo conviene **un Web Service de Render activo con disco persistente**. El mismo proceso sirve el dashboard, la API y el bot. `render.yaml` ya define el servicio y el disco. Esa configuración usa infraestructura paga: revisar el costo que muestre Render antes de crearla.

GitHub Pages es una buena alternativa gratis para **carga manual local**. No ejecuta Python ni mantiene el bot conectado. En ese modo cada navegador tiene su propio historial; no hay sincronización automática entre amigos. Publicar el sitio no publica los registros locales de cada visitante.

Un servicio gratuito de Render puede suspenderse; el almacenamiento local sin disco persistente se pierde con reinicios o despliegues. No sirve para garantizar un año de observación continua. No se publica ni contrata ningún servicio de Render al descargar este proyecto.

## Probar sin configurar Discord

Con Python 3.12 o superior, desde esta carpeta:

```bash
python -m http.server 8000 --directory dist
```

Abrir `http://localhost:8000`. No abrir `index.html` directamente con `file://`, porque usa módulos JavaScript. Pulsar **Ver mis datos** para empezar un historial vacío, o **Registrar sesión** para crear el primero. La muestra permanece disponible por separado.

Los datos locales se guardan por origen del sitio. Un cambio de dominio no mueve esos datos: exportar el JSON e importarlo en el nuevo dominio. Borrar los datos del navegador también borra el historial local; hacer respaldos periódicos.

## Publicar en Render

1. Subir el contenido de esta carpeta a un repositorio de GitHub. No subir `.env`, tokens, archivos SQLite ni la carpeta `data`.
2. En Render: **New → Blueprint**, conectar el repositorio y seleccionar `render.yaml`.
3. Revisar el plan y el disco persistente que propone. El disco se monta en `/var/data` y la base usa `/var/data/vicio.sqlite`.
4. Para usar solo carga manual, dejar `DISCORD_TOKEN` y `DISCORD_GUILD_ID` vacíos. Para el bot, configurarlos según el apartado siguiente.
5. Render genera `ADMIN_KEY`. Copiar esa clave desde las variables de entorno del servicio e ingresarla en **Datos e integración → Clave de administración**. Se conserva en `sessionStorage` de esa pestaña; se envía al backend en el encabezado Authorization, nunca a Discord.
6. Abrir la URL HTTPS que entregue Render y elegir **Ver mis datos**. El dashboard detecta la API automáticamente. Los datos pasan a ser compartidos entre equipos; las escrituras necesitan la clave.

El dashboard y la lectura de la API son públicos por defecto en Render. Quien visite su URL podrá ver nombres, horarios, juegos y notas. La clave de administración protege las modificaciones, no la lectura. Para un club privado, agregar control de acceso delante del servicio antes de compartir actividad real.

### Llevar registros locales al servidor

Exportar el JSON desde el dominio anterior. Abrir la URL de Render, guardar la clave e importar el archivo. No importar datos de muestra. Si ya había registros locales en el mismo origen, el dashboard evita cambiarlos por datos remotos automáticamente: exportarlos, abrir la URL en otro perfil de navegador y luego importar al servidor.

## Crear el bot de Discord

1. Ir al [Developer Portal](https://discord.com/developers/applications), crear una aplicación y abrir **Bot**.
2. Obtener el token y configurarlo **solo** como variable de entorno `DISCORD_TOKEN` en el backend. No ponerlo en HTML, GitHub ni en la clave de administración del dashboard.
3. Activar **Presence Intent** y **Server Members Intent** en la sección Privileged Gateway Intents. El código solicita además Guilds y Voice States. No requiere Message Content, Administrator, lectura de mensajes ni conexión a un canal de voz.
4. Invitar la aplicación al servidor usando el alcance `bot`. Dar acceso de visualización a los canales que se quieran observar. No solicita ni envía mensajes.
5. Activar el modo desarrollador de Discord, copiar el ID del servidor y guardarlo como `DISCORD_GUILD_ID`.
6. Opcional: definir `WATCH_USER_IDS` con IDs de miembros separados por coma. Vacío observa todos los miembros humanos del servidor configurado; los bots se excluyen. Para un grupo chico, es útil dejar una lista explícita.
7. Reiniciar/desplegar el servicio. En **Datos e integración** debe aparecer **Bot conectado**. El resumen real mostrará **Ahora en el club**.

El historial comienza cuando el bot está funcionando. Discord no entrega un año anterior de presencia y juegos. Si Discord no informa una actividad, no podemos asegurar que la persona no está jugando. Invisible se ve desconectado; si la persona está en voz, podemos observar esa presencia en voz, pero su estado visible puede seguir siendo offline.

El bot no escucha ni graba audio. La variable «habló» queda en **desconocido**. Una persona con la clave puede abrir un registro desde Historial (↗) y marcar manualmente «sí», «no» o «desconocido». El mute es otra variable: no prueba que nunca haya hablado.

## Ejecutar el backend en una PC

Instalar las dependencias en un entorno virtual:

```bash
python -m venv .venv
# Linux / WSL:
source .venv/bin/activate
# Windows PowerShell, en lugar del comando anterior:
# .venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
```

Crear una clave aleatoria con `python -c "import secrets; print(secrets.token_urlsafe(32))"` y definir las variables. El servidor no carga `.env` automáticamente; `.env.example` documenta las variables.

Linux / WSL:

```bash
export ADMIN_KEY='PEGAR_LA_CLAVE_ALEATORIA'
# Opcional, para activar Discord:
export DISCORD_TOKEN='PEGAR_TOKEN_DEL_BOT'
export DISCORD_GUILD_ID='PEGAR_ID_DEL_SERVIDOR'
python server.py
```

Windows PowerShell:

```powershell
$env:ADMIN_KEY = 'PEGAR_LA_CLAVE_ALEATORIA'
# Opcional, para activar Discord:
$env:DISCORD_TOKEN = 'PEGAR_TOKEN_DEL_BOT'
$env:DISCORD_GUILD_ID = 'PEGAR_ID_DEL_SERVIDOR'
python server.py
```

Abrir `http://localhost:8000`. Por defecto la base se crea en `data/vicio.sqlite`. La PC y el proceso deben permanecer encendidos para registrar. Para exponerlo a internet, usar HTTPS y un proveedor/reverse proxy adecuado.

## Publicar en GitHub Pages

1. Subir este proyecto a un repositorio con rama `main`.
2. En **Settings → Pages → Build and deployment**, elegir **GitHub Actions**.
3. El workflow `.github/workflows/pages.yml` publica únicamente `dist/`.
4. Abrir la URL que indique GitHub. No hay build ni dependencias de Node para publicar.

Se incluyen todas las rutas relativas, así que funciona dentro de un subdirectorio de Pages. El código del backend queda disponible en el repositorio, pero no se ejecuta ni se publica como parte del sitio estático.

## Modelo y métricas

Cada registro es un tramo continuo con `id`, `userId`, `name`, `start`, `end`, `game`, `inVoice`, `spoke`, `muted`, `deafened`, `streaming`, `camera`, `status`, `channel`, `source`, `sessionId` y `note`. Las fechas se almacenan en UTC y se muestran en la zona horaria del dispositivo.

| Actividad | Regla |
| --- | --- |
| Juego + voz | Hay juego registrado y está en voz |
| Juego sin voz | Hay juego registrado y está fuera de voz |
| Solo charla | Sin juego registrado, en voz, habla = sí |
| Sin juego ni charla / fantasma | Sin juego registrado, en voz, habla = no |
| Voz sin dato de habla | Sin juego registrado, en voz, habla = desconocido |
| Conectado sin voz | Sin juego registrado y fuera de voz |

El bot divide el tramo cuando cambia algún estado y lo persiste cada minuto. Los cambios mantienen `sessionId` durante una conexión observada. Una desconexión del bot cierra la observación y una reconexión inicia otra; el contador representa **sesiones observadas**, no un historial infalible de inicios de sesión de Discord. Un corte abrupto puede perder hasta el último minuto. No se suma el tiempo durante un corte. Las observaciones largas se dividen cada 6 horas manteniendo la misma sesión.

En modo manual, cada carga es una sesión. Cargar un tramo por actividad sin superponerlos. Los registros manuales y automáticos de un mismo ID de jugador no pueden superponerse; la anotación de habla modifica el registro existente. Al migrar nombres manuales a miembros Discord, el ID manual y el ID de Discord son identidades diferentes: unificar IDs en el respaldo antes de importar si se desea una sola ficha histórica.

Las métricas suman horas-persona. Cuatro personas jugando juntas una hora son cuatro horas de juego. Los intervalos se recortan al rango seleccionado, incluso si cruzan medianoche. Los gráficos y las fichas respetan todos los filtros; «Ahora en el club» muestra el estado actual sin filtros de historial.

No se elimina automáticamente el historial al cumplir un año. Se conserva mientras exista la base, con límite de 100.000 tramos por carga del dashboard/importación. Para grupos grandes o varios años, agregar consultas paginadas y agregaciones en el backend. El bot está pensado para un servidor pequeño/mediano y una sola instancia del proceso, consistente con SQLite y el disco de Render.

## Respaldos y exportaciones

- **Respaldar todo** exporta todos los registros del conjunto actual (muestra o datos reales), sin aplicar los filtros.
- **Exportar vista CSV** exporta solo los tramos filtrados y sus horas recortadas al período. Incluye fechas UTC y los estados adicionales.
- **Importar respaldo** combina por ID. Omite duplicados idénticos y rechaza IDs con contenido distinto, sesiones futuras y superposiciones. No acepta datos ficticios en el historial real.
- Para un respaldo físico de SQLite mientras está activo, usar la API de backup de SQLite o detener el servicio antes de copiar el archivo. No copiar solo el `.sqlite` ignorando su WAL mientras hay escrituras.

## Comprobar el proyecto

Node 20+ para las pruebas del modelo; Python y dependencias para las pruebas del backend:

```bash
npm test
npm run check
python -m unittest discover -s tests -p 'test_*.py' -v
```

No se necesita Node en producción. Se verifican categorías, recorte de intervalos, sumas, sesiones, cambio de mes/año, respaldos, superposiciones, atomicidad de SQLite, continuidad del bot, anotaciones y autorización de la API. El bot necesita un token y servidor reales para una prueba de integración con Discord.

## Archivos

```text
dist/                   Dashboard estático sin build
server.py               API + observador Discord opcional
storage.py              Validación y SQLite
requirements.txt        Dependencias Python
render.yaml             Despliegue completo con disco
.env.example            Variables documentadas, sin secretos
.github/workflows/      Publicación manual en Pages
tests/                  Verificación del modelo y backend
```

Las fuentes web son Barlow Condensed, DM Sans e IBM Plex Mono mediante Google Fonts; hay fuentes de sistema como respaldo. No hay analítica, trackers ni procesamiento de audio.

## Fuentes de infraestructura

- [GitHub Pages: hosting estático](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages)
- [Render: límites del servicio gratuito](https://render.com/docs/free)
- [Render: discos persistentes](https://render.com/docs/disks)
- [Render: referencia de Blueprints](https://render.com/docs/blueprint-spec)
- [Discord: Gateway e intents](https://docs.discord.com/developers/events/gateway)
- [discord.py: intents](https://discordpy.readthedocs.io/en/stable/intents.html)
