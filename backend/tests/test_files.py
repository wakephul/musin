import time

import pytest

from backend.services.storage import FileStorage


@pytest.fixture
def link(files):
    files.write("results/1/sim_1/plot.png", b"png-bytes")
    files.write("results/1/sim_1/spikes.json", b"{}")
    return files.signed_url("results/1/sim_1/plot.png")


def test_a_signed_link_serves_the_file_without_a_token(client, link):
    response = client.get(link)
    assert response.status_code == 200
    assert response.content == b"png-bytes"
    assert response.headers["content-type"] == "image/png"
    assert "attachment" not in response.headers.get("content-disposition", "")


def test_non_image_files_are_downloaded_as_attachments(client, files, link):
    response = client.get(files.signed_url("results/1/sim_1/spikes.json"))
    assert response.status_code == 200
    assert 'attachment; filename="spikes.json"' in response.headers["content-disposition"]


def test_a_link_cannot_be_reused_for_another_file(client, link):
    assert client.get(link.replace("plot.png", "spikes.json")).status_code == 403
    assert client.get(link.replace("sim_1", "sim_2")).status_code == 403
    assert client.get(link[:-1] + ("0" if link[-1] != "0" else "1")).status_code == 403
    assert client.get(link.split("?")[0]).status_code == 422   # senza firma


def test_expired_links_are_refused(client, files, link):
    expired = int(time.time()) - 1
    signature = files._signature("results/1/sim_1/plot.png", expired)
    assert client.get(f"/api/v1/files/results/1/sim_1/plot.png?expires={expired}&signature={signature}").status_code == 403
    # Spostare in avanti la scadenza invalida la firma.
    assert client.get(link.replace("expires=", "expires=9")).status_code == 403


def test_a_valid_link_to_a_deleted_file_is_not_found(client, files, link):
    files.delete("results/1/sim_1/plot.png")
    assert client.get(link).status_code == 404


def test_names_cannot_escape_the_storage_directory(client, files, tmp_path):
    (tmp_path / "secret.txt").write_text("fuori dallo storage")
    local = FileStorage(tmp_path / "storage")
    local.write("results/1/sim_1/a.png", b"a")
    (local.root / ".secret_key").write_text("chiave")
    for name in ("../secret.txt", "a/../../secret.txt", "/etc/passwd", "", ".secret_key", "results/.nascosto/x"):
        with pytest.raises(ValueError):
            local.path(name)
        # Nemmeno con una firma valida: il nome viene comunque rifiutato.
        assert local.verify(name, int(time.time()) + 60, local._signature(name, int(time.time()) + 60)) is None

    # Attraverso l'API, con il percorso codificato (un client normalizzerebbe i "../" in chiaro)
    # e una firma autentica per quel nome: la risposta non deve mai essere il file.
    expires = int(time.time()) + 60
    for name, encoded in (("../test.db", "..%2Ftest.db"), (".secret_key", ".secret_key")):
        response = client.get(f"/api/v1/files/{encoded}?expires={expires}&signature={files._signature(name, expires)}")
        assert response.status_code == 403, name


def test_storage_lists_and_deletes_whole_directories_only(files):
    files.write("results/1/sim_1/a.png", b"a")
    files.write("results/1/sim_10/b.png", b"b")
    assert files.list("results/1/sim_1") == ["results/1/sim_1/a.png"]
    files.delete_tree("results/1/sim_1")
    assert files.list("results") == ["results/1/sim_10/b.png"]
    assert files.list("results/1/sim_1") == []
