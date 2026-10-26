"""One process: dashboard + authenticated manual API + optional Discord observer."""
import asyncio
import hmac
import logging
import os
import uuid
from datetime import timedelta
from pathlib import Path

from aiohttp import web
from storage import Store, utcnow, stamp, parse

LOG = logging.getLogger("vicio")
ROOT = Path(__file__).resolve().parent


class Observer:
    def __init__(self, store):
        self.store = store
        self.active = {}
        self.connected = False
        self.last_seen = None

    def change(self, user_id, state, now=None):
        now = now or utcnow()
        previous = self.active.get(user_id)
        if previous and previous["state"] == state and now - previous["start"] < timedelta(hours=6):
            self.flush(user_id, now)
            return
        session_id = previous["sessionId"] if previous else str(uuid.uuid4())
        if previous:
            self.flush(user_id, now)
            del self.active[user_id]
        if state is not None:
            self.active[user_id] = dict(id=str(uuid.uuid4()), start=now, sessionId=session_id, state=state)

    def flush(self, user_id, now=None):
        now = now or utcnow()
        active = self.active.get(user_id)
        if not active or (now - active["start"]).total_seconds() < 1:
            return
        # Heartbeats only extend the interval; they preserve a manual speech annotation.
        existing = self.store.get(active["id"])
        r = {**active["state"], "id": active["id"], "sessionId": active["sessionId"],
             "start": stamp(active["start"]), "end": stamp(now),
             "spoke": existing["spoke"] if existing else "unknown", "source": "bot", "note": ""}
        self.store.put(r)

    def pause(self):
        now = utcnow()
        for user_id in list(self.active):
            self.flush(user_id, now)
        self.active.clear()
        self.connected = False

    def snapshot(self):
        return [{**a["state"], "start": stamp(a["start"])} for a in self.active.values()] if self.connected else []

    def blocks(self, r):
        active = self.active.get(r["userId"])
        return active and parse(r["end"]) > active["start"] and parse(r["start"]) < utcnow()


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
            if observer.connected and client.is_ready():
                observer.last_seen = stamp(utcnow())
                guild = client.get_guild(guild_id)
                if guild:
                    for member in guild.members:
                        update(member)

    task = asyncio.create_task(heartbeat())
    try:
        await client.start(os.environ["DISCORD_TOKEN"], reconnect=True)
    finally:
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)
        observer.pause()
        await client.close()


def create_app(db_path=None, admin_key=None, enable_bot=True):
    admin_key = admin_key if admin_key is not None else os.environ.get("ADMIN_KEY", "")
    if len(admin_key) < 24:
        raise ValueError("Definí ADMIN_KEY con al menos 24 caracteres antes de iniciar el servidor.")
    store = Store(db_path or os.environ.get("DATA_PATH", str(ROOT / "data" / "vicio.sqlite")))
    observer = Observer(store)

    @web.middleware
    async def boundary(request, handler):
        try:
            if request.path.startswith("/api/") and request.method != "GET":
                supplied = request.headers.get("Authorization", "").removeprefix("Bearer ")
                if not hmac.compare_digest(supplied.encode(), admin_key.encode()):
                    return web.json_response({"error": "Clave incorrecta o ausente. Guardala en Datos e integración."}, status=401)
            response = await handler(request)
        except (ValueError, KeyError, TypeError) as error:
            response = web.json_response({"error": str(error)}, status=400)
        except web.HTTPException as error:
            response = error
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "same-origin"
        response.headers["X-Frame-Options"] = "DENY"
        if request.path.startswith("/api/"):
            response.headers["Cache-Control"] = "no-store"
        return response

    app = web.Application(middlewares=[boundary], client_max_size=40 * 1024 * 1024)
    app[web.AppKey("store", Store)] = store
    app[web.AppKey("observer", Observer)] = observer

    async def state(request):
        return web.json_response({"version": 1, "records": store.all(), "members": store.members(), "live": observer.snapshot(),
                                  "bot": {"connected": observer.connected, "lastSeen": observer.last_seen}})

    async def health(request):
        return web.json_response({"ok": True, "botConnected": observer.connected})

    async def put_member(request):
        member = await request.json()
        if member.get("id") != request.match_info["id"]:
            raise ValueError("Identificador inválido.")
        return web.json_response({"member": store.put_member(member)})

    async def put(request):
        r = await request.json()
        if r.get("id") != request.match_info["id"] or r.get("source") != "manual":
            raise ValueError("Identificador u origen inválido.")
        existing = store.get(r["id"])
        if existing and existing["source"] != "manual":
            raise ValueError("Para registros del bot, usá la corrección de habla.")
        if observer.blocks(r):
            raise ValueError("El bot está observando a este jugador. No se puede superponer un tramo manual.")
        return web.json_response({"record": store.put(r)})

    async def annotate(request):
        r = await request.json()
        return web.json_response({"record": store.annotate(request.match_info["id"], r.get("spoke"))})

    async def delete(request):
        existing = store.get(request.match_info["id"])
        if not existing or existing["source"] != "manual":
            raise ValueError("Solo se pueden eliminar registros manuales.")
        store.delete(request.match_info["id"])
        return web.json_response({"ok": True})

    async def import_data(request):
        data = await request.json()
        if data.get("version") != 1 or not isinstance(data.get("records"), list):
            raise ValueError("Formato de respaldo inválido.")
        for r in data["records"]:
            if observer.blocks(r):
                raise ValueError("Hay tramos que se superponen con una observación en curso. Pausá el bot antes de importar.")
        return web.json_response({"added": store.import_records(data["records"], data.get("members", []))})

    async def index(request):
        return web.FileResponse(ROOT / "dist" / "index.html")

    app.router.add_get("/api/state", state)
    app.router.add_get("/api/health", health)
    app.router.add_put("/api/members/{id}", put_member)
    app.router.add_put("/api/records/{id}", put)
    app.router.add_patch("/api/records/{id}/speech", annotate)
    app.router.add_delete("/api/records/{id}", delete)
    app.router.add_post("/api/import", import_data)
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
