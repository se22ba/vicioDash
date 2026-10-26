import sys
import unittest
from unittest.mock import patch
from datetime import timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from storage import Store, stamp, utcnow
from server import create_app, Observer
from aiohttp.test_utils import AioHTTPTestCase


class DeploymentConfigTests(unittest.TestCase):
    def test_free_hosting_fails_closed_without_persistent_database(self):
        with patch.dict("os.environ", {"REQUIRE_DATABASE_URL": "true", "DATABASE_URL": ""}):
            with self.assertRaisesRegex(ValueError, "DATABASE_URL"):
                create_app(admin_key="a-test-admin-key-of-more-than-24-characters", enable_bot=False)

    def test_database_url_does_not_accept_an_api_url(self):
        with patch.dict("os.environ", {"DATABASE_URL": "https://project.supabase.co"}):
            with self.assertRaisesRegex(ValueError, "PostgreSQL"):
                create_app(admin_key="a-test-admin-key-of-more-than-24-characters", enable_bot=False)


def record(**changes):
    end = utcnow() - timedelta(hours=2)
    r = dict(id="one", userId="1", name="Jugador", start=stamp(end-timedelta(hours=1)),
             end=stamp(end), game="Juego", inVoice=True, spoke="unknown", muted=False,
             deafened=False, streaming=False, camera=False, status="online", source="bot",
             sessionId="session", channel="Club", note="")
    return {**r, **changes}


class StorageTests(unittest.TestCase):
    def setUp(self):
        self.store = Store(":memory:")

    def tearDown(self):
        self.store.close()

    def test_overlap_does_not_change_previous_data(self):
        r = self.store.put(record())
        with self.assertRaises(ValueError):
            self.store.put({**r, "id": "two"})
        self.assertEqual(len(self.store.all()), 1)

    def test_new_manual_records_are_rejected_by_storage(self):
        with self.assertRaises(ValueError):
            self.store.put(record(source="manual"))
        self.assertEqual(self.store.all(), [])

    def test_import_is_atomic_and_duplicates_are_idempotent(self):
        r = self.store.put(record())
        self.assertEqual(self.store.import_records([r]), 0)
        with self.assertRaises(ValueError):
            self.store.import_records([{**r, "id": "new", "userId": "2"}, {**r, "name": "Conflicto"}])
        self.assertEqual(len(self.store.all()), 1)

    def test_observer_changes_keep_session_and_do_not_bridge_disconnects(self):
        o = Observer(self.store)
        now = utcnow() - timedelta(hours=1)
        state = {k:v for k,v in record(source="bot").items() if k not in ["id", "sessionId", "start", "end", "source", "spoke", "note"]}
        o.change("1", state, now)
        o.change("1", {**state, "game": "Otro"}, now+timedelta(minutes=10))
        o.change("1", None, now+timedelta(minutes=20))
        rows = self.store.all()
        self.assertEqual(len(rows), 2)
        self.assertEqual(len({r["sessionId"] for r in rows}), 1)
        o.change("1", state, now+timedelta(minutes=30))
        o.flush("1", now+timedelta(minutes=40))
        self.assertEqual(len({r["sessionId"] for r in self.store.all()}), 2)

    def test_live_club_excludes_online_outside_voice_but_keeps_muted_invisible(self):
        observer = Observer(self.store)
        observer.connected = True
        now = utcnow()
        observer.change("online", dict(userId="online", name="Solo online", inVoice=False), now)
        observer.change("voice", dict(userId="voice", name="En voz", inVoice=True,
                                     muted=True, status="offline"), now)
        self.assertEqual([r["userId"] for r in observer.snapshot()], ["voice"])
        self.assertEqual(len(observer.active), 2)
        observer.connected = False
        self.assertEqual(observer.snapshot(), [])

    def test_bot_heartbeat_does_not_accept_a_manual_speech_annotation(self):
        o = Observer(self.store)
        now = utcnow() - timedelta(minutes=10)
        state = {k:v for k,v in record().items() if k not in ["id", "sessionId", "start", "end", "source", "spoke", "note"]}
        o.change("1", state, now)
        o.flush("1", now+timedelta(minutes=2))
        record_id = o.active["1"]["id"]
        self.store.annotate(record_id, "no")
        o.flush("1", now+timedelta(minutes=5))
        self.assertEqual(self.store.get(record_id)["spoke"], "unknown")

    def test_roster_includes_members_without_activity_and_preserves_pause(self):
        m = dict(id="offline", name="Sin conexión", since=stamp(utcnow()), active=False)
        self.store.put_member(m)
        self.store.put_member({**m, "active": True}, discover=True)
        self.assertEqual(self.store.all(), [])
        self.assertFalse(self.store.members()[0]["active"])

    def test_invalid_roster_import_does_not_commit_records(self):
        with self.assertRaises(ValueError):
            self.store.import_records([record()], [dict(id="bad", name="", since=stamp(utcnow()), active=True)])
        self.assertEqual(self.store.all(), [])


