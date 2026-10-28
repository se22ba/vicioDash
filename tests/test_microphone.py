import asyncio
import struct
import unittest
from datetime import timedelta
from types import SimpleNamespace, ModuleType
from unittest.mock import AsyncMock, Mock, patch

from server import Observer
from storage import Store, utcnow, validate
from microphone import packet_metadata
from test_server import record


class MeterTests(unittest.TestCase):
    def setUp(self):
        self.store = Store(":memory:")
        self.observer = Observer(self.store)
        self.meter = self.observer.mic
        self.meter.channel_id = "99"
        self.healthy = True
        self.meter.health_check = lambda: self.healthy
        self.now = utcnow() - timedelta(minutes=2)
        self.state = {k: v for k, v in record(channelId="99").items()
                      if k not in ("id", "sessionId", "start", "end", "spoke", "note", "source")}
        self.observer.change("1", self.state, self.now)
        self.meter.tick(self.now)

    def tearDown(self):
        self.store.close()

    def test_coverage_counts_only_healthy_seconds_and_ignores_a_process_gap(self):
        self.meter.tick(self.now + timedelta(seconds=1))
        self.healthy = False
        self.meter.tick(self.now + timedelta(seconds=2))
        self.healthy = True
        self.meter.tick(self.now + timedelta(seconds=3))
        self.meter.tick(self.now + timedelta(seconds=4))
        self.meter.tick(self.now + timedelta(seconds=30))
        active = self.observer.active["1"]
        self.assertEqual(self.meter.value(active, self.now + timedelta(seconds=30))["observedSeconds"], 2)

    def test_other_channels_and_absent_users_do_not_gain_coverage(self):
        self.observer.change("2", {**self.state, "userId": "2", "channelId": "other"}, self.now)
        self.meter.tick(self.now + timedelta(seconds=1))
        self.assertIsNone(self.meter.value(self.observer.active["2"]))
        self.meter.pulse("unknown", 5, 1, 100, utcnow())

    def test_transport_counters_reject_duplicate_and_old_packets(self):
        # Reception times need to be current; historical test coverage is independent.
        active = self.observer.active["1"]
        active["start"] = utcnow() - timedelta(seconds=1)
        self.meter.tick(utcnow())
        self.meter.pulse("1", 7, 10, 1000, utcnow())
        self.meter.pulse("1", 7, 11, 1960, utcnow())
        self.meter.pulse("1", 7, 11, 1960, utcnow())
        self.meter.pulse("1", 7, 9, 40, utcnow())
        self.meter.pulse("1", 7, 12, 2920, utcnow() - timedelta(seconds=10))
        self.assertAlmostEqual(self.meter.totals[active["id"]][1], .04)

    def test_metrics_survive_flush_without_adopting_manual_speech(self):
        self.meter.tick(self.now + timedelta(seconds=1))
        self.observer.flush("1", self.now + timedelta(seconds=1))
        active = self.observer.active["1"]
        self.store.annotate(active["id"], "yes")
        self.observer.flush("1", self.now + timedelta(seconds=2))
        saved = self.store.get(active["id"])
        self.assertEqual(saved["mic"]["observedSeconds"], 2)
        self.assertEqual(saved["mic"]["activeSeconds"], 0)
        self.assertEqual(saved["spoke"], "unknown")

    def test_header_parser_exposes_only_scalars_and_rejects_video_rtcp_and_unknown_streams(self):
        packet = struct.pack("!BBHII", 0x80, 0x78, 42, 48000, 7) + b"not-stored-audio"
        self.assertEqual(packet_metadata(packet, {7: "1"}), ("1", 7, 42, 48000))
        self.assertIsNone(packet_metadata(packet, {}))
        self.assertIsNone(packet_metadata(b"short", {7: "1"}))
        self.assertIsNone(packet_metadata(bytes([0x80, 96]) + packet[2:], {7: "1"}))
        self.assertIsNone(packet_metadata(bytes([0x80, 201]) + packet[2:], {7: "1"}))

    def test_record_validation_and_backup_preserve_counters(self):
        r = record(mic=dict(kind="rtp", observedSeconds=50, activeSeconds=4))
        self.assertEqual(validate(r)["mic"]["activeSeconds"], 4)
        for mic in [dict(kind="rtp", observedSeconds=1, activeSeconds=2),
                    dict(kind="rtp", observedSeconds=float("nan"), activeSeconds=0),
                    dict(kind="rtp", observedSeconds=99999, activeSeconds=0)]:
            with self.assertRaises(ValueError):
                validate({**r, "mic": mic})

    def test_channel_setting_roundtrips_and_does_not_enter_records_backup(self):
        self.store.set_setting("voice_channel_id", "99")
        self.assertEqual(self.store.setting("voice_channel_id"), "99")
        self.assertEqual(self.store.all(), [])


