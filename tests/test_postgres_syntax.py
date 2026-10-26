"""Run storage operations through PostgreSQL's parser without a live server."""
import re
import sqlite3
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from storage import Store, PostgresConnection, stamp, utcnow
from test_server import record

try:
    from pglast import parse_sql
except ImportError:
    parse_sql = None


class SyntaxCheckedDriver:
    """Parse the SQL actually produced by the adapter; SQLite supplies rows."""
    def __init__(self):
        self.db = sqlite3.connect(":memory:")
        self.closed = False

    def execute(self, query, parameters=()):
        parse_sql(re.sub(r"%s", "NULL", query))
        return self.db.execute(query.replace("%s", "?"), parameters)

    def transaction(self):
        return self.db

    def close(self):
        self.db.close()
        self.closed = True


@unittest.skipUnless(parse_sql, "Instalar requirements-dev.txt para validar sintaxis PostgreSQL")
class PostgreSQLGrammarTests(unittest.TestCase):
    def setUp(self):
        def connect(adapter):
            adapter.connection = SyntaxCheckedDriver()
        self.patch = patch.object(PostgresConnection, "_connect", connect)
        self.patch.start()
        self.store = Store("postgresql://test-only")

    def tearDown(self):
        self.store.close()
        self.patch.stop()

    def test_original_error_is_reproduced_by_postgresql_parser(self):
        with self.assertRaises(Exception):
            parse_sql("CREATE TABLE records (end TEXT NOT NULL)")

    def test_schema_insert_update_overlap_read_annotation_and_delete_parse(self):
        saved = self.store.put(record())
        self.store.put({**saved, "name": "Actualizado"})
        self.assertEqual(self.store.all()[0]["name"], "Actualizado")
        self.store.annotate(saved["id"], "yes")
        with self.assertRaises(ValueError):
            self.store.put({**saved, "id": "overlap"})
        self.store.delete(saved["id"])
        self.assertEqual(self.store.all(), [])

    def test_import_and_member_queries_parse(self):
        m = dict(id="member", name="Integrante", since=stamp(utcnow()), active=True)
        self.store.put_member(m)
        self.store.put_member(m, discover=True)
        self.assertEqual(self.store.import_records([record()], [m]), 1)
        self.assertEqual(len(self.store.members()), 1)
        self.assertEqual(self.store.import_records([self.store.get("one")], [m]), 0)
        self.store.set_setting("voice_channel_id", "99")
        self.store.set_setting("voice_channel_id", "100")
        self.assertEqual(self.store.setting("voice_channel_id"), "100")


if __name__ == "__main__":
    unittest.main()
