import io

import pytest

from backend.services.stimulus_files import StimulusFormatError, parse_stimulus_file, summarize

API = "/api/v1/stimuli"


def test_parse_json_spike_trains_sorts_and_drops_non_positive_times():
    trains = parse_stimulus_file("s.json", b'{"spike_trains": [[30.0, 10.0, 0.0, -5], [], [2.26]]}')
    assert trains == [[10.0, 30.0], [2.3]]
    assert summarize(trains) == {"n_trains": 2, "n_spikes": 3, "duration_ms": 30.0}


def test_parse_json_events_groups_by_sender():
    assert parse_stimulus_file("s.json", b'{"senders": [7, 3, 7], "times": [5.0, 1.0, 2.0]}') == [[1.0], [2.0, 5.0]]


def test_parse_csv_with_header():
    assert parse_stimulus_file("s.csv", b"sender,time\n1,10.5\n2,3\n1,4\n") == [[4.0, 10.5], [3.0]]


def test_parse_hdf5_events():
    h5py = pytest.importorskip("h5py")
    buffer = io.BytesIO()
    with h5py.File(buffer, "w") as handle:
        handle.create_dataset("senders", data=[1, 1, 2])
        handle.create_dataset("times", data=[1.0, 5.0, 3.0])
    assert parse_stimulus_file("s.h5", buffer.getvalue()) == [[1.0, 5.0], [3.0]]


def test_hdf5_datasets_must_live_inside_the_file(tmp_path):
    """Un dataset con storage esterno farebbe leggere al server un file arbitrario."""
    h5py = pytest.importorskip("h5py")
    path = tmp_path / "evil.h5"
    with h5py.File(path, "w") as handle:
        handle.create_dataset("times", data=[1.0, 2.0, 3.0])
        handle.create_dataset("senders", shape=(3,), dtype="i8", external=[("/etc/passwd", 0, 24)])
    with pytest.raises(StimulusFormatError):
        parse_stimulus_file("evil.h5", path.read_bytes())


@pytest.mark.parametrize("filename, content", [
    ("s.txt", b"1,2"),
    ("s.json", b"{not json"),
    ("s.json", b'{"something": 1}'),
    ("s.json", b'{"senders": [1], "times": [1.0, 2.0]}'),
    ("s.json", b'{"spike_trains": [[]]}'),
    ("s.csv", b"1,2\nx,y\n"),
])
def test_invalid_files_are_rejected(filename, content):
    with pytest.raises(StimulusFormatError):
        parse_stimulus_file(filename, content)


def test_upload_list_delete(client, auth, other_auth, files):
    upload = client.post(f"{API}/upload", data={"name": "Registrazione"}, headers=auth,
                         files={"file": ("rec.json", b'{"spike_trains": [[1.0, 2.0], [3.0]]}', "application/json")})
    assert upload.status_code == 201
    stimulus = upload.json()
    assert stimulus["definition"] == {"n_trains": 2, "n_spikes": 3, "duration_ms": 3.0, "source_filename": "rec.json"}
    (stored,) = files.list("stimuli")
    assert files.read_json(stored) == {"spike_trains": [[1.0, 2.0], [3.0]]}

    assert [s["id"] for s in client.get(API, headers=auth).json()] == [stimulus["id"]]
    assert client.get(API, headers=other_auth).json() == []
    assert client.delete(f"{API}/{stimulus['id']}", headers=other_auth).status_code == 404
    assert client.delete(f"{API}/{stimulus['id']}", headers=auth).status_code == 204
    assert files.list("stimuli") == []


def test_upload_reports_format_errors(client, auth):
    response = client.post(f"{API}/upload", data={"name": "x"}, headers=auth, files={"file": ("rec.txt", b"1,2", "text/plain")})
    assert response.status_code == 422
    assert "Formato non supportato" in response.json()["detail"]
