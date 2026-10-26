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
             deafened=False, streaming=False, camera=False, status="online", source="manual",
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

    def test_annotation_survives_bot_heartbeat(self):
        o = Observer(self.store)
        now = utcnow() - timedelta(minutes=10)
        state = {k:v for k,v in record().items() if k not in ["id", "sessionId", "start", "end", "source", "spoke", "note"]}
        o.change("1", state, now)
        o.flush("1", now+timedelta(minutes=2))
        record_id = o.active["1"]["id"]
        self.store.annotate(record_id, "no")
        o.flush("1", now+timedelta(minutes=5))
        self.assertEqual(self.store.get(record_id)["spoke"], "no")

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

    async def test_write_requires_admin_and_read_works(self):
        r = record()
        response = await self.client.put("/api/records/one", json=r)
        self.assertEqual(response.status, 401)
        response = await self.client.put("/api/records/one", json=r, headers=self.auth)
        self.assertEqual(response.status, 200)
        response = await self.client.get("/api/state")
        data = await response.json()
        self.assertEqual(len(data["records"]), 1)
        self.assertFalse(data["bot"]["connected"])
        response = await self.client.delete("/api/records/one", headers=self.auth)
        self.assertEqual(response.status, 200)

    async def test_overlap_rejected_by_api(self):
        r = record()
        await self.client.put("/api/records/one", json=r, headers=self.auth)
        response = await self.client.put("/api/records/two", json={**r,"id":"two"}, headers=self.auth)
        self.assertEqual(response.status, 400)

    async def test_roster_write_requires_key_and_roundtrips_zero_activity(self):
        member = dict(id="offline", name="Nunca vino", since=stamp(utcnow()), active=True)
        response = await self.client.put("/api/members/offline", json=member)
        self.assertEqual(response.status, 401)
        response = await self.client.put("/api/members/offline", json=member, headers=self.auth)
        self.assertEqual(response.status, 200)
        state = await (await self.client.get("/api/state")).json()
        self.assertEqual(state["members"][0]["name"], "Nunca vino")
        self.assertEqual(state["records"], [])

    async def test_only_static_assets_are_served(self):
        self.assertEqual((await self.client.get("/")).status, 200)
        self.assertEqual((await self.client.get("/model.js")).status, 200)
        self.assertEqual((await self.client.get("/server.py")).status, 404)


if __name__ == "__main__":
    unittest.main()
