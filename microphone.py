"""Microphone transport activity. Never decode, retain, write or log audio.

Only RTP headers (user mapping, sequence and timestamp) reach the event loop.
Counters describe transmitted audio, not verified human speech. The adapter is
pinned to discord.py 2.7.1 because receive hooks are not a public API.
"""
import asyncio
import logging
import os
import struct

from storage import utcnow, stamp

LOG = logging.getLogger("vicio.microphone")


def packet_metadata(data, microphones):
    # Inspect RTP header only. Reject RTCP, video and unmapped streams.
    if len(data) < 12 or data[0] >> 6 != 2 or data[1] & 0x7f != 120:
        return None
    sequence, timestamp, ssrc = struct.unpack_from("!HII", data, 2)
    user_id = microphones.get(ssrc)
    return (user_id, ssrc, sequence, timestamp) if user_id else None


class MicMeter:
    def __init__(self, observer):
        self.observer = observer
        self.channel_id = ""
        self.health_check = lambda: False
        self.last_tick = None
        self.was_healthy = False
        self.totals = {}
        self.streams = {}

    def tick(self, now=None):
        now = now or utcnow()
        healthy = bool(self.health_check())
        if self.last_tick is not None:
            elapsed = (now - self.last_tick).total_seconds()
            # Do not invent coverage across a suspended process or stalled loop.
            if healthy and self.was_healthy and 0 <= elapsed <= 3:
                for active in self.observer.active.values():
                    state = active["state"]
                    if state.get("inVoice") and state.get("channelId") == self.channel_id:
                        dt = max(0, (now - max(self.last_tick, active["start"])).total_seconds())
                        total = self.totals.setdefault(active["id"], [0.0, 0.0])
                        total[0] += dt
        self.last_tick, self.was_healthy = now, healthy

    def reset_transport(self):
        self.was_healthy = False
        self.streams.clear()

    def pulse(self, user_id, ssrc, sequence, timestamp, received_at):
        if not self.health_check():
            return
        active = self.observer.active.get(user_id)
        if not active or not active["state"].get("inVoice") or active["state"].get("channelId") != self.channel_id:
            return
        if received_at < active["start"] or (utcnow() - received_at).total_seconds() > 3:
            return
        # Only scalar metadata is kept; RTP/Opus bytes are discarded by the reader.
        key = (user_id, ssrc)
        previous = self.streams.get(key)
        seconds = .02  # First frame estimate; Discord normally transmits 20 ms frames.
        if previous:
            seq_delta = (sequence - previous[0]) & 0xffff
            if seq_delta == 0 or seq_delta > 0x8000:
                return  # Duplicate or out-of-order datagrams must not add time.
            delta = ((timestamp - previous[1]) & 0xffffffff) / 48000
            if seq_delta == 1 and 0 < delta <= .12:
                seconds = delta
        self.streams[key] = (sequence, timestamp)
        total = self.totals.setdefault(active["id"], [0.0, 0.0])
        total[1] += seconds

    def value(self, active, now=None):
        total = self.totals.get(active["id"])
        if not total or total[0] <= 0:
            return None
        duration = max(0, ((now or utcnow()) - active["start"]).total_seconds())
        observed = min(duration, total[0])
        return dict(kind="rtp", observedSeconds=round(observed, 3),
                    activeSeconds=round(min(total[1], observed), 3))

    def forget(self, record_id):
        self.totals.pop(record_id, None)