class ApiTests(AioHTTPTestCase):
    async def get_application(self):
        return create_app(":memory:", "test-key-with-at-least-24-characters", enable_bot=False)

    @property
    def auth(self):
        return {"Authorization": "Bearer test-key-with-at-least-24-characters"}

    @property
    def store(self):
        return next(v for v in self.app.values() if isinstance(v, Store))

    async def test_human_record_endpoints_are_closed_even_with_admin_key(self):
        saved = self.store.put(record())
        for headers in ({}, self.auth):
            for method, path, data in [("PUT", "/api/records/one", saved),
                                       ("PUT", "/api/records/forged", {**saved, "id": "forged", "source": "bot"}),
                                       ("DELETE", "/api/records/one", None),
                                       ("PATCH", "/api/records/one/speech", {"spoke": "yes"}),
                                       ("POST", "/api/import", {"version": 1, "records": [saved]})]:
                response = await self.client.request(method, path, json=data, headers=headers)
                self.assertIn(response.status, (401, 404, 405))
        self.assertEqual(self.store.get("one"), saved)
        self.assertIsNone(self.store.get("forged"))

    async def test_bot_records_are_readable_and_legacy_manual_rows_are_not_shown(self):
        saved = self.store.put(record())
        # Simulate an old row without exposing an ingestion endpoint.
        with self.store.db:
            self.store.db.execute('INSERT INTO records VALUES (?,?,?,?,?)',
                                  ("legacy", "2", saved["start"], saved["end"], __import__("json").dumps({**saved, "id": "legacy", "userId": "2", "source": "manual"})))
        data = await (await self.client.get("/api/state")).json()
        self.assertEqual([r["id"] for r in data["records"]], ["one"])
        self.assertEqual(len(self.store.all()), 2)

    async def test_pause_requires_key_and_cannot_change_profile_or_create_members(self):
        member = dict(id="123", name="Integrante", since=stamp(utcnow()), active=True)
        self.store.put_member(member, discover=True)
        response = await self.client.patch("/api/members/123", json={"active": False})
        self.assertEqual(response.status, 401)
        self.assertTrue(self.store.members()[0]["active"])
        response = await self.client.patch("/api/members/123", json={"active": False}, headers=self.auth)
        self.assertEqual(response.status, 200)
        self.assertEqual((await response.json())["member"], {**member, "active": False})
        for data in [{"active": True, "name": "Changed"}, {"active": "false"}, {"name": "Changed"}]:
            response = await self.client.patch("/api/members/123", json=data, headers=self.auth)
            self.assertEqual(response.status, 400)
        response = await self.client.patch("/api/members/999", json={"active": True}, headers=self.auth)
        self.assertEqual(response.status, 400)
        response = await self.client.put("/api/members/999", json={**member, "id": "999"}, headers=self.auth)
        self.assertIn(response.status, (404, 405))
        self.store.put_member({**member, "name": "Nombre de Discord"}, discover=True)
        self.assertFalse(self.store.members()[0]["active"])
        self.assertEqual(self.store.members()[0]["name"], "Nombre de Discord")

    async def test_admin_key_is_checked_before_the_ui_saves_it(self):
        response = await self.client.post("/api/admin/session", headers={"Authorization": "Bearer incorrecta"})
        self.assertEqual(response.status, 401)
        response = await self.client.post("/api/admin/session", headers=self.auth)
        self.assertEqual(response.status, 200)

    async def test_only_static_assets_are_served(self):
        self.assertEqual((await self.client.get("/")).status, 200)
        self.assertEqual((await self.client.get("/model.js")).status, 200)
        self.assertEqual((await self.client.get("/server.py")).status, 404)

    async def test_microphone_configuration_requires_key_and_accepts_only_discovered_channel(self):
        response = await self.client.put("/api/voice-channel", json={"channelId": "99"})
        self.assertEqual(response.status, 401)
        response = await self.client.put("/api/voice-channel", json={"channelId": "99"}, headers=self.auth)
        self.assertEqual(response.status, 400)
        response = await self.client.put("/api/voice-channel", json=[], headers=self.auth)
        self.assertEqual(response.status, 400)
        observer = next(v for v in self.app.values() if isinstance(v, Observer))
        observer.voice.channels = [dict(id="99", name="El after")]
        response = await self.client.put("/api/voice-channel", json={"channelId": "99"}, headers=self.auth)
        self.assertEqual(response.status, 200)
        state = await (await self.client.get("/api/state")).json()
        self.assertEqual(state["voice"]["channelId"], "99")
        self.assertEqual(state["voice"]["status"], "waiting")
        response = await self.client.put("/api/voice-channel", json={"channelId": ""}, headers=self.auth)
        self.assertEqual(response.status, 200)
        self.assertFalse((await response.json())["voice"]["connected"])


if __name__ == "__main__":
    unittest.main()
