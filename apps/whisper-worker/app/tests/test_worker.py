import os
os.environ["WHISPER_MOCK"] = "true"
from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)
headers = {"Authorization": "Bearer change-me"}


def test_health_does_not_expose_secrets():
    response = client.get("/health", headers=headers)
    assert response.status_code == 200
    assert "token" not in response.text.lower()


def test_worker_requires_authentication():
    assert client.get("/health").status_code == 401
