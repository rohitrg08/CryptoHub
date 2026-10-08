from __future__ import annotations

from uuid import uuid4

from fastapi.testclient import TestClient

from backend.main import app

client = TestClient(app)


def test_signup_and_login_work() -> None:
    unique = uuid4().hex[:8]
    username = f"pytest_user_{unique}"
    email = f"pytest_user_{unique}@example.com"
    password = "strongpass123"

    signup_response = client.post(
        "/api/auth/signup",
        json={"username": username, "email": email, "password": password},
    )
    assert signup_response.status_code == 201

    login_response = client.post(
        "/api/auth/login",
        data={"username": username, "password": password},
    )
    assert login_response.status_code == 200
    assert "access_token" in login_response.json()
