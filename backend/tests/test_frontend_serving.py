from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine

from shortlist.main import create_app
from tests.conftest import local_client


@pytest.fixture
def dist_client(tmp_path: Path, engine: Engine) -> TestClient:
    dist = tmp_path / "dist"
    (dist / "assets").mkdir(parents=True)
    (dist / "index.html").write_text("<html>app</html>")
    (dist / "assets" / "app.js").write_text("console.log(1)")
    (tmp_path / "secret.txt").write_text("secret")
    return local_client(create_app(frontend_dist=dist, engine=engine))


def test_serves_index_for_client_side_routes(dist_client: TestClient) -> None:
    assert dist_client.get("/").text == "<html>app</html>"
    assert dist_client.get("/matches").text == "<html>app</html>"
    assert dist_client.get("/assets/app.js").text == "console.log(1)"


def test_unknown_api_path_is_not_the_frontend(dist_client: TestClient) -> None:
    assert dist_client.get("/api/nope").status_code == 404


def test_cannot_escape_dist(dist_client: TestClient) -> None:
    assert dist_client.get("/%2e%2e/secret.txt").text == "<html>app</html>"
