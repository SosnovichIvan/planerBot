import json

import pytest
from conftest import TOKEN, signed
from planerbot.auth import Unauthorized, validate_init_data


def test_valid_identity_and_signature_field():
    raw = signed({"auth_date": "1000", "user": '{"id":42,"first_name":"Иван"}', "signature": "x"})
    assert validate_init_data(raw, TOKEN, 300, now=1000).id == 42
    assert validate_init_data(raw, TOKEN, 300, now=1300).first_name == "Иван"
    assert validate_init_data(raw, TOKEN, 300, now=970).id == 42


@pytest.mark.parametrize(
    "raw,token",
    [
        ("", TOKEN),
        ("x" * 16385, TOKEN),
        (signed(), ""),
        ("invalid", TOKEN),
        ("user=1&auth_date=1000", TOKEN),
        (signed() + "&user=duplicate", TOKEN),
        (signed().replace("hash=", "hash=bad"), TOKEN),
        ("hash=é", TOKEN),
        (signed({"auth_date": "1000", "user": "broken"}), TOKEN),
        (signed({"auth_date": "1000", "user": "[]"}), TOKEN),
        (signed({"auth_date": "1000", "user": "null"}), TOKEN),
        (signed({"auth_date": "NaN", "user": "{}"}), TOKEN),
        (signed({"user": "{}"}), TOKEN),
        (signed({"auth_date": "1000"}), TOKEN),
        ("&".join(f"x{i}=y" for i in range(33)), TOKEN),
        (signed({"auth_date": "1000", "user": json.dumps({"id": True, "first_name": "x"})}), TOKEN),
        (signed({"auth_date": "1000", "user": '{"id":-1,"first_name":"x"}'}), TOKEN),
    ],
)
def test_invalid_identity(raw, token):
    with pytest.raises(Unauthorized):
        validate_init_data(raw, token, 300, now=1000)


@pytest.mark.parametrize("now", [969, 1301])
def test_expired_or_future(now):
    raw = signed({"auth_date": "1000", "user": '{"id":42,"first_name":"x"}'})
    with pytest.raises(Unauthorized):
        validate_init_data(raw, TOKEN, 300, now=now)


def test_clock_default():
    assert validate_init_data(signed(), TOKEN, 300).id == 42
