from fastapi.testclient import TestClient
from sqlalchemy import Engine

from shortlist.main import create_app
from tests.conftest import local_client


def test_health_ok_on_migrated_database(client: TestClient) -> None:
    response = client.get("/api/health")

    assert response.status_code == 200
    assert response.json() == {
        "status": "ok",
        "database": "ok",
        "schema_revision": "0005",
        "detail": None,
    }


def test_health_reports_unmigrated_database(engine: Engine) -> None:
    with local_client(create_app(frontend_dist=None, engine=engine)) as client:
        body = client.get("/api/health").json()

    assert body["status"] == "degraded"
    assert body["database"] == "error"
    assert "make migrate" in body["detail"]
