import pytest
from pydantic import ValidationError

from app.core.permissions import (
    Permission,
    miscord_permissions_to_legacy,
    legacy_permissions_to_miscord,
)
from app.api.bot_client import _command_supports, _focused_option, router as bot_client_router
from app.schemas.miscord import MiscordApplicationCommandPayload, MiscordInteractionCallback, MiscordMessageCreate
from app.services.miscord_snowflake import generate_snowflake


def test_permission_values_match_miscord_v1():
    assert int(Permission.VIEW_CHANNEL) == 1 << 10
    assert int(Permission.SEND_MESSAGES) == 1 << 11
    assert int(Permission.USE_APPLICATION_COMMANDS) == 1 << 31
    assert int(Permission.BYPASS_SLOWMODE) == 1 << 52


def test_legacy_permission_round_trip_preserves_mapped_bits():
    legacy = (1 << 0) | (1 << 1) | (1 << 15) | (1 << 18)
    miscord = legacy_permissions_to_miscord(legacy)
    assert miscord & int(Permission.VIEW_CHANNEL)
    assert miscord & int(Permission.SEND_MESSAGES)
    assert miscord & int(Permission.ADMINISTRATOR)
    assert miscord & int(Permission.SEND_MESSAGES_IN_THREADS)
    assert miscord_permissions_to_legacy(miscord) & legacy == legacy


def test_command_contract_accepts_options_and_string_permissions():
    command = MiscordApplicationCommandPayload(
        name="weather",
        description="Show weather",
        default_member_permissions=str(1 << 31),
        options=[{
            "type": 3,
            "name": "city",
            "description": "City name",
            "required": True,
        }],
    )
    assert command.default_member_permissions == str(1 << 31)
    assert command.options[0]["name"] == "city"


def test_command_contract_rejects_required_option_after_optional():
    with pytest.raises(ValidationError):
        MiscordApplicationCommandPayload(
            name="invalid",
            description="Invalid order",
            options=[
                {"type": 3, "name": "optional", "description": "Optional"},
                {"type": 3, "name": "required", "description": "Required", "required": True},
            ],
        )


def test_message_components_enforce_unique_custom_ids():
    with pytest.raises(ValidationError):
        MiscordMessageCreate(
            components=[{
                "type": 1,
                "components": [
                    {"type": 2, "style": 1, "label": "One", "custom_id": "same"},
                    {"type": 2, "style": 2, "label": "Two", "custom_id": "same"},
                ],
            }],
        )


def test_generated_snowflakes_are_miscord_sized_and_monotonic():
    first = int(generate_snowflake())
    second = int(generate_snowflake())
    assert first > 0
    assert second > first
    assert second < 2**64


def test_modal_callback_matches_miscord_text_input_contract():
    callback = MiscordInteractionCallback(
        type=9,
        data={
            "custom_id": "feedback",
            "title": "Feedback",
            "components": [{
                "type": 1,
                "components": [{
                    "type": 4,
                    "custom_id": "comment",
                    "label": "Comment",
                    "style": 2,
                    "min_length": 1,
                    "max_length": 1000,
                    "required": True,
                }],
            }],
        },
    )
    assert callback.data["components"][0]["components"][0]["type"] == 4


def test_modal_callback_rejects_duplicate_text_input_ids():
    row = lambda label: {
        "type": 1,
        "components": [{"type": 4, "custom_id": "duplicate", "label": label, "style": 1}],
    }
    with pytest.raises(ValidationError):
        MiscordInteractionCallback(
            type=9,
            data={"custom_id": "feedback", "title": "Feedback", "components": [row("One"), row("Two")]},
        )


def test_client_modal_submit_route_is_registered():
    assert "/channels/{channel_id}/modal-interactions" in {route.path for route in bot_client_router.routes}


def test_command_contexts_are_enforced_for_guild_and_user_installs():
    guild_command = type("Command", (), {"integration_types": [0], "contexts": [0], "server_id": None})()
    user_command = type("Command", (), {"integration_types": [1], "contexts": [0, 1, 2], "server_id": None})()

    assert _command_supports(guild_command, 0, 0)
    assert not _command_supports(guild_command, 1, 0)
    assert _command_supports(user_command, 1, 2)


def test_autocomplete_route_and_nested_focus_are_supported():
    assert "/channels/{channel_id}/autocomplete-interactions" in {route.path for route in bot_client_router.routes}
    focused = _focused_option([{
        "name": "group",
        "options": [{"name": "query", "type": 3, "value": "mis", "focused": True}],
    }])
    assert focused and focused["name"] == "query"


def test_message_contract_accepts_multipart_attachment_metadata():
    payload = MiscordMessageCreate(
        attachments=[{"id": 0, "filename": "report.txt", "description": "Report"}],
    )
    assert payload.attachments[0]["filename"] == "report.txt"
