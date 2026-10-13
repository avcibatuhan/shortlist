from fastapi.testclient import TestClient


def test_sources_list_their_searches_and_default_limit(client: TestClient) -> None:
    sources = client.get("/api/sources").json()

    assert [source["name"] for source in sources] == ["linkedin", "indeed", "stepstone"]
    assert all(source["default_limit"] == 5 for source in sources)
    assert sources[2]["searches"][0] == {
        "keyword": ".net entwickler",
        "location": "deutschland",
        "posted_within_days": 1,
    }
    assert sources[1]["searches"][0]["location"] is None
