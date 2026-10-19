from unittest.mock import AsyncMock

import pytest
from aiogram.types import Update
from planerbot.bot import create_dispatcher
from planerbot.repository import ChatRecord, TopicRecord
from test_bot import bot_stub, store_stub, update


def membership_update(status, *, old="member", chat_type="supergroup", forum=False):
    user = {"id": 123456789, "is_bot": True, "first_name": "Bot"}
    member = {"status": status, "user": user}
    previous = {"status": old, "user": user}
    for value in (member, previous):
        if value["status"] == "administrator":
            value.update(
                {
                    name: False
                    for name in (
                        "can_be_edited",
                        "is_anonymous",
                        "can_manage_chat",
                        "can_delete_messages",
                        "can_manage_video_chats",
                        "can_restrict_members",
                        "can_promote_members",
                        "can_change_info",
                        "can_invite_users",
                        "can_post_stories",
                        "can_edit_stories",
                        "can_delete_stories",
                        "can_send_welcome_messages",
                    )
                }
            )
    return Update.model_validate(
        {
            "update_id": 2,
            "my_chat_member": {
                "chat": {"id": -1, "type": chat_type, "title": "А", "is_forum": forum},
                "from": {"id": 42, "is_bot": False, "first_name": "Admin"},
                "date": 0,
                "old_chat_member": previous,
                "new_chat_member": member,
            },
        }
    )


@pytest.mark.parametrize(
    "chat_type,forum,title",
    [
        ("group", False, "Чат"),
        ("supergroup", False, "Чат"),
        ("supergroup", True, "Общая"),
    ],
)
async def test_admin_promotion_connects_without_setup(chat_type, forum, title):
    store, bot = store_stub(), bot_stub()
    await create_dispatcher(store, AsyncMock()).feed_update(
        bot,
        membership_update("administrator", chat_type=chat_type, forum=forum),
    )
    store.register.assert_awaited_once_with(-1, "А", 1, title, overwrite_title=False)
    calls = [call.args[1] for call in bot.session.call_args_list]
    commands = [call for call in calls if call.__api_method__ == "setMyCommands"]
    assert [[c.command for c in call.commands] for call in commands] == [
        ["calendar", "support"],
        ["calendar", "support", "event", "settings"],
    ]
    assert commands[0].scope.type == "chat"
    assert commands[1].scope.type == "chat_administrators"
    assert calls[-2].reply_markup.keyboard[0][0].text == "Календарь"
    assert calls[-2].reply_markup.is_persistent
    assert calls[-1].reply_markup.inline_keyboard[0][0].url.endswith("?startapp=chat_-1")


@pytest.mark.parametrize("status", ["member", "left"])
async def test_non_admin_does_not_connect(status):
    store, bot = store_stub(), bot_stub()
    await create_dispatcher(store, AsyncMock()).feed_update(bot, membership_update(status))
    store.register.assert_not_awaited()
    store.set_active.assert_awaited_once_with(-1, False)
    assert bool(bot.session.call_args_list) == (status == "member")


async def test_private_status_and_admin_right_changes_do_not_send_welcome():
    store, bot = store_stub(), bot_stub()
    dispatcher = create_dispatcher(store, AsyncMock())
    await dispatcher.feed_update(bot, membership_update("member", chat_type="private"))
    store.set_active.assert_not_awaited()
    await dispatcher.feed_update(bot, membership_update("administrator", old="administrator"))
    assert len(bot.session.call_args_list) == 2  # Only command scopes, no second greeting.


@pytest.mark.parametrize(
    "service,title",
    [
        ({"forum_topic_created": {"name": "Встречи", "icon_color": 0}}, "Встречи"),
        ({"forum_topic_edited": {"name": "Новое имя"}}, "Новое имя"),
        ({"forum_topic_edited": {"icon_custom_emoji_id": "123"}}, "Тема 10"),
        ({}, "Тема 10"),
    ],
)
async def test_discovers_topics_from_messages(service, title):
    store, bot, events = store_stub(), bot_stub(), AsyncMock()
    store.get.return_value = ChatRecord(-1, "А", ())
    payload = update("hello").model_dump(mode="json", by_alias=True, exclude_none=True)
    payload["message"].update(service)
    await create_dispatcher(store, AsyncMock(), events).feed_update(
        bot, Update.model_validate(payload)
    )
    store.register.assert_awaited_once_with(
        -1,
        "А",
        10,
        title,
        overwrite_title=bool(
            service.get("forum_topic_created") or service.get("forum_topic_edited", {}).get("name")
        ),
    )


async def test_known_disabled_topic_is_not_renamed_or_enabled():
    store = store_stub()
    store.get.return_value = ChatRecord(-1, "А", (TopicRecord(10, "Имя", False),))
    await create_dispatcher(store, AsyncMock(), AsyncMock()).feed_update(
        bot_stub(), update("hello")
    )
    store.register.assert_not_awaited()


@pytest.mark.parametrize("chat_type", ["group", "supergroup"])
async def test_plain_group_import_has_no_thread(chat_type):
    store, events = store_stub(), AsyncMock()
    store.get.return_value = ChatRecord(-1, "А", ())
    await create_dispatcher(store, AsyncMock(), events).feed_update(
        bot_stub(),
        update("/event\nНазвание: A", chat_type=chat_type, forum=False),
    )
    store.register.assert_awaited_once_with(-1, "А", 1, "Чат", overwrite_title=False)
    assert events.import_message.call_args.args[2] == 1


async def test_setup_is_optional_but_still_supported_in_plain_group():
    from planerbot.access import Membership

    store, gateway = store_stub(), AsyncMock()
    gateway.membership.return_value = Membership("administrator")
    await create_dispatcher(store, gateway).feed_update(bot_stub(), update(forum=False))
    store.register.assert_awaited_once_with(-1, "А", 1, "Чат")
