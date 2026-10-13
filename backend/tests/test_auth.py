API = "/api/v1/auth"


def test_login_with_the_initial_user(client):
    response = client.post(f"{API}/login", data={"username": "admin@example.com", "password": "admin-password"})
    assert response.status_code == 200
    assert response.json()["user"]["email"] == "admin@example.com"


def test_login_rejects_wrong_password_and_unknown_user_with_the_same_message(client):
    wrong = client.post(f"{API}/login", data={"username": "admin@example.com", "password": "nope"})
    unknown = client.post(f"{API}/login", data={"username": "nobody@example.com", "password": "nope"})
    assert wrong.status_code == unknown.status_code == 401
    assert wrong.json() == unknown.json()


def test_register_then_me(client):
    response = client.post(f"{API}/register", json={"email": "new@example.com", "password": "long-enough"})
    assert response.status_code == 201
    token = response.json()["access_token"]
    me = client.get(f"{API}/me", headers={"Authorization": f"Bearer {token}"})
    assert me.json()["email"] == "new@example.com"


def test_register_rejects_duplicates_and_short_passwords(client):
    assert client.post(f"{API}/register", json={"email": "admin@example.com", "password": "long-enough"}).status_code == 409
    assert client.post(f"{API}/register", json={"email": "short@example.com", "password": "short"}).status_code == 422


def test_register_can_be_disabled(client, monkeypatch):
    from backend.core.config import settings
    monkeypatch.setattr(settings, "ALLOW_REGISTRATION", False)
    assert client.get(f"{API}/config").json() == {"registration_enabled": False}
    assert client.post(f"{API}/register", json={"email": "x@example.com", "password": "long-enough"}).status_code == 403


def test_change_password(client):
    token = client.post(f"{API}/register", json={"email": "pw@example.com", "password": "first-password"}).json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}
    wrong = client.post(f"{API}/change-password", json={"current_password": "bad", "new_password": "second-password"}, headers=headers)
    assert wrong.status_code == 400
    ok = client.post(f"{API}/change-password", json={"current_password": "first-password", "new_password": "second-password"}, headers=headers)
    assert ok.status_code == 204
    assert client.post(f"{API}/login", data={"username": "pw@example.com", "password": "first-password"}).status_code == 401
    assert client.post(f"{API}/login", data={"username": "pw@example.com", "password": "second-password"}).status_code == 200


def test_protected_routes_need_a_valid_token(client):
    assert client.get("/api/v1/networks").status_code == 401
    assert client.get("/api/v1/networks", headers={"Authorization": "Bearer not-a-token"}).status_code == 401


def test_password_limit_is_in_bytes_not_characters(client):
    """bcrypt legge 72 byte: due password diverse che coincidono nei primi 72 sarebbero equivalenti."""
    accented = "è" * 41   # 41 caratteri, 82 byte
    assert client.post(f"{API}/register", json={"email": "bytes@example.com", "password": accented}).status_code == 422
    assert client.post(f"{API}/register", json={"email": "bytes@example.com", "password": "è" * 36}).status_code == 201