class MicController:
    def __init__(self, observer):
        self.observer = observer
        self.store = observer.store
        self.client = None
        self.guild_id = None
        self.connection = None
        self.status = "disabled"
        self.error = ""
        self.channels = []
        self._next_attempt = 0
        self.meter = observer.mic
        self.meter.health_check = self.healthy

    @property
    def selected(self):
        return self.store.setting("voice_channel_id", os.environ.get("VOICE_CHANNEL_ID", "").strip())

    def healthy(self):
        vc = self.connection
        return bool(self.observer.connected and self.status == "connected" and vc
                    and vc.is_connected() and vc._connection._socket_reader.is_alive())

    def snapshot(self):
        selected = self.selected
        channel = next((c for c in self.channels if c["id"] == selected), None)
        status = self.status if selected else "disabled"
        if selected and (status == "disabled" or (status == "connected" and not self.healthy())):
            status = "waiting"
        return dict(channelId=selected, channelName=channel["name"] if channel else "",
                    status=status, connected=self.healthy(),
                    error=self.error, channels=self.channels)

    def configure(self, channel_id):
        if not isinstance(channel_id, str) or (channel_id and not channel_id.isdecimal()):
            raise ValueError("Elegí un canal de voz válido.")
        if channel_id and not any(c["id"] == channel_id for c in self.channels):
            raise ValueError("Ese canal no está disponible. Conectá el bot y actualizá la lista.")
        self.meter.tick()
        self.status = "waiting" if channel_id else "disabled"
        self.meter.reset_transport()
        self.store.set_setting("voice_channel_id", channel_id)
        self._next_attempt = 0
        self.error = ""

    async def close(self):
        self.meter.tick()
        self.status = "waiting"
        self.meter.reset_transport()
        vc, self.connection = self.connection, None
        if vc:
            try:
                await vc.disconnect(force=True)
            except Exception:
                LOG.warning("No se pudo completar la desconexión de voz.")

    async def run(self, client, guild_id):
        self.client, self.guild_id = client, guild_id
        try:
            while True:
                try:
                    await self.step(client, guild_id)
                except asyncio.CancelledError:
                    raise
                except Exception as error:
                    self.status = "error"
                    self.error = "Detector sin observación. Se reintentará la conexión."
                    self.meter.reset_transport()
                    LOG.warning("Detector temporalmente no disponible (%s).", type(error).__name__)
                    await asyncio.sleep(59)
                await asyncio.sleep(1)
        finally:
            await self.close()

    async def step(self, client, guild_id):
        self.meter.tick()
        guild = client.get_guild(guild_id) if client.is_ready() else None
        self.channels = [dict(id=str(c.id), name=c.name[:100]) for c in guild.voice_channels] if guild else []
        target = self.selected
        if not target or not guild or not self.observer.connected:
            if self.connection:
                await self.close()
        elif not self.connection or str(self.connection.channel.id) != target or not self.healthy():
            if self.connection:
                await self.close()
            if asyncio.get_running_loop().time() >= self._next_attempt:
                channel = guild.get_channel(int(target))
                if not channel or not any(c["id"] == target for c in self.channels):
                    self.status, self.error = "error", "El canal configurado ya no está disponible."
                elif not channel.permissions_for(guild.me).connect:
                    self.status, self.error = "error", "Falta el permiso Conectar del bot en este canal."
                else:
                    await self._connect(channel)
                self._next_attempt = asyncio.get_running_loop().time() + 60

    async def _connect(self, channel):
        import discord
        from discord.voice_state import VoiceConnectionState
        controller = self
        loop = asyncio.get_running_loop()

        class MeterVoiceClient(discord.VoiceClient):
            def __init__(self, client, target):
                self.microphones = {}
                super().__init__(client, target)

            def create_connection_state(self):
                return VoiceConnectionState(self, hook=self.on_voice_message)

            async def on_voice_message(self, ws, message):
                op, data = message.get("op"), message.get("d") or {}
                if op == 2:
                    self.microphones.clear()
                    controller.meter.reset_transport()
                elif op == 9:
                    controller.meter.reset_transport()
                elif op == 5 and "user_id" in data and int(data.get("speaking", 0)) & 1:
                    self.microphones[int(data["ssrc"])] = str(data["user_id"])
                elif op == 13:
                    uid = str(data.get("user_id"))
                    self.microphones = {ssrc: user for ssrc, user in self.microphones.items() if user != uid}

            def on_datagram(self, data):
                header = packet_metadata(data, self.microphones)
                if header:
                    loop.call_soon_threadsafe(controller.meter.pulse, *header, utcnow())

        self.status, self.error = "connecting", ""
        self.meter.reset_transport()
        self.meter.channel_id = str(channel.id)
        try:
            self.connection = await channel.connect(cls=MeterVoiceClient, timeout=20, reconnect=True,
                                                    self_mute=True, self_deaf=False)
            self.connection._connection.add_socket_listener(self.connection.on_datagram)
            self.status = "connected"
            LOG.info("Detector de micrófono conectado al canal configurado, sin grabación.")
        except Exception as error:
            await self.close()
            self.status = "error"
            self.error = "No se pudo conectar a voz. Revisá permisos, dependencias y la salida UDP del hosting."
            LOG.warning("Detector de micrófono no disponible (%s).", type(error).__name__)
