"""One process: dashboard + administration API + Discord-only activity writer."""
import asyncio
import hmac
import logging
import os
import uuid
from datetime import timedelta
from pathlib import Path

from aiohttp import web
from storage import Store, utcnow, stamp, parse
from microphone import MicMeter, MicController

LOG = logging.getLogger("vicio")
ROOT = Path(__file__).resolve().parent


class Observer:
    def __init__(self, store):
        self.store = store
        self.active = {}
        self.connected = False
        self.last_seen = None
        self.mic = MicMeter(self)
        self.voice = MicController(self)

    def change(self, user_id, state, now=None):
        now = now or utcnow()
        previous = self.active.get(user_id)
        if previous and previous["state"] == state and now - previous["start"] < timedelta(hours=6):
            self.flush(user_id, now)
            return
        session_id = previous["sessionId"] if previous else str(uuid.uuid4())
        if previous:
            self.flush(user_id, now)
            self.mic.forget(previous["id"])
            del self.active[user_id]
        if state is not None:
            self.active[user_id] = dict(id=str(uuid.uuid4()), start=now, sessionId=session_id, state=state)

    def flush(self, user_id, now=None):
        now = now or utcnow()
        active = self.active.get(user_id)
        if not active or (now - active["start"]).total_seconds() < 1:
            return
        self.mic.tick(now)
        r = {**active["state"], "id": active["id"], "sessionId": active["sessionId"],
             "start": stamp(active["start"]), "end": stamp(now),
             "spoke": "unknown", "source": "bot", "note": ""}
        mic = self.mic.value(active, now)
        if mic:
            r["mic"] = mic
        self.store.put(r)

    def pause(self):
        now = utcnow()
        self.mic.tick(now)
        self.connected = False
        try:
            for user_id in list(self.active):
                self.flush(user_id, now)
        finally:
            for active in self.active.values():
                self.mic.forget(active["id"])
            self.active.clear()
            self.mic.reset_transport()
            self.connected = False

    def snapshot(self):
        # The live club is voice attendance, not the list of Discord users online.
        return [{**a["state"], "start": stamp(a["start"])} for a in self.active.values()
                if a["state"].get("inVoice") is True] if self.connected else []

    def gaming_snapshot(self):
        # A separate feed keeps online gamers out of the "Ahora en voz" panel.
        return [{**a["state"], "start": stamp(a["start"])} for a in self.active.values()
                if a["state"].get("inVoice") is False and a["state"].get("game")
                and a["state"].get("status") in ("online", "idle", "dnd")] if self.connected else []



async def discord_loop(observer):
    import discord
    guild_id = int(os.environ["DISCORD_GUILD_ID"])
    watch = set(filter(None, os.environ.get("WATCH_USER_IDS", "").replace(" ", "").split(",")))
    intents = discord.Intents.none()
    intents.guilds = intents.members = intents.presences = intents.voice_states = True
    client = discord.Client(intents=intents)

    def update(member):
        if member.guild.id != guild_id or member.bot or (watch and str(member.id) not in watch):
            return
        observer.store.put_member(dict(id=str(member.id), name=member.display_name[:60], since=stamp(utcnow()), active=True), discover=True)
        voice = member.voice
        in_voice = bool(voice and voice.channel)
        if member.status == discord.Status.offline and not in_voice:
            observer.change(str(member.id), None)
            return
        games = [a.name for a in member.activities if a.type == discord.ActivityType.playing and getattr(a, "name", None)]
        # Activity arrays are not an authoritative list of running software.
        game = games[0][:100] if games else None
        observer.change(str(member.id), dict(userId=str(member.id), name=member.display_name[:60],
            game=game, status=str(member.status) if str(member.status) in ["online", "idle", "dnd"] else "offline",
            inVoice=in_voice, channel=voice.channel.name[:100] if in_voice else "",
            channelId=str(voice.channel.id) if in_voice else "",
            muted=bool(in_voice and (voice.self_mute or voice.mute)),
            deafened=bool(in_voice and (voice.self_deaf or voice.deaf)),
            streaming=bool(in_voice and voice.self_stream), camera=bool(in_voice and voice.self_video)))

    async def sync():
        guild = client.get_guild(guild_id)
        if not guild:
            LOG.error("El bot no tiene acceso al servidor configurado.")
            observer.connected = False
            return
        observer.pause()
        observer.connected = True
        observer.last_seen = stamp(utcnow())
        for member in guild.members:
            update(member)
        LOG.info("Observación iniciada (%s miembros visibles).", len(guild.members))

    @client.event
    async def on_ready():
        await sync()

    @client.event
    async def on_resumed():
        await sync()

    @client.event
    async def on_disconnect():
        observer.pause()
        LOG.warning("Discord desconectado. No se computa actividad durante el corte.")

    @client.event
    async def on_presence_update(before, after):
        if observer.connected:
            update(after)

    @client.event
    async def on_voice_state_update(member, before, after):
        if observer.connected:
            update(member)

    @client.event
    async def on_member_remove(member):
        if member.guild.id == guild_id:
            observer.change(str(member.id), None)

    async def heartbeat():
        while True:
            await asyncio.sleep(60)
            if not client.is_ready():
                continue
            try:
                if not observer.connected:
                    await sync()
                observer.last_seen = stamp(utcnow())
                guild = client.get_guild(guild_id)
                if guild:
                    for member in guild.members:
                        update(member)
            except Exception:
                # Do not fabricate continuous attendance while storage is unavailable.
                observer.active.clear()
                observer.connected = False
                LOG.exception("Almacenamiento no disponible. Se reintentará la observación en un minuto.")

    task = asyncio.create_task(heartbeat())
    mic_task = asyncio.create_task(observer.voice.run(client, guild_id))
    try:
        await client.start(os.environ["DISCORD_TOKEN"], reconnect=True)
    finally:
        task.cancel()
        mic_task.cancel()
        await asyncio.gather(task, mic_task, return_exceptions=True)
        observer.pause()
        await client.close()


