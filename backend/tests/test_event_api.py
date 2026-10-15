from uuid import uuid4

from conftest import TOKEN, signed
from event_helpers import STAMP, A, B, draft, services
from httpx import ASGITransport, AsyncClient
from planerbot.api import create_app
from planerbot.config import Settings
from planerbot.publications import PublicationRepository


async def test_http_create_update_cancel_and_private_lists(engine):
    service, _, roles = await services(engine)
    app = create_app(
        Settings(_env_file=None, bot_token=TOKEN),
        engine=engine,
        access=service.access,
        event_service=service,
    )
    async with AsyncClient(transport=ASGITransport(app), base_url="http://test") as client:
        headers = {"Authorization": "tma " + signed(), "Idempotency-Key": str(uuid4())}
        path = f"/api/chats/{A}/events"
        response = await client.post(path, headers=headers, json=draft().model_dump(mode="json"))
        assert response.status_code == 200
        event = response.json()
        assert event["data"]["place"] == "Кафе" and event["publication_status"] == "pending"
        duplicate = await client.post(path, headers=headers, json=draft().model_dump(mode="json"))
        assert duplicate.json()["id"] == event["id"]
        changed = await client.put(
            path + "/" + event["id"],
            headers=headers,
            json={**draft(place="Парк").model_dump(mode="json"), "version": 1},
        )
        assert changed.status_code == 200 and changed.json()["version"] == 2
        assert (
            await client.post(
                path + "/" + event["id"] + "/cancel", headers=headers, json={"version": 1}
            )
        ).status_code == 409
        assert (
            await client.post(
                path + "/" + event["id"] + "/cancel", headers=headers, json={"version": 2}
            )
        ).status_code == 200
        assert (
            await client.post(
                path + "/" + event["id"] + "/approve", headers=headers, json={"version": 3}
            )
        ).status_code == 409
        assert (
            await client.post(
                f"/api/chats/{B}/events/{event['id']}/cancel", headers=headers, json={"version": 3}
            )
        ).status_code == 404
        assert (
            await client.post(
                path, headers=headers, json=draft(topic_id=20).model_dump(mode="json")
            )
        ).status_code == 422
        query = "/api/events?start=2026-10-01&end=2026-11-01"
        assert len((await client.get(query, headers=headers)).json()["events"]) == 1
        member = {"Authorization": "tma " + signed(user_id=43)}
        assert (
            await client.post(path, headers=member, json=draft().model_dump(mode="json"))
        ).status_code == 422  # Missing idempotency key.
        assert (await client.get(query + f"&chat_id={B}", headers=member)).status_code == 403
        roles[(A, 43)] = "left"
        assert not (await client.get(query, headers=member)).json()["events"]
        assert (await client.get(query)).status_code == 401
        assert (
            await client.get("/api/events?start=2026-10-01&end=2027-11-01", headers=headers)
        ).status_code == 422


async def test_settings_approval_and_retry_routes(engine):
    service, gateway, _ = await services(engine)
    app = create_app(
        Settings(_env_file=None, bot_token=TOKEN),
        engine=engine,
        access=service.access,
        event_service=service,
    )
    headers = {"Authorization": "tma " + signed()}
    async with AsyncClient(transport=ASGITransport(app), base_url="http://test") as client:
        settings = {
            "version": 1,
            "timezone": "Europe/Moscow",
            "event_tag": "#событие",
            "enabled_topic_ids": [10],
            "creation_policy": "members",
        }
        assert (
            await client.put(f"/api/chats/{A}/settings", headers=headers, json=settings)
        ).status_code == 204
        pending = await service.import_message(
            43, A, 10, "#событие\nНазвание: Встреча\nДата: 2026-10-20", 1, STAMP, 1
        )
        assert (
            await client.post(
                f"/api/chats/{A}/events/{pending.id}/approve", headers=headers, json={"version": 1}
            )
        ).status_code == 200
        created = await service.create(42, A, draft(), uuid4())
        store = PublicationRepository(engine)
        job = await store.claim()
        assert job.event.id == created.id
        await store.finish(job, "unknown")
        endpoint = f"/api/chats/{A}/events/{created.id}/retry"
        assert (await client.post(endpoint, headers=headers, json={})).status_code == 409
        assert (
            await client.post(endpoint, headers=headers, json={"ack_duplicate_risk": True})
        ).status_code == 204
        from planerbot.access import AccessUnavailable

        gateway.membership.side_effect = AccessUnavailable
        assert (
            await client.get("/api/events?start=2026-10-01&end=2026-11-01", headers=headers)
        ).status_code == 503


async def test_unconfigured_events(monkeypatch):
    from planerbot.auth import Viewer

    monkeypatch.setattr(
        "planerbot.api.validate_init_data", lambda *args: Viewer(id=42, first_name="x")
    )
    app = create_app(Settings(_env_file=None, bot_token=""))
    async with AsyncClient(transport=ASGITransport(app), base_url="http://test") as client:
        response = await client.get(
            "/api/events?start=2026-10-01&end=2026-11-01", headers={"Authorization": "tma x"}
        )
        assert response.status_code == 503
