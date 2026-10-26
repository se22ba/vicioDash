"""Optional integration suite: set VICIO_TEST_DATABASE_URL to a disposable DB."""
import os
import sys
import unittest
import uuid
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from storage import Store, stamp, utcnow
from test_server import record


@unittest.skipUnless(os.environ.get("VICIO_TEST_DATABASE_URL"), "Requiere PostgreSQL de prueba")
class PostgresIntegrationTests(unittest.TestCase):
    def setUp(self):
        self.store = Store(os.environ["VICIO_TEST_DATABASE_URL"])
        self.prefix = "test-" + str(uuid.uuid4())
        self.r = record(id=self.prefix, userId=self.prefix, sessionId=self.prefix)

    def tearDown(self):
        with self.store.db:
            self.store.db.execute("DELETE FROM records WHERE user_id=? OR user_id=?", (self.prefix, self.prefix+"-new"))
            self.store.db.execute("DELETE FROM members WHERE id=?", (self.prefix,))
        self.store.close()

    def test_records_and_roster_survive_reconnection(self):
        self.store.put(self.r)
        m = dict(id=self.prefix, name="Integración", since=stamp(utcnow()), active=False)
        self.store.put_member(m)
        self.store.db.close()  # The adapter must reconnect on the next query.
        self.assertEqual(self.store.get(self.prefix)["name"], self.r["name"])
        self.assertFalse(next(m for m in self.store.members() if m["id"] == self.prefix)["active"])

    def test_import_rolls_back_and_identical_records_are_idempotent(self):
        saved = self.store.put(self.r)
        self.assertEqual(self.store.import_records([saved]), 0)
        with self.assertRaises(ValueError):
            self.store.import_records([{**saved, "id": self.prefix+"-new", "userId": self.prefix+"-new"}, {**saved, "name": "Conflict"}])
        self.assertIsNone(self.store.get(self.prefix+"-new"))

    def test_roster_import_ignores_existing_member(self):
        m = dict(id=self.prefix, name="Integración", since=stamp(utcnow()), active=False)
        self.store.put_member(m)
        self.store.import_records([], [{**m, "active": True}])
        self.assertFalse(next(m for m in self.store.members() if m["id"] == self.prefix)["active"])


if __name__ == "__main__":
    unittest.main()
