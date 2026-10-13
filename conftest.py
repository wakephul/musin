"""Ambiente dei test: database SQLite e storage in una cartella temporanea, niente MySQL o Redis.
Le variabili vanno impostate prima che `backend.core.config` venga importato."""
import os
import tempfile

_TEST_DIR = tempfile.mkdtemp(prefix="musin-tests-")
os.environ["DATABASE_URL"] = f"sqlite:///{_TEST_DIR}/test.db"
os.environ["STORAGE_DIR"] = f"{_TEST_DIR}/storage"
os.environ["ENVIRONMENT"] = "development"
os.environ["FIRST_SUPERUSER_EMAIL"] = "admin@example.com"
os.environ["FIRST_SUPERUSER_PASSWORD"] = "admin-password"
os.environ["ALLOW_REGISTRATION"] = "true"
