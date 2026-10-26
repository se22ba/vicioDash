# VICIO — El club en números

Dashboard de actividad gamer en español. Diseño inspirado en Deadpool: negro mate, rojo, blanco cálido, trama de cómic, imagen aportada por el usuario e ícono de máscara. Sin dependencias de UI.

## Radar del sota

La pantalla principal prioriza a los integrantes que no aparecen. La lista de integrantes es independiente del historial: alguien con cero conexiones tiene su fila. Desde **Agregar integrante** se puede definir nombre, ID de Discord opcional, fecha de alta y si está en el radar o en pausa. El bot incorpora automáticamente a los miembros humanos del servidor, incluidos los desconectados, y revisa la lista cada minuto mientras está activo. No hace falta agregarlos a mano. El tablero abre los datos reales por defecto; **Ver muestra ficticia** es opcional. En **La banda** se ve la lista completa y en **Resumen → Agregar integrante** se puede hacer una carga manual.

**Asistencia = entrar a un canal de voz.** Estar online en Discord no convierte a nadie en activo. “Ahora en voz” muestra solo quienes están dentro de voz y el nombre del canal; muteados e invisibles en voz también cuentan. Resumen, La banda y Los juegos calculan sus métricas solo con tramos en voz. El radar mide última visita a voz, días y horas en voz, juego + voz y ausencias; una señal online reciente no tapa una ausencia. La lista sigue incluyendo a todos para reconocer a quienes no entran. La pausa conserva el historial y evita avisos de ausencia. El historial conserva también la presencia fuera de voz, rotulada como contexto; los registros anteriores no se borran.

El radar usa el período y el jugador elegidos; los filtros de juego y actividad solo afectan a las estadísticas de debajo. Así, filtrar por un juego no convierte falsamente en ausente a quien jugó otro. La última visita se calcula con tramos en voz hasta el final del período seleccionado, sin mirar conexiones posteriores ni tomar presencia online como asistencia.

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

## Hosting elegido: Render Free + Supabase Free

El Blueprint usa **Render Free**, sin disco pago, y una base PostgreSQL externa mediante `DATABASE_URL`. Para conservar historial sin pagar, se puede usar un proyecto **Supabase Free**. Render ejecuta el dashboard, la API y el bot; Supabase conserva registros e integrantes aunque Render se reinicie.

La combinación tiene límites: Render Free puede suspenderse después de 15 minutos sin tráfico entrante y sus archivos locales se pierden al reiniciar, redesplegar o suspenderse. Supabase Free tiene 500 MB de base y puede pausarse tras una semana de inactividad. No se garantiza observación continua 24/7. No hay código de auto-ping ni recuperación inventada de actividad perdida.

`REQUIRE_DATABASE_URL=true` impide que el Blueprint arranque usando accidentalmente SQLite efímero. En una PC, SQLite sigue disponible sin configurar `DATABASE_URL`.

GitHub guarda el código y Render lo ejecuta. GitHub Pages sigue siendo una alternativa para carga manual local, sin bot ni sincronización entre navegadores.

## Probar sin configurar Discord

Con Python 3.12 o superior, desde esta carpeta:

```bash
python -m http.server 8000 --directory dist
```

Abrir `http://localhost:8000`. No abrir `index.html` directamente con `file://`, porque usa módulos JavaScript. El tablero abre con tus datos reales; si no hay historial, muestra una lista vacía. Usar **Agregar integrante** para crear la lista manual o **Registrar sesión** para crear el primer registro. La muestra solo aparece al pulsar **Ver muestra ficticia**.

Los datos locales se guardan por origen del sitio. Un cambio de dominio no mueve esos datos: exportar el JSON e importarlo en el nuevo dominio. Borrar los datos del navegador también borra el historial local; hacer respaldos periódicos.

## Publicar gratis en Render y Supabase

