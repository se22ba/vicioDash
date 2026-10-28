# VICIO

Dashboard de actividad de Discord. Los registros los crea únicamente el bot. La web permite consultar, filtrar y exportar; no permite cargar, importar, editar ni eliminar sesiones, ni corregir el dato de habla.

La lista de integrantes se obtiene de Discord. Desde cada integrante se puede pausar o reactivar su inclusión en asistencia. Esa acción requiere la clave de administración y no modifica nombre, fecha de alta ni historial. Los cambios de nombre se actualizan desde Discord y conservan la pausa.

## Ranking Tuts

El resumen abre con un podio y una pegatina de Tuts coronado. Más índice Tuts significa menos participación: 100 − 100 × (0,6 × frecuencia relativa + 0,4 × duración relativa). Frecuencia = días en voz / días de pertenencia dentro del período; duración = minutos en voz / esos días. Cada métrica se divide por el máximo de la banda. Los empates comparten puesto y corona. Sin voz registrada no se corona a nadie.

El ranking usa toda la banda, independientemente de los otros filtros, y permite alternar el período elegido con todo el historial hasta la fecha final. El archivo muestra hasta seis semanas finalizadas recalculadas desde los registros persistidos; no son snapshots de coronaciones. Usa el horario del dispositivo y la lista/pausas actuales. Los miembros con menos de siete días llevan marca provisional. El micrófono sin observar no afecta el puntaje. Los cortes del bot no se recuperan.

La web consulta cada 30 segundos y al volver a la pestaña. Con el bot conectado agrega al cálculo la cola todavía no persistida de la sesión en voz, sin duplicar minutos, y la limita al último heartbeat más 60 segundos. No requiere migración de base de datos.

La distinción **Io paso** cruza intervalos simultáneos por `channelId` para contar únicamente tiempo en compañía en la misma sala. Requiere 30 minutos observados en compañía y 80% de cobertura tanto del integrante como de sus compañeros. Se entrega con 50% o más sin actividad y una tasa de actividad de hasta la mitad del promedio de los compañeros durante esos encuentros (ponderado por tiempo). Una sala equilibrada o completamente silenciosa no genera premios colectivos. El sello permanece en la misma tabla Tuts y su botón muestra la evidencia.

Los registros contienen contadores agregados, no una cronología del audio. Para intersecciones parciales usamos límites conservadores: el mínimo de segundos que necesariamente fueron observados en compañía, el máximo de actividad propia que pudo ocurrir ahí y el mínimo de actividad ajena que necesariamente ocurrió ahí. Si no se puede confirmar la diferencia, no se entrega el sello. No se reparte el silencio a ciegas entre tiempo solo y acompañado. Las pausas excluyen al candidato; una persona pausada que efectivamente comparte sala sigue siendo compañía. Los registros sin canal conocido quedan fuera de esta distinción. No se infiere habla del mute ni de datos ausentes. La cola en vivo nunca copia contadores acumulados al tiempo todavía no guardado.

El podio muestra **Tuts de oro, plata y bronce** para los tres niveles distintos de puntaje más altos. El puntaje se redondea a una décima antes de asignar posiciones; los empates comparten metal y se muestran juntos en el podio, sin desempates por nombre. Los niveles sin datos quedan vacantes. La tabla mantiene posiciones de competición (por ejemplo 1, 1, 3) y muestra medallas y títulos por separado.

Los títulos tipo tarjeta de partida se calculan con datos reales del período: **Operador fantasma** (cero voz), **El ancla** (máximo tiempo en voz), **Fichaje perfecto** (máximo de días, al menos dos), **Multiclase** (al menos tres juegos en voz) y **Ninja del mic** (Io paso). Los empates en títulos de máximo reciben la misma distinción. Son etiquetas de actividad, no estadísticas del videojuego.

La edición de premios establece un mínimo tipográfico de 11 px, aumenta el cuerpo y el espaciado, apila el podio en pantallas pequeñas y mantiene controles táctiles y nombres largos legibles.

## Funciones

- Asistencia por entradas a canales de voz, última visita, días y horas.
- Historial por semana, mes, trimestre, semestre, año o fechas propias.
- Juegos y participantes; filtros de actividad y estados de voz.
- Detector opcional de actividad del micrófono en un canal fijo, sin grabación.
- Exportación JSON y CSV. Los datos locales de versiones anteriores pueden descargarse, pero no se incorporan a la actividad del servidor.
- Los registros manuales antiguos permanecen en la base, sin mostrarse en el tablero. No se borran datos existentes durante la actualización.

Estar online fuera de voz no suma asistencia. La captura automática comienza cuando arranca el bot y no recupera actividad anterior. Los cortes dejan tiempo sin observar.

## Render Free y Supabase

