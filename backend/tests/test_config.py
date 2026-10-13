import pytest

from backend.core.config import PUBLISHED_SECRET_KEYS, Settings, _stored_secret_key


def test_published_secret_keys_are_replaced_by_a_generated_one(tmp_path):
    for published in PUBLISHED_SECRET_KEYS:
        settings = Settings(SECRET_KEY=published, STORAGE_DIR=str(tmp_path))
        assert settings.SECRET_KEY not in PUBLISHED_SECRET_KEYS
        assert len(settings.SECRET_KEY) == 64
    # La chiave generata viene riletta: un riavvio non invalida sessioni e link.
    assert _stored_secret_key(tmp_path) == settings.SECRET_KEY
    assert (tmp_path / ".secret_key").stat().st_mode & 0o077 == 0


def test_an_explicit_secret_key_is_kept(tmp_path):
    assert Settings(SECRET_KEY="una-chiave-scelta-da-me", STORAGE_DIR=str(tmp_path)).SECRET_KEY == "una-chiave-scelta-da-me"
    assert not (tmp_path / ".secret_key").exists()


def test_example_password_is_refused_outside_development(tmp_path):
    with pytest.raises(ValueError, match="FIRST_SUPERUSER_PASSWORD"):
        Settings(ENVIRONMENT="production", FIRST_SUPERUSER_PASSWORD="change_me_at_least_8_chars", STORAGE_DIR=str(tmp_path))
    Settings(ENVIRONMENT="production", FIRST_SUPERUSER_PASSWORD="una-password-vera", STORAGE_DIR=str(tmp_path))
