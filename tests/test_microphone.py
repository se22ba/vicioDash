import asyncio
import struct
import unittest
from datetime import timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock

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
