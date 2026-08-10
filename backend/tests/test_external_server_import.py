from __future__ import annotations

import pytest
from fastapi import HTTPException
from types import SimpleNamespace
from unittest.mock import AsyncMock

from app.api import community_imports
from app.schemas.server_import import OAuthImportRequest, TemplateImportRequest
from app.services.external_source_client import PRIMARY_HOST, TEMPLATE_HOST, extract_template_code
from app.services.external_source_normalizer import normalize_source_guild, template_source


def test_template_code_accepts_only_official_hosts() -> None:
    assert extract_template_code("abc_123") == "abc_123"
    assert extract_template_code(f"https://{TEMPLATE_HOST}/abc_123") == "abc_123"
    assert extract_template_code(f"https://{PRIMARY_HOST}/template/abc_123?x=1") == "abc_123"
    with pytest.raises(HTTPException):
        extract_template_code("https://attacker.invalid/template/abc_123")


def test_template_source_keeps_snowflake_as_string() -> None:
    source, external_id, name = template_source({
        "source_guild_id": "823212361677537281",
        "serialized_source_guild": {"name": "Large ID", "channels": [], "roles": []},
    })
    assert source["name"] == "Large ID"
    assert external_id == "823212361677537281"
    assert name == "Large ID"


def test_normalizer_maps_structure_and_materializes_category_permissions() -> None:
    source = {
        "name": "Source",
        "roles": [
            {"id": "1", "name": "@everyone", "position": 0, "permissions": "1024"},
            {"id": "2", "name": "Mods", "position": 10, "permissions": "8", "color": 0x23A55A},
            {"id": "3", "name": "Managed", "position": 20, "permissions": "8", "managed": True},
        ],
        "channels": [
            {
                "id": "10", "type": 4, "name": "Private", "position": 0,
                "permission_overwrites": [{"id": "1", "type": 0, "allow": "0", "deny": "1024"}],
            },
            {
                "id": "11", "type": 0, "name": "staff", "parent_id": "10", "position": 0,
                "permission_overwrites": [
                    {"id": "2", "type": 0, "allow": "1024", "deny": "0"},
                    {"id": "999", "type": 1, "allow": "1024", "deny": "0"},
                ],
            },
            {"id": "12", "type": 13, "name": "Stage", "parent_id": "10", "bitrate": 128000},
            {
                "id": "13", "type": 15, "name": "Ideas", "parent_id": "10", "flags": 16,
                "default_forum_layout": 2, "default_sort_order": 1,
                "available_tags": [{"name": "Plan", "emoji_name": "🧩", "moderated": True}],
            },
        ],
    }
    definition, warnings = normalize_source_guild(source)
    assert [role["name"] for role in definition["roles"]] == ["@everyone", "Mods"]
    assert definition["roles"][1]["color"] == "#23a55a"
    assert definition["categories"] == [{"key": "category:10", "name": "Private", "position": 0}]
    assert [channel["type"] for channel in definition["channels"]] == ["text", "voice", "forum"]
    assert definition["channels"][1]["bitrate"] == 96
    assert definition["channels"][2]["forum"]["require_tag"] is True
    assert definition["channels"][2]["forum"]["default_layout"] == "gallery"
    staff_overwrites = [item for item in definition["overwrites"] if item["channel_key"] == "text:11"]
    assert {item["target_role_key"] for item in staff_overwrites} == {"everyone", "role:2"}
    assert any("Персональные права" in warning for warning in warnings)
    assert any("Сценические" in warning for warning in warnings)


def test_external_import_routes_are_v1_only() -> None:
    from main import app

    paths = {route.path for route in app.routes}
    assert "/api/v1/server-imports/external/template" in paths
    assert not any(path.startswith("/api/v10/server-imports") for path in paths)


class FakeDb:
    def __init__(self) -> None:
        self.added = []
        self.commit = AsyncMock()
        self.refresh = AsyncMock()

    def add(self, value) -> None:
        self.added.append(value)


@pytest.mark.asyncio
async def test_public_template_preview_creates_ready_owned_job(monkeypatch: pytest.MonkeyPatch) -> None:
    payload = {
        "source_guild_id": "823212361677537281",
        "serialized_source_guild": {
            "name": "Imported",
            "roles": [{"id": "1", "name": "@everyone", "position": 0, "permissions": "1024"}],
            "channels": [{"id": "2", "name": "general", "type": 0, "position": 0}],
        },
    }
    monkeypatch.setattr(community_imports, "fetch_public_template", AsyncMock(return_value=payload))
    db = FakeDb()
    result = await community_imports.preview_public_template(
        TemplateImportRequest(template="abc_123"),
        SimpleNamespace(id=77),
        db,
    )
    assert result["status"] == "ready"
    assert result["external_server_id"] == "823212361677537281"
    assert result["preview"]["channels"][0]["name"] == "general"
    assert db.added[0].user_id == 77
    db.commit.assert_awaited_once()


@pytest.mark.asyncio
async def test_id_import_starts_oauth_without_coercing_snowflake(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(community_imports, "oauth_configured", lambda: True)
    monkeypatch.setattr(community_imports, "oauth_authorize_url", lambda state, redirect: f"https://provider.invalid/?state={state}")
    db = FakeDb()
    result = await community_imports.start_oauth_import(
        OAuthImportRequest(server_id="823212361677537281"),
        SimpleNamespace(id=88),
        db,
    )
    assert result["status"] == "awaiting_oauth"
    assert result["authorize_url"].startswith("https://provider.invalid/")
    assert db.added[0].external_server_id == "823212361677537281"
    assert len(db.added[0].oauth_state_hash) == 64
