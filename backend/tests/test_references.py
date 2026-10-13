import pytest

from backend.services.reference_sets import ReferenceFormatError, builtin_sets, parse_csv

API = "/api/v1/references"
CSV = b"condizione,tempo_ms\nA,320\nA,300.5\nv,370\nAV,245\nGara,305\n"


def upload(client, auth, content=CSV, name="Dati clinici"):
    return client.post(API, data={"name": name}, files={"file": ("dati.csv", content, "text/csv")}, headers=auth)


def test_the_paper_sets_are_always_listed(client, auth):
    sets = {entry["key"]: entry for entry in client.get(API, headers=auth).json()}
    assert sets["builtin:cavadini2025-cerebellare"]["responses"] == {"A": 541, "V": 541, "AV": 541, "race": 541}
    assert sets["builtin:cavadini2025-corticale"]["responses"] == {"A": 40, "V": 40, "AV": 40}
    assert not any(entry["deletable"] for entry in sets.values())
    assert all(min(values) > 0 for entry in builtin_sets().values() for values in entry["conditions"].values())


def test_upload_list_and_delete_are_private(client, auth, other_auth, network):
    created = upload(client, auth)
    assert created.status_code == 201, created.text
    reference = created.json()
    assert reference["responses"] == {"A": 2, "V": 1, "AV": 1, "race": 1} and reference["deletable"]
    assert reference["key"] in [entry["key"] for entry in client.get(API, headers=auth).json()]
    assert reference["key"] not in [entry["key"] for entry in client.get(API, headers=other_auth).json()]

    campaign = client.post("/api/v1/campaigns", headers=auth, json={
        "network_id": network["id"], "params": {"phases": {"test_duration_ms": 100}}, "seeds": [1]}).json()
    url = f"/api/v1/campaigns/{campaign['id']}"
    assert client.put(url, json={"reference": reference["key"]}, headers=auth).json()["reference"] == reference["key"]

    identifier = reference["key"].split(":")[1]
    assert client.delete(f"{API}/{identifier}", headers=other_auth).status_code == 404
    assert client.delete(f"{API}/{identifier}", headers=auth).status_code == 204
    # La campagna che lo usava resta senza confronto, non con un riferimento che non esiste più.
    assert client.get(url, headers=auth).json()["reference"] is None


@pytest.mark.parametrize("content", [
    b"",
    b"condizione,tempo\n",
    b"A,320\n",                      # un solo tempo
    b"X,320\nX,330\n",               # condizione sconosciuta
    b"A,320\nA,veloce\n",
    b"A,320\nA,-5\n",
    b"A,320\nA,inf\n",
    b"A\nA\n",
    b"\xff\xfe\x00A",
])
def test_malformed_files_are_refused(client, auth, content):
    assert upload(client, auth, content).status_code == 422


def test_csv_variants():
    assert parse_csv(b"A;320,5\nA;300\n") == {"A": [320.5, 300.0]}             # punto e virgola, virgola decimale
    assert parse_csv(b"\xef\xbb\xbfcond\ttime\nav\t245\nAV\t250\n") == {"AV": [245.0, 250.0]}
    assert parse_csv(b"A,320\n\nA,330\n") == {"A": [320.0, 330.0]}
    with pytest.raises(ReferenceFormatError, match="2 MB"):
        parse_csv(b"A,320\n" * 400_000)
