from unittest.mock import AsyncMock

import pytest
from planerbot.access import AccessUnavailable, ChatAccess, Membership
from planerbot.repository import PAGE_SIZE, ChatRecord


@pytest.mark.parametrize(
    "status,present,admin",
    [
        ("creator", True, True),
        ("administrator", True, True),
        ("member", True, False),
        ("restricted", False, False),
        ("left", False, False),
        ("kicked", False, False),
    ],
)
def test_membership(status, present, admin):
    assert Membership(status).present is present
    assert Membership(status).admin is admin
    assert Membership("restricted", True).present


async def test_two_users_and_revocation():
    store, gateway = AsyncMock(), AsyncMock()
    store.candidates.return_value = [ChatRecord(-2, "Б", ()), ChatRecord(-1, "А", ())]
    memberships = {(42, -2): "member", (42, -1): "administrator", (43, -1): "member"}

    async def check(chat, user):
        return Membership("administrator" if user == 1 else memberships.get((user, chat), "left"))

    gateway.membership.side_effect = check
    service = ChatAccess(store, gateway, 1)
    first, cursor = await service.list_for(42, None)
    assert [item.chat.title for item in first] == ["Б", "А"]
    assert [item.can_manage for item in first] == [False, True]
    assert cursor is None
    second, _ = await service.list_for(43, None)
    assert [item.chat.title for item in second] == ["А"]
    memberships[(42, -2)] = "left"
    revoked, _ = await service.list_for(42, None)
    assert [item.chat.title for item in revoked] == ["А"]


async def test_bot_rights_and_outage():
    store, gateway = AsyncMock(), AsyncMock()
    store.candidates.return_value = [ChatRecord(-1, "А", ())]
    gateway.membership.return_value = Membership("member")
    assert await ChatAccess(store, gateway, 1).list_for(42, None) == ([], None)
    gateway.membership.side_effect = AccessUnavailable
    with pytest.raises(AccessUnavailable):
        await ChatAccess(store, gateway, 1).list_for(42, None)


async def test_pagination():
    store, gateway = AsyncMock(), AsyncMock()
    store.candidates.return_value = [ChatRecord(i, str(i), ()) for i in range(PAGE_SIZE)]
    gateway.membership.return_value = Membership("administrator")
    result, cursor = await ChatAccess(store, gateway, 1).list_for(42, 0)
    assert len(result) == PAGE_SIZE
    assert cursor == "24"
    store.candidates.assert_awaited_once_with(0)
    store.candidates.return_value = []
    assert await ChatAccess(store, gateway, 1).list_for(42, 24) == ([], None)