class ControllerTests(unittest.IsolatedAsyncioTestCase):
    def controller_fixture(self):
        store = Store(":memory:")
        self.addCleanup(store.close)
        observer = Observer(store)
        observer.connected = True
        channel = SimpleNamespace(id=99, name="El after", permissions_for=lambda _: SimpleNamespace(connect=True))
        guild = SimpleNamespace(voice_channels=[channel], get_channel=lambda _: channel, me=object(), voice_client=None)
        channel.guild = guild
        client = SimpleNamespace(is_ready=lambda: True, get_guild=lambda _: guild)
        controller = observer.voice
        controller.client, controller.guild_id = client, 1
        store.set_setting("voice_channel_id", "99")
        return controller, client, guild, channel

    def voice_fixture(self, guild, channel, connected=False):
        voice = SimpleNamespace(channel=channel, is_connected=Mock(return_value=connected),
                                disconnect=AsyncMock(), cleanup=Mock(),
                                _connection=SimpleNamespace(_socket_reader=SimpleNamespace(is_alive=Mock(return_value=True))))
        voice.cleanup.side_effect = lambda: setattr(guild, "voice_client", None)
        guild.voice_client = voice
        return voice

    async def test_cached_orphan_is_disconnected_and_cleaned_even_when_disconnect_raises(self):
        controller, client, guild, channel = self.controller_fixture()
        orphan = self.voice_fixture(guild, channel)
        orphan.disconnect.side_effect = RuntimeError("disconnect failed")
        controller._connect = AsyncMock()
        await controller.step(client, 1)
        orphan.disconnect.assert_awaited_once_with(force=True)
        orphan.cleanup.assert_called_once()
        self.assertIsNone(guild.voice_client)
        controller._connect.assert_awaited_once_with(channel)

    async def test_health_tolerates_missing_transport_and_recognizes_an_internal_resume(self):
        controller, _, guild, channel = self.controller_fixture()
        voice = self.voice_fixture(guild, channel, connected=True)
        controller.connection = voice
        controller.status = "reconnecting"
        self.assertTrue(controller.healthy())
        voice._connection._socket_reader = None
        self.assertFalse(controller.healthy())
        voice._connection = None
        voice.is_connected.side_effect = AttributeError("transport missing")
        self.assertFalse(controller.healthy())

    async def test_transient_disconnect_gets_grace_and_can_resume_without_replacing_voice(self):
        controller, client, guild, channel = self.controller_fixture()
        voice = self.voice_fixture(guild, channel)
        controller.connection = voice
        controller._connect = AsyncMock()
        with patch("microphone.time.monotonic", return_value=100):
            await controller.step(client, 1)
        self.assertEqual(controller.status, "reconnecting")
        voice.disconnect.assert_not_awaited()
        voice.is_connected.return_value = True
        with patch("microphone.time.monotonic", return_value=105):
            await controller.step(client, 1)
        self.assertEqual(controller.status, "connected")
        self.assertEqual(controller.error, "")
        self.assertIsNone(controller._unhealthy_since)
        controller._connect.assert_not_awaited()

    async def test_unrecovered_voice_is_replaced_after_grace(self):
        controller, client, guild, channel = self.controller_fixture()
        voice = self.voice_fixture(guild, channel)
        controller.connection = voice
        controller._connect = AsyncMock()
        for now in (100, 110):
            with patch("microphone.time.monotonic", return_value=now):
                await controller.step(client, 1)
        controller._connect.assert_not_awaited()
        with patch("microphone.time.monotonic", return_value=116):
            await controller.step(client, 1)
        voice.disconnect.assert_awaited_once()
        voice.cleanup.assert_called_once()
        controller._connect.assert_awaited_once_with(channel)

    async def test_failed_reconnects_back_off_at_fifteen_thirty_and_sixty_seconds(self):
        controller, client, _, _ = self.controller_fixture()
        async def fail(_):
            controller.failures += 1
            controller.status = "error"
        controller._connect = AsyncMock(side_effect=fail)
        for now, attempts in [(0, 1), (14, 1), (15, 2), (44, 2), (45, 3), (104, 3), (105, 4)]:
            with patch("microphone.time.monotonic", return_value=now):
                await controller.step(client, 1)
            self.assertEqual(controller._connect.await_count, attempts)
        self.assertEqual(controller._next_attempt, 165)
        with patch("microphone.time.monotonic", return_value=110):
            self.assertEqual(controller.snapshot()["retryInSeconds"], 55)

    async def test_failed_or_cancelled_handshake_cleans_the_in_progress_client(self):
        for failure in (RuntimeError("private details"), asyncio.CancelledError()):
            with self.subTest(failure=type(failure).__name__):
                controller, client, guild, channel = self.controller_fixture()
                created = []
                class VoiceBase:
                    def __init__(self, client, target):
                        self.channel = target
                        self.disconnected = False
                        self.cleaned = False
                        guild.voice_client = self
                        created.append(self)
                    def is_connected(self):
                        return False
                    async def disconnect(self, *, force):
                        self.disconnected = force
                    def cleanup(self):
                        self.cleaned = True
                        guild.voice_client = None
                async def connect(**options):
                    options["cls"](client, channel)
                    raise failure
                channel.connect = connect
                discord = ModuleType("discord")
                discord.VoiceClient = VoiceBase
                voice_state = ModuleType("discord.voice_state")
                voice_state.VoiceConnectionState = object
                with patch.dict("sys.modules", {"discord": discord, "discord.voice_state": voice_state}):
                    if isinstance(failure, asyncio.CancelledError):
                        with self.assertRaises(asyncio.CancelledError):
                            await controller._connect(channel)
                    else:
                        await controller._connect(channel)
                        self.assertEqual(controller.last_error_type, "RuntimeError")
                        self.assertNotIn("private details", controller.error)
                        self.assertEqual(controller.attempts, 1)
                        self.assertIsNotNone(controller.last_attempt)
                self.assertIsNone(controller.connection)
                self.assertIsNone(guild.voice_client)
                self.assertTrue(created[0].disconnected)
                self.assertTrue(created[0].cleaned)

    async def test_permissions_failure_is_visible_without_attempting_connection(self):
        store = Store(":memory:")
        try:
            observer = Observer(store)
            observer.connected = True
            channel = SimpleNamespace(id=99, name="El after", permissions_for=lambda _: SimpleNamespace(connect=False))
            guild = SimpleNamespace(voice_channels=[channel], get_channel=lambda _: channel, me=object())
            client = SimpleNamespace(is_ready=lambda: True, get_guild=lambda _: guild)
            observer.voice.channels = [dict(id="99", name="El after")]
            observer.voice.configure("99")
            observer.voice._connect = AsyncMock()
            await observer.voice.step(client, 1)
            observer.voice._connect.assert_not_awaited()
            self.assertEqual(observer.voice.snapshot()["status"], "error")
            self.assertIn("Conectar", observer.voice.error)
            self.assertFalse(observer.voice.healthy())
            observer.voice.configure("")
            self.assertEqual(observer.voice.snapshot()["status"], "disabled")
        finally:
            store.close()