1. Descargar la versión actualizada del proyecto y subir sus archivos descomprimidos a GitHub. En la raíz deben quedar `server.py`, `storage.py`, `requirements.txt`, `render.yaml` y `dist/`. No subir credenciales.
2. Crear una cuenta en [Supabase](https://supabase.com/) y un proyecto **Free**. Elegir una región cercana a la del servicio Render y guardar la contraseña de la base.
3. Cuando el proyecto esté listo, abrir **Connect** y elegir **Session pooler**. Copiar su conexión PostgreSQL y reemplazar `[YOUR-PASSWORD]` con la contraseña real. Si tiene caracteres reservados, codificarlos para URL. No usar la API key ni la URL web del proyecto.
4. En Render: **New → Web Service**, conectar el repositorio, elegir **Python 3** y el plan **Free**. Build Command: `pip install -r requirements.txt`. Start Command: `python server.py`. No agregar discos ni una base de datos paga de Render. Si Blueprint pide facturación, usar esta creación manual.
5. Completar las variables solicitadas: `DATABASE_URL` con la conexión del paso 3, `DISCORD_TOKEN` con el token del bot y `DISCORD_GUILD_ID` con el ID del servidor.
6. Agregar `ADMIN_KEY` con una cadena aleatoria de al menos 24 caracteres y `REQUIRE_DATABASE_URL=true`. Revisar que el servicio esté en Free y desplegar. En la alternativa con Blueprint, esas dos variables ya están declaradas en `render.yaml`.
7. Abrir la URL HTTPS del servicio Render y verificar **Bot conectado** en Datos e integración. Las tablas se crean automáticamente en el esquema privado `vicio`; no hace falta pegar SQL en Supabase ni exponer ese esquema en su Data API.
8. Copiar `ADMIN_KEY` desde Environment del servicio e ingresarla en **Datos e integración → Clave de administración** para editar integrantes y datos manuales.

El pooler en modo sesión permite conectarse por IPv4 sin contratar el complemento IPv4 de Supabase. El backend usa TLS por defecto, transacciones atómicas e identificadores parametrizados. Las credenciales quedan en Render y nunca se envían al navegador ni se agregan al repositorio.

Si ya se había creado el servicio con el Blueprint anterior, verificar manualmente que el plan sea Free y que no quede un disco pago asociado. Los cambios de este ZIP no modifican por sí solos recursos que ya existan en tu cuenta. Respaldar registros antes de cambiar una base existente. La nueva conexión no migra automáticamente los datos SQLite previos: usar exportación/importación JSON con el bot pausado.

El dashboard y la lectura de la API siguen públicos por defecto en Render. La clave de administración protege modificaciones, no lectura. Un repositorio privado en GitHub no vuelve privada la URL de Render.

### Qué ocurre si Render o Supabase se suspenden

Los registros confirmados quedan en PostgreSQL. El bot solo observa mientras el proceso está activo; si se suspende, no registra nuevas conexiones hasta volver a arrancar. Un hueco de observación no prueba que alguien faltó. Abrir el dashboard puede despertar el servicio, pero no permite recuperar actividad anterior.

Si Supabase está pausado, reanudarlo en su panel y reiniciar el servicio de Render si no pudo arrancar. El nivel gratuito no incluye una promesa de continuidad o conservación indefinida: mantener respaldos JSON periódicos, respetar sus cuotas y revisar los avisos del proveedor.

### Llevar registros locales al servidor

Exportar el JSON desde el dominio anterior. Abrir la URL de Render, guardar la clave e importar el archivo. No importar datos de muestra. Si ya había registros o integrantes locales en el mismo origen, el tablero muestra Discord y conserva los anteriores en el navegador. Descargar **Datos e integración → Descargar respaldo local pendiente** e importar ese JSON con la clave de administración para migrarlos. La muestra ficticia nunca se mezcla con los datos reales.

## Crear el bot de Discord

1. Ir al [Developer Portal](https://discord.com/developers/applications), crear una aplicación y abrir **Bot**.
2. Obtener el token y configurarlo **solo** como variable de entorno `DISCORD_TOKEN` en el backend. No ponerlo en HTML, GitHub ni en la clave de administración del dashboard.
3. Activar **Presence Intent** y **Server Members Intent** en la sección Privileged Gateway Intents. El código solicita además Guilds y Voice States. No requiere Message Content, Administrator, lectura de mensajes ni conexión a un canal de voz.
4. Invitar la aplicación al servidor usando el alcance `bot`. Dar acceso de visualización a los canales que se quieran observar. No solicita ni envía mensajes.
5. Activar el modo desarrollador de Discord, copiar el ID del servidor y guardarlo como `DISCORD_GUILD_ID`.
6. Opcional: definir `WATCH_USER_IDS` con IDs de miembros separados por coma. Vacío observa todos los miembros humanos del servidor configurado; los bots se excluyen. Para un grupo chico, es útil dejar una lista explícita.
7. Reiniciar/desplegar el servicio. En **Datos e integración** debe aparecer **Bot conectado**. El resumen real mostrará **Ahora en voz**.

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

Las métricas principales usan solo tramos en voz y suman horas-persona. El Historial permite consultar también los tramos fuera de voz. Cuatro personas jugando juntas una hora son cuatro horas de juego. Los intervalos se recortan al rango seleccionado, incluso si cruzan medianoche. Los gráficos y las fichas respetan todos los filtros; «Ahora en el club» muestra el estado actual sin filtros de historial.

No se elimina automáticamente el historial al cumplir un año. Se conserva mientras exista la base, con límite de 100.000 tramos por carga del dashboard/importación. Para grupos grandes o varios años, agregar consultas paginadas y agregaciones en el backend. El bot está pensado para un servidor pequeño/mediano y una sola instancia del proceso, usando SQLite en local o PostgreSQL externo en Render Free.

## Respaldos y exportaciones

- **Respaldar todo** exporta todos los registros del conjunto actual (muestra o datos reales), sin aplicar los filtros.
- **Exportar vista CSV** exporta solo los tramos filtrados y sus horas recortadas al período. Incluye fechas UTC y los estados adicionales.
- **Importar respaldo** combina por ID. Omite duplicados idénticos y rechaza IDs con contenido distinto, sesiones futuras y superposiciones. No acepta datos ficticios en el historial real.
- Para un respaldo físico de SQLite mientras está activo, usar la API de backup de SQLite o detener el servicio antes de copiar el archivo. No copiar solo el `.sqlite` ignorando su WAL mientras hay escrituras.

## Comprobar el proyecto

Node 20+ para las pruebas del modelo; Python y dependencias para las pruebas del backend. Instalar `python -m pip install -r requirements-dev.txt` para incluir la validación de todas las consultas con el analizador PostgreSQL de pglast, sin servidor ni credenciales:

```bash
npm test
npm run check
python -m unittest discover -s tests -p 'test_*.py' -v
```

No se necesita Node en producción. Para ejecutar las mismas pruebas de almacenamiento contra PostgreSQL, definir `VICIO_TEST_DATABASE_URL` apuntando a una base desechable y ejecutar `python -m unittest discover -s tests -p 'test_postgres.py' -v`. La prueba elimina únicamente sus IDs temporales al finalizar; nunca usar credenciales de producción. Se verifican categorías, recorte de intervalos, sumas, sesiones, cambio de mes/año, respaldos, superposiciones, atomicidad de SQLite, continuidad del bot, anotaciones y autorización de la API. El bot necesita un token y servidor reales para una prueba de integración con Discord.

## Archivos

```text
dist/                   Dashboard estático sin build
server.py               API + observador Discord opcional
storage.py              Validación y SQLite
requirements.txt        Dependencias Python
render.yaml             Render Free + PostgreSQL externo
.env.example            Variables documentadas, sin secretos
.github/workflows/      Publicación manual en Pages
tests/                  Verificación del modelo y backend
```

Las fuentes web son Barlow Condensed, DM Sans e IBM Plex Mono mediante Google Fonts; hay fuentes de sistema como respaldo. No hay analítica, trackers ni procesamiento de audio.

## Fuentes de infraestructura

- [GitHub Pages: hosting estático](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages)
- [Render: límites del servicio gratuito](https://render.com/docs/free)
- [Supabase: plan Free y límites](https://supabase.com/pricing)
- [Supabase: conexión PostgreSQL y Session pooler](https://supabase.com/docs/guides/database/connecting-to-postgres)
- [Render: referencia de Blueprints](https://render.com/docs/blueprint-spec)
- [Discord: Gateway e intents](https://docs.discord.com/developers/events/gateway)
- [discord.py: intents](https://discordpy.readthedocs.io/en/stable/intents.html)


## Detector de micrófono en el canal fijo

En **Datos e integración**, guardar primero la clave de administración existente. En **Detector de micrófono**, elegir el canal habitual y pulsar **Guardar canal y aplicar**. El bot se une visible, con su micrófono muteado y sin ensordecerse. Necesita los permisos Ver canal y Conectar; si el canal está lleno, liberar un lugar. Elegir **Desactivado** detiene la medición. La elección se guarda en PostgreSQL y sobrevive a redeploys; `VOICE_CHANNEL_ID` sirve como valor inicial opcional.

El panel del detector muestra tiempo dentro de voz, tiempo realmente observado, cobertura y segundos aproximados de transmisión de micrófono. No almacena, descifra ni reproduce audio: solo inspecciona identificadores y marcas de tiempo de cabeceras RTP de usuarios del canal elegido. Música, ruido y breves paquetes de silencio pueden sumar actividad; no es una prueba de palabras habladas. El dato manual «habló» sigue separado y no se sobrescribe.

Los períodos sin conexión, otros canales, sesiones previas y pausas del proceso quedan sin medición. Cero segundos no se presenta como ausencia de actividad si falta cobertura del tramo. Los contadores de un tramo parcialmente incluido en el filtro de fechas se prorratean y se muestran como aproximados. Los respaldos JSON preservan esos contadores; la configuración del canal queda en el servidor.

La recepción usa un adaptador pequeño sobre hooks internos de **discord.py 2.7.1**, fijada con extras de voz (PyNaCl y davey para DAVE). No usar extensiones antiguas sin soporte del cifrado actual. Revisar las pruebas del adaptador antes de actualizar esa versión. No requiere FFmpeg ni transcripción. Si Render no permite completar la conexión UDP, el dashboard conserva la presencia y muestra el error del detector; no fabrica actividad ni silencio. El funcionamiento real se verifica después de elegir el canal y transmitir desde dos cuentas. Render Free sigue sujeto a suspensiones y huecos.