1. Crear un proyecto Supabase Free. Copiar su conexión PostgreSQL desde **Connect → Session pooler**, con la contraseña de la base codificada para URL cuando corresponda.
2. En Render, crear **New → Web Service** desde el repositorio. Elegir Python y **Free**. Build Command: `pip install -r requirements.txt`. Start Command: `python server.py`.
3. Configurar `DATABASE_URL`, `REQUIRE_DATABASE_URL=true`, `DISCORD_TOKEN`, `DISCORD_GUILD_ID` y una `ADMIN_KEY` aleatoria de al menos 24 caracteres. El `render.yaml` conserva la alternativa Blueprint; si solicita facturación, usar Web Service manual.
4. Desplegar y abrir la URL del servicio. El esquema privado `vicio` se crea automáticamente en PostgreSQL.
5. En **Datos e integración → Administración**, ingresar `ADMIN_KEY`. Se valida antes de guardarla en la pestaña. También puede ingresarse directamente al pausar un integrante.

No se requiere un disco ni una base paga de Render. Render Free puede suspender el proceso cuando queda inactivo y su disco es efímero: conservar la actividad en PostgreSQL. La suspensión o una desconexión interrumpen la observación. No hay auto-ping. Supabase Free tiene sus propias cuotas y puede pausarse por inactividad; conservar respaldos.

La lectura del dashboard y de su API es pública por defecto. La clave protege administración, no lectura. No subir tokens ni contraseñas al repositorio.

## Discord

1. Crear la aplicación y su bot en Discord Developer Portal.
2. Habilitar **Server Members Intent** y **Presence Intent**.
3. Invitar el bot al servidor con permiso para ver los canales. Para el detector de micrófono también necesita **Conectar** en el canal elegido.
4. Copiar el token a `DISCORD_TOKEN` y el ID del servidor a `DISCORD_GUILD_ID` en Render.
5. Dejar `WATCH_USER_IDS` vacío para observar a todos los integrantes humanos, o indicar IDs separados por coma. Los bots se excluyen.

## Micrófono

Elegir el canal fijo desde **Datos e integración → Detector de micrófono** y guardar. El bot se conecta visible, muteado y sin ensordecerse. Elegir **Desactivado** detiene el detector. `VOICE_CHANNEL_ID` es un valor inicial opcional; la elección hecha en el tablero se conserva en PostgreSQL.

El detector acumula segundos aproximados de transmisión a partir de identificadores y marcas de tiempo de cabeceras RTP. No descifra, reproduce ni guarda audio. Ruido, música y breves paquetes de silencio pueden sumar actividad; no confirma palabras habladas. Los cortes, otros canales y sesiones anteriores quedan sin medir. Los contadores se prorratean cuando un filtro recorta parte de un tramo.

El adaptador usa hooks internos de **discord.py 2.7.1**, fijada con extras de voz (PyNaCl y davey para DAVE). No requiere FFmpeg. Revisar el adaptador y sus pruebas antes de actualizar la dependencia. Si el hosting no completa la conexión UDP, el detector muestra un error; la asistencia sigue funcionando.

Un bot puede estar en un solo canal de voz de este servidor a la vez. La escucha simultánea de varios canales con varios bots no está implementada.

## API

Lectura:

- `GET /api/state`: registros del bot, integrantes de Discord, presencia actual y estado del detector.
- `GET /api/health`: estado del servicio.

Administración con `Authorization: Bearer ADMIN_KEY`:

- `POST /api/admin/session`: comprueba la clave, sin modificar registros.
- `PATCH /api/members/{id}` con `{"active": false}` o `true`: pausa o reactiva un integrante existente. Rechaza otros campos y no crea integrantes.
- `PUT /api/voice-channel` con `{"channelId": "..."}` o cadena vacía: selecciona o desactiva el detector.

No hay rutas de escritura de registros, importación, eliminación ni anotaciones humanas, incluso con clave de administración. El almacenamiento rechaza nuevos registros con origen manual. Las sesiones se escriben internamente desde el observador del bot.

## Desarrollo

Python 3.12:

```bash
python -m pip install -r requirements-dev.txt
export ADMIN_KEY="una-clave-local-de-al-menos-24-caracteres"
export DISCORD_TOKEN="token-del-bot"
export DISCORD_GUILD_ID="id-del-servidor"
python server.py
```

El servidor no carga `.env` automáticamente. `.env.example` enumera las variables. Sin token se puede consultar la interfaz vacía, sin carga manual. Una publicación estática solo muestra la interfaz; la actividad requiere el backend.

Verificación:

```bash
npm test
npm run check
python -m unittest discover -s tests -p 'test_*.py'
```

Las pruebas cubren acceso de solo lectura a registros, rechazo de escritura humana aun con clave, pausa limitada al estado activo, verificación de clave en la UI, sincronización de Discord y métricas. La sintaxis SQL de PostgreSQL se comprueba con pglast. Las pruebas contra un servidor PostgreSQL real requieren `VICIO_TEST_DATABASE_URL` de una base desechable. La recepción real de voz requiere elegir el canal y transmitir desde Discord.
