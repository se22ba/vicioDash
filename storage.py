"""Shared record model: SQLite locally, PostgreSQL for durable free hosting."""
import json
import math
import sqlite3
from datetime import datetime, timezone, timedelta
from pathlib import Path


def utcnow():
    return datetime.now(timezone.utc)


def stamp(value):
    return value.astimezone(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def parse(value):
    if not isinstance(value, str):
        raise ValueError("Fecha inválida.")
    result = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if result.tzinfo is None:
        raise ValueError("Las fechas deben incluir zona horaria.")
    return result.astimezone(timezone.utc)


def validate(record):
    if not isinstance(record, dict):
        raise ValueError("Registro inválido.")
    result = {}
    for key, limit in [("id", 120), ("userId", 100), ("name", 60)]:
        value = record.get(key)
        if not isinstance(value, str) or not value.strip() or len(value) > limit:
            raise ValueError("Campo inválido: " + key)
        result[key] = value.strip()
    start, end = parse(record.get("start")), parse(record.get("end"))
    if not timedelta(seconds=1) <= end - start <= timedelta(days=7):
        raise ValueError("Cada tramo debe durar entre 1 segundo y 7 días.")
    if end > utcnow() + timedelta(minutes=1):
        raise ValueError("No se pueden registrar sesiones futuras.")
    result.update(start=stamp(start), end=stamp(end))
    game = record.get("game")
    if game is not None and (not isinstance(game, str) or len(game) > 100):
        raise ValueError("Juego inválido.")
    result["game"] = game.strip() or None if game is not None else None
    for key in ["inVoice", "muted", "deafened", "streaming", "camera"]:
        if type(record.get(key)) is not bool:
            raise ValueError("Campo inválido: " + key)
        result[key] = record[key]
    if record.get("spoke") not in ["yes", "no", "unknown"]:
        raise ValueError("Dato de habla inválido.")
    if record.get("status") not in ["online", "idle", "dnd", "offline"]:
        raise ValueError("Presencia inválida.")
    if record.get("source") != "bot":
        raise ValueError("Los registros solo pueden ser creados por el bot.")
    result.update(spoke=record["spoke"] if record["inVoice"] else "unknown",
                  status=record["status"], source=record["source"])
    for key, limit in [("channel", 100), ("note", 500), ("sessionId", 120)]:
        value = record.get(key, result["id"] if key == "sessionId" else "")
        if not isinstance(value, str) or len(value) > limit:
            raise ValueError("Campo inválido: " + key)
        result[key] = value.strip()
    if not result["inVoice"]:
        result.update(channel="", muted=False, deafened=False, streaming=False, camera=False)
    if "channelId" in record:
        channel_id = record["channelId"]
        if not isinstance(channel_id, str) or (channel_id and not channel_id.isdecimal()):
            raise ValueError("Canal inválido.")
        result["channelId"] = channel_id if result["inVoice"] else ""
    if "mic" in record:
        mic = record["mic"]
        if not result["inVoice"] or not isinstance(mic, dict) or mic.get("kind") != "rtp":
            raise ValueError("Medición de micrófono inválida.")
        observed, active = mic.get("observedSeconds"), mic.get("activeSeconds")
        if any(type(v) not in (int, float) or not math.isfinite(v) for v in (observed, active)) or not 0 <= active <= observed <= (end-start).total_seconds() + .01:
            raise ValueError("Duración de micrófono inválida.")
        result["mic"] = dict(kind="rtp", observedSeconds=observed, activeSeconds=active)
    return result


def validate_member(member):
    if not isinstance(member, dict) or not isinstance(member.get("id"), str) or not member["id"].strip() or len(member["id"]) > 100:
        raise ValueError("Identificador de integrante inválido.")
    if not isinstance(member.get("name"), str) or not member["name"].strip() or len(member["name"]) > 60 or type(member.get("active")) is not bool:
        raise ValueError("Integrante inválido.")
    since = parse(member.get("since"))
    if since > utcnow() + timedelta(minutes=1):
        raise ValueError("La fecha de alta no puede ser futura.")
    return dict(id=member["id"], name=member["name"].strip(), since=stamp(since), active=member["active"])


class PostgresConnection:
    """Keep Store's small DB-API surface and explicit atomic transactions."""
    def __init__(self, url):
        self.url = url
        self.connection = None
        self.transaction = None
        self._connect()

    def _connect(self):
        import psycopg
        from psycopg.conninfo import conninfo_to_dict
        options = conninfo_to_dict(self.url)
        options.setdefault("sslmode", "require")
        options.setdefault("connect_timeout", 10)
        self.connection = psycopg.connect(**options, autocommit=True, prepare_threshold=None)
        self.connection.execute("CREATE SCHEMA IF NOT EXISTS vicio")
        self.connection.execute("SET search_path TO vicio")

    def execute(self, query, parameters=()):
        if self.connection.closed:
            self._connect()
        if query.startswith("INSERT OR IGNORE INTO"):
            query = query.replace("INSERT OR IGNORE INTO", "INSERT INTO", 1) + " ON CONFLICT(id) DO NOTHING"
        return self.connection.execute(query.replace("?", "%s"), parameters)

    def __enter__(self):
        if self.connection.closed:
            self._connect()
        self.transaction = self.connection.transaction()
        self.transaction.__enter__()
        return self

    def __exit__(self, *args):
        transaction, self.transaction = self.transaction, None
        return transaction.__exit__(*args)

    def commit(self):
        pass  # Autocommit outside explicit transaction contexts.

    def close(self):
        self.connection.close()


class Store:
    def __init__(self, path):
        self.postgres = path.startswith(("postgres://", "postgresql://"))
        if self.postgres:
            self.db = PostgresConnection(path)
        else:
            if path != ":memory:":
                Path(path).parent.mkdir(parents=True, exist_ok=True)
            self.db = sqlite3.connect(path)
            self.db.execute("PRAGMA journal_mode=WAL")
            self.db.execute("PRAGMA busy_timeout=5000")
        self.db.execute('CREATE TABLE IF NOT EXISTS records (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, "start" TEXT NOT NULL, "end" TEXT NOT NULL, payload TEXT NOT NULL)')
        self.db.execute('CREATE INDEX IF NOT EXISTS records_user_time ON records(user_id, "start", "end")')
        self.db.execute("CREATE TABLE IF NOT EXISTS members (id TEXT PRIMARY KEY, payload TEXT NOT NULL)")
        self.db.execute("CREATE TABLE IF NOT EXISTS settings (id TEXT PRIMARY KEY, value TEXT NOT NULL)")
        self.db.commit()

    def setting(self, key, default=""):
        row = self.db.execute("SELECT value FROM settings WHERE id=?", (key,)).fetchone()
        return row[0] if row else default

    def set_setting(self, key, value):
        with self.db:
            self.db.execute("INSERT INTO settings VALUES (?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value", (key, value))

    def all(self):
        return [json.loads(row[0]) for row in self.db.execute('SELECT payload FROM records ORDER BY "start" DESC')]

    def get(self, record_id):
        row = self.db.execute("SELECT payload FROM records WHERE id=?", (record_id,)).fetchone()
        return json.loads(row[0]) if row else None

    def members(self):
        return [json.loads(row[0]) for row in self.db.execute("SELECT payload FROM members ORDER BY id")]

    def put_member(self, member, discover=False):
        m = validate_member(member)
        if discover:
            row = self.db.execute("SELECT payload FROM members WHERE id=?", (m["id"],)).fetchone()
            previous = json.loads(row[0]) if row else None
            if previous:
                if previous["name"] == m["name"]:
                    return previous
                m = {**previous, "name": m["name"]}
        with self.db:
            self.db.execute("INSERT INTO members VALUES (?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload", (m["id"], json.dumps(m, ensure_ascii=False)))
        return m

    def set_member_active(self, member_id, active):
        if not member_id.isdecimal() or type(active) is not bool:
            raise ValueError("Integrante inválido.")
        with self.db:
            row = self.db.execute("SELECT payload FROM members WHERE id=?", (member_id,)).fetchone()
            if not row:
                raise ValueError("El integrante no está en Discord.")
            member = {**json.loads(row[0]), "active": active}
            self.db.execute("UPDATE members SET payload=? WHERE id=?", (json.dumps(member, ensure_ascii=False), member_id))
        return member

    def _write(self, r):
        overlap = self.db.execute('SELECT id FROM records WHERE user_id=? AND id<>? AND "start"<? AND "end">? LIMIT 1',
                                  (r["userId"], r["id"], r["end"], r["start"])).fetchone()
        if overlap:
            raise ValueError("Hay tramos superpuestos para " + r["name"] + ". Revisá los horarios.")
        self.db.execute('INSERT INTO records VALUES (?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET user_id=excluded.user_id,"start"=excluded."start","end"=excluded."end",payload=excluded.payload',
                        (r["id"], r["userId"], r["start"], r["end"], json.dumps(r, ensure_ascii=False)))

    def put(self, record):
        r = validate(record)
        with self.db:
            self._write(r)
        return r

    def import_records(self, records, members=None):
        if not isinstance(records, list) or len(records) > 100000:
            raise ValueError("Importación inválida o demasiado grande.")
        validated = [validate(r) for r in records]
        if len({r["id"] for r in validated}) != len(validated):
            raise ValueError("Hay identificadores repetidos.")
        if members is not None and (not isinstance(members, list) or len(members) > 2000):
            raise ValueError("Lista de integrantes inválida.")
        validated_members = [validate_member(m) for m in (members or [])]
        if len({m["id"] for m in validated_members}) != len(validated_members):
            raise ValueError("Hay integrantes repetidos.")
        added = 0
        with self.db:
            for r in validated:
                existing = self.get(r["id"])
                if existing:
                    if existing != r:
                        raise ValueError("Hay registros con el mismo ID y contenido distinto.")
                    continue
                self._write(r)
                added += 1
            for member in validated_members:
                self.db.execute("INSERT OR IGNORE INTO members VALUES (?,?)", (member["id"], json.dumps(member, ensure_ascii=False)))
        return added

    def delete(self, record_id):
        with self.db:
            self.db.execute("DELETE FROM records WHERE id=?", (record_id,))

    def annotate(self, record_id, spoke):
        r = self.get(record_id)
        if not r or not r["inVoice"] or spoke not in ["yes", "no", "unknown"]:
            raise ValueError("No se puede corregir el dato de habla de este registro.")
        r["spoke"] = spoke
        return self.put(r)

    def close(self):
        self.db.close()
