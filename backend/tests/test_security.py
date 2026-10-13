"""Other websites must not be able to use the local API (see shortlist.security)."""

from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine

from shortlist.main import create_app
from shortlist.security import host_of, refusal
from tests.conftest import FakeLLM, local_client

EVIL = {"Origin": "https://evil.example", "Sec-Fetch-Site": "cross-site"}


@pytest.mark.parametrize(
    ("value", "host"),
    [
        ("127.0.0.1:8000", "127.0.0.1"),
        ("localhost", "localhost"),
        ("LOCALHOST:5173", "localhost"),
        ("http://127.0.0.1:5173", "127.0.0.1"),
        ("https://evil.example", "evil.example"),
        ("[::1]:8000", "[::1]"),
        ("127.0.0.1.evil.example:8000", "127.0.0.1.evil.example"),
        ("", ""),
    ],
)
def test_host_of(value: str, host: str) -> None:
    assert host_of(value) == host


def test_normal_use_from_the_dashboard_is_allowed(client: TestClient) -> None:
    same_origin = {"Origin": "http://127.0.0.1:8000", "Sec-Fetch-Site": "same-origin"}
    dev_server = {"Origin": "http://127.0.0.1:5173", "Sec-Fetch-Site": "same-site"}

    assert client.get("/api/health").status_code == 200  # no Origin: curl, the CLI
    assert (
        client.post(
            "/api/runs/estimate", json={"limits": {"indeed": 5}}, headers=same_origin
        ).status_code
        == 200
    )
    assert (
        client.post(
            "/api/runs/estimate", json={"limits": {"indeed": 5}}, headers=dev_server
        ).status_code
        == 200
    )


@pytest.mark.parametrize(
    "host", ["evil.example", "evil.example:8000", "127.0.0.1.evil.example", ""]
)
def test_dns_rebinding_is_refused(client: TestClient, host: str) -> None:
    """A foreign domain pointed at 127.0.0.1 gets nothing: not the API, not the pages."""
    for path in ("/api/settings", "/api/jobs", "/"):
        response = client.get(path, headers={"Host": host})
        assert response.status_code == 403, path
        assert "only answers to 127.0.0.1" in response.text


def test_rebinding_cannot_start_a_paid_run(client: TestClient) -> None:
    response = client.post(
        "/api/runs", json={"limits": {"stepstone": 5}}, headers={"Host": "evil.example"}
    )

    assert response.status_code == 403
    assert client.get("/api/runs").json() == []


@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("POST", "/api/match/reevaluate"),
        ("POST", "/api/jobs/1/cover-letter"),
        ("POST", "/api/settings/model/test"),
        ("POST", "/api/runs"),
        ("GET", "/api/settings"),
        ("GET", "/api/jobs/1/cover-letter/pdf"),
    ],
)
def test_requests_from_another_website_are_refused(
    client: TestClient, llm: FakeLLM, method: str, path: str
) -> None:
    for headers in (EVIL, {"Origin": "https://evil.example"}, {"Sec-Fetch-Site": "cross-site"}):
        response = client.request(method, path, headers=headers)
        assert response.status_code == 403, headers
        assert "another website" in response.text
    assert llm.calls == []


def test_a_form_post_without_json_cannot_start_a_run(client: TestClient) -> None:
    """Browsers send text/plain cross-site without asking first; it must not be read as JSON."""
    response = client.post(
        "/api/runs", content='{"limits":{"stepstone":5}}', headers={"Content-Type": "text/plain"}
    )

    assert response.status_code == 422
    assert client.get("/api/runs").json() == []


def test_pages_can_be_opened_from_a_link_elsewhere(tmp_path: Path, engine: Engine) -> None:
    dist = tmp_path / "dist"
    (dist / "assets").mkdir(parents=True)
    (dist / "index.html").write_text("<html>app</html>")
    client = local_client(create_app(frontend_dist=dist, engine=engine))

    assert (
        client.get("/jobs/matches", headers={"Sec-Fetch-Site": "cross-site"}).text
        == "<html>app</html>"
    )


def test_refusal_reasons() -> None:
    local = {"host": "127.0.0.1:8000"}

    assert refusal(local, "/api/jobs") is None
    assert refusal({**local, "origin": "http://localhost:5173"}, "/api/jobs") is None
    assert (
        refusal({**local, "origin": "null"}, "/api/jobs") is not None
    )  # sandboxed page or file://
    assert refusal({"host": "192.168.1.20:8000"}, "/api/jobs") is not None
    assert refusal({}, "/api/jobs") is not None