def create_app(db_path=None, admin_key=None, enable_bot=True):
    admin_key = admin_key if admin_key is not None else os.environ.get("ADMIN_KEY", "")
    if len(admin_key) < 24:
        raise ValueError("Definí ADMIN_KEY con al menos 24 caracteres antes de iniciar el servidor.")
    database_url = os.environ.get("DATABASE_URL", "").strip()
    if not db_path and os.environ.get("REQUIRE_DATABASE_URL") == "true" and not database_url:
        raise ValueError("Configurá DATABASE_URL con una base PostgreSQL persistente. Render Free no conserva SQLite.")
    if database_url and not database_url.startswith(("postgres://", "postgresql://")):
        raise ValueError("DATABASE_URL debe ser una conexión PostgreSQL, no una API key ni una URL del dashboard.")
    store = Store(db_path or database_url or os.environ.get("DATA_PATH", str(ROOT / "data" / "vicio.sqlite")))
    observer = Observer(store)

    @web.middleware
    async def boundary(request, handler):
        try:
            if request.path.startswith("/api/") and request.method != "GET":
                supplied = request.headers.get("Authorization", "").removeprefix("Bearer ")
                if not hmac.compare_digest(supplied.encode(), admin_key.encode()):
                    return web.json_response({"error": "Clave de administración incorrecta o ausente."}, status=401)
            response = await handler(request)
        except (ValueError, KeyError, TypeError) as error:
            response = web.json_response({"error": str(error)}, status=400)
        except web.HTTPException as error:
            response = error
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "same-origin"
        response.headers["X-Frame-Options"] = "DENY"
        if request.path.startswith("/api/") or request.path == "/":
            response.headers["Cache-Control"] = "no-store"
        elif request.path.endswith((".js", ".css")):
            response.headers["Cache-Control"] = "no-cache"
        return response

    app = web.Application(middlewares=[boundary], client_max_size=40 * 1024 * 1024)
    app[web.AppKey("store", Store)] = store
    app[web.AppKey("observer", Observer)] = observer

    async def state(request):
        return web.json_response({"version": 1, "records": [r for r in store.all() if r["source"] == "bot"], "members": [m for m in store.members() if m["id"].isdecimal()], "live": observer.snapshot(),
                                  "awayLive": observer.gaming_snapshot(),
                                  "bot": {"connected": observer.connected, "lastSeen": observer.last_seen},
                                  "voice": observer.voice.snapshot()})

    async def configure_voice(request):
        data = await request.json()
        if not isinstance(data, dict):
            raise ValueError("Configuración inválida.")
        observer.voice.configure(data.get("channelId"))
        return web.json_response({"voice": observer.voice.snapshot()})

    async def health(request):
        return web.json_response({"ok": True, "botConnected": observer.connected,
                                  "voiceConnected": observer.voice.healthy()})

    async def admin_session(request):
        return web.json_response({"ok": True})

    async def pause_member(request):
        data = await request.json()
        if not isinstance(data, dict) or set(data) != {"active"} or type(data["active"]) is not bool:
            raise ValueError("Solo se puede cambiar la pausa del integrante.")
        member = store.set_member_active(request.match_info["id"], data["active"])
        return web.json_response({"member": member})

    async def index(request):
        return web.FileResponse(ROOT / "dist" / "index.html")

    app.router.add_get("/api/state", state)
    app.router.add_get("/api/health", health)
    app.router.add_put("/api/voice-channel", configure_voice)
    app.router.add_post("/api/admin/session", admin_session)
    app.router.add_patch("/api/members/{id}", pause_member)
    app.router.add_get("/", index)
    app.router.add_static("/", ROOT / "dist", show_index=False)

    async def lifecycle(app):
        task = None
        if enable_bot and os.environ.get("DISCORD_TOKEN"):
            if not os.environ.get("DISCORD_GUILD_ID", "").isdigit():
                raise ValueError("Definí DISCORD_GUILD_ID con el ID numérico de tu servidor.")

            async def runner():
                try:
                    await discord_loop(observer)
                except asyncio.CancelledError:
                    raise
                except Exception:
                    # The dashboard stays available when Discord credentials/intents fail.
                    observer.pause()
                    LOG.exception("No se pudo iniciar el bot. Revisá el token, el servidor y los intents.")

            task = asyncio.create_task(runner())
        yield
        if task:
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)
        store.close()

    app.cleanup_ctx.append(lifecycle)
    return app


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    web.run_app(create_app(), host="0.0.0.0", port=int(os.environ.get("PORT", "8000")), access_log=None)
