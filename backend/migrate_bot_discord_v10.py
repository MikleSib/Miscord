"""Idempotent Discord API v10 compatibility migration for the bot platform.

The legacy permission columns are deliberately preserved. This lets the old
backend keep serving correct permissions while the new image is preflighted
and also leaves a safe rollback path after deployment.
"""

from __future__ import annotations

import asyncio
import hashlib
import secrets

from sqlalchemy import text

from app.db.database import engine


LEGACY_TO_DISCORD = {
    0: 10,  # VIEW_CHANNELS -> VIEW_CHANNEL
    1: 11,  # SEND_MESSAGES
    2: 13,  # MANAGE_MESSAGES
    3: 4,   # MANAGE_CHANNELS
    4: 5,   # MANAGE_SERVER -> MANAGE_GUILD
    5: 28,  # MANAGE_ROLES
    6: 1,   # KICK_MEMBERS
    7: 2,   # BAN_MEMBERS
    8: 0,   # CREATE_INVITE -> CREATE_INSTANT_INVITE
    9: 5,   # MANAGE_INVITES -> MANAGE_GUILD
    10: 7,  # VIEW_AUDIT_LOG
    11: 27, # MANAGE_NICKNAMES
    12: 22, # MUTE_MEMBERS
    13: 23, # DEAFEN_MEMBERS
    14: 24, # MOVE_MEMBERS
    15: 3,  # ADMINISTRATOR
    16: 28, # MANAGE_PERMISSIONS -> MANAGE_ROLES
    17: 29, # MANAGE_WEBHOOKS
    18: 38, # SEND_MESSAGES_IN_THREADS
}


def _permission_expression(column: str) -> str:
    parts = [
        f"(CASE WHEN ({column} & {1 << old_bit}) <> 0 THEN {1 << new_bit} ELSE 0 END)"
        for old_bit, new_bit in LEGACY_TO_DISCORD.items()
    ]
    return " | ".join(parts)


SCHEMA_STATEMENTS = (
    "ALTER TABLE server_roles ADD COLUMN IF NOT EXISTS permissions_v10 BIGINT",
    "ALTER TABLE channel_permission_overwrites ADD COLUMN IF NOT EXISTS allow_v10 BIGINT",
    "ALTER TABLE channel_permission_overwrites ADD COLUMN IF NOT EXISTS deny_v10 BIGINT",
    "ALTER TABLE bot_installs ADD COLUMN IF NOT EXISTS permissions_v10 BIGINT",
    "ALTER TABLE bot_installs ALTER COLUMN intents SET DEFAULT 513",
    "ALTER TABLE bot_commands ADD COLUMN IF NOT EXISTS default_member_permissions_v10 BIGINT",
    "ALTER TABLE bot_commands ADD COLUMN IF NOT EXISTS name_localizations JSONB",
    "ALTER TABLE bot_commands ADD COLUMN IF NOT EXISTS description_localizations JSONB",
    "ALTER TABLE bot_commands ADD COLUMN IF NOT EXISTS contexts JSONB",
    "ALTER TABLE bot_commands ADD COLUMN IF NOT EXISTS integration_types JSONB",
    "ALTER TABLE bot_commands ADD COLUMN IF NOT EXISTS nsfw BOOLEAN NOT NULL DEFAULT FALSE",
    "ALTER TABLE bot_applications ADD COLUMN IF NOT EXISTS bot_public BOOLEAN NOT NULL DEFAULT TRUE",
    "ALTER TABLE bot_applications ADD COLUMN IF NOT EXISTS bot_require_code_grant BOOLEAN NOT NULL DEFAULT FALSE",
    "ALTER TABLE bot_applications ADD COLUMN IF NOT EXISTS terms_of_service_url VARCHAR(2048)",
    "ALTER TABLE bot_applications ADD COLUMN IF NOT EXISTS privacy_policy_url VARCHAR(2048)",
    "ALTER TABLE bot_applications ADD COLUMN IF NOT EXISTS redirect_uris JSONB NOT NULL DEFAULT '[]'::jsonb",
    "ALTER TABLE bot_applications ADD COLUMN IF NOT EXISTS interactions_endpoint_url VARCHAR(2048)",
    "ALTER TABLE bot_applications ADD COLUMN IF NOT EXISTS event_webhooks_url VARCHAR(2048)",
    "ALTER TABLE bot_applications ADD COLUMN IF NOT EXISTS event_webhooks_status INTEGER NOT NULL DEFAULT 1",
    "ALTER TABLE bot_applications ADD COLUMN IF NOT EXISTS event_webhooks_types JSONB NOT NULL DEFAULT '[]'::jsonb",
    "ALTER TABLE bot_applications ADD COLUMN IF NOT EXISTS tags JSONB NOT NULL DEFAULT '[]'::jsonb",
    "ALTER TABLE bot_applications ADD COLUMN IF NOT EXISTS install_params JSONB",
    "ALTER TABLE bot_applications ADD COLUMN IF NOT EXISTS integration_types_config JSONB NOT NULL DEFAULT '{}'::jsonb",
    "ALTER TABLE bot_applications ADD COLUMN IF NOT EXISTS custom_install_url VARCHAR(2048)",
    "ALTER TABLE bot_applications ADD COLUMN IF NOT EXISTS flags BIGINT NOT NULL DEFAULT 0",
    "ALTER TABLE bot_application_secrets ADD COLUMN IF NOT EXISTS client_secret_hash VARCHAR(64)",
    "ALTER TABLE bot_application_secrets ADD COLUMN IF NOT EXISTS client_secret_hint VARCHAR(12)",
    "ALTER TABLE bot_application_secrets ADD COLUMN IF NOT EXISTS client_secret_rotation_id INTEGER NOT NULL DEFAULT 1",
    "ALTER TABLE messages ADD COLUMN IF NOT EXISTS components JSONB NOT NULL DEFAULT '[]'::jsonb",
    "ALTER TABLE messages ADD COLUMN IF NOT EXISTS poll JSONB",
    "ALTER TABLE messages ADD COLUMN IF NOT EXISTS message_type INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE messages ADD COLUMN IF NOT EXISTS application_id VARCHAR(32)",
    "CREATE INDEX IF NOT EXISTS ix_messages_application_id ON messages(application_id)",
    "ALTER TABLE messages ADD COLUMN IF NOT EXISTS interaction_metadata JSONB",
    "ALTER TABLE messages ADD COLUMN IF NOT EXISTS ephemeral_user_id INTEGER REFERENCES users(id) ON DELETE CASCADE",
    "CREATE INDEX IF NOT EXISTS ix_messages_ephemeral_user_id ON messages(ephemeral_user_id)",
    "ALTER TABLE messages ADD COLUMN IF NOT EXISTS tts BOOLEAN NOT NULL DEFAULT FALSE",
    "ALTER TABLE bot_interactions ADD COLUMN IF NOT EXISTS interaction_type INTEGER NOT NULL DEFAULT 2",
    "ALTER TABLE bot_interactions ADD COLUMN IF NOT EXISTS request_payload JSONB NOT NULL DEFAULT '{}'::jsonb",
    "ALTER TABLE bot_interactions ADD COLUMN IF NOT EXISTS deferred BOOLEAN NOT NULL DEFAULT FALSE",
    "ALTER TABLE bot_interactions ADD COLUMN IF NOT EXISTS ephemeral BOOLEAN NOT NULL DEFAULT FALSE",
    "ALTER TABLE bot_interactions ADD COLUMN IF NOT EXISTS acknowledged_at TIMESTAMPTZ",
    "ALTER TABLE bot_interactions ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ",
    "CREATE INDEX IF NOT EXISTS ix_bot_interactions_expires_at ON bot_interactions(expires_at)",
    "ALTER TABLE bot_interactions ADD COLUMN IF NOT EXISTS original_message_id INTEGER REFERENCES messages(id) ON DELETE SET NULL",
    """
    CREATE TABLE IF NOT EXISTS bot_interaction_messages (
        id SERIAL PRIMARY KEY,
        interaction_id INTEGER NOT NULL REFERENCES bot_interactions(id) ON DELETE CASCADE,
        message_id INTEGER NOT NULL UNIQUE REFERENCES messages(id) ON DELETE CASCADE,
        is_original BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT uq_bot_interaction_message UNIQUE (interaction_id, message_id)
    )
    """,
    "CREATE INDEX IF NOT EXISTS ix_bot_interaction_messages_interaction_id ON bot_interaction_messages(interaction_id)",
    "CREATE UNIQUE INDEX IF NOT EXISTS ix_bot_interaction_messages_message_id ON bot_interaction_messages(message_id)",
    """
    CREATE TABLE IF NOT EXISTS bot_oauth_authorization_codes (
        id SERIAL PRIMARY KEY,
        code_hash VARCHAR(64) NOT NULL UNIQUE,
        application_id INTEGER NOT NULL REFERENCES bot_applications(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        redirect_uri VARCHAR(2048) NOT NULL,
        scopes JSONB NOT NULL DEFAULT '[]'::jsonb,
        guild_id BIGINT,
        permissions BIGINT NOT NULL DEFAULT 0,
        code_challenge VARCHAR(128),
        code_challenge_method VARCHAR(10),
        expires_at TIMESTAMPTZ NOT NULL,
        used_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
    """,
    "CREATE UNIQUE INDEX IF NOT EXISTS ix_bot_oauth_authorization_codes_hash ON bot_oauth_authorization_codes(code_hash)",
    "CREATE INDEX IF NOT EXISTS ix_bot_oauth_authorization_codes_application_id ON bot_oauth_authorization_codes(application_id)",
    "CREATE INDEX IF NOT EXISTS ix_bot_oauth_authorization_codes_user_id ON bot_oauth_authorization_codes(user_id)",
    "CREATE INDEX IF NOT EXISTS ix_bot_oauth_authorization_codes_expires_at ON bot_oauth_authorization_codes(expires_at)",
    """
    CREATE TABLE IF NOT EXISTS bot_oauth_tokens (
        id SERIAL PRIMARY KEY,
        access_token_hash VARCHAR(64) NOT NULL UNIQUE,
        refresh_token_hash VARCHAR(64) UNIQUE,
        application_id INTEGER NOT NULL REFERENCES bot_applications(id) ON DELETE CASCADE,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        scopes JSONB NOT NULL DEFAULT '[]'::jsonb,
        grant_type VARCHAR(32) NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL,
        revoked_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
    """,
    "CREATE UNIQUE INDEX IF NOT EXISTS ix_bot_oauth_tokens_access_hash ON bot_oauth_tokens(access_token_hash)",
    "CREATE UNIQUE INDEX IF NOT EXISTS ix_bot_oauth_tokens_refresh_hash ON bot_oauth_tokens(refresh_token_hash) WHERE refresh_token_hash IS NOT NULL",
    "CREATE INDEX IF NOT EXISTS ix_bot_oauth_tokens_application_id ON bot_oauth_tokens(application_id)",
    "CREATE INDEX IF NOT EXISTS ix_bot_oauth_tokens_user_id ON bot_oauth_tokens(user_id)",
    "CREATE INDEX IF NOT EXISTS ix_bot_oauth_tokens_expires_at ON bot_oauth_tokens(expires_at)",
    "CREATE INDEX IF NOT EXISTS ix_bot_oauth_tokens_revoked_at ON bot_oauth_tokens(revoked_at)",
    "DROP INDEX IF EXISTS uq_bot_commands_scope_name",
    "CREATE UNIQUE INDEX IF NOT EXISTS uq_bot_commands_scope_name_type ON bot_commands(application_id, COALESCE(server_id, 0), name, command_type)",
)


FINALIZE_STATEMENTS = (
    "ALTER TABLE server_roles ALTER COLUMN permissions_v10 SET DEFAULT 0",
    "ALTER TABLE server_roles ALTER COLUMN permissions_v10 SET NOT NULL",
    "ALTER TABLE channel_permission_overwrites ALTER COLUMN allow_v10 SET DEFAULT 0",
    "ALTER TABLE channel_permission_overwrites ALTER COLUMN allow_v10 SET NOT NULL",
    "ALTER TABLE channel_permission_overwrites ALTER COLUMN deny_v10 SET DEFAULT 0",
    "ALTER TABLE channel_permission_overwrites ALTER COLUMN deny_v10 SET NOT NULL",
    "ALTER TABLE bot_installs ALTER COLUMN permissions_v10 SET DEFAULT 0",
    "ALTER TABLE bot_installs ALTER COLUMN permissions_v10 SET NOT NULL",
    "ALTER TABLE bot_application_secrets ALTER COLUMN client_secret_hash SET NOT NULL",
    "ALTER TABLE bot_application_secrets ALTER COLUMN client_secret_hint SET NOT NULL",
)


async def migrate() -> None:
    async with engine.begin() as connection:
        for statement in SCHEMA_STATEMENTS:
            await connection.execute(text(statement))

        await connection.execute(text(
            f"UPDATE server_roles SET permissions_v10 = {_permission_expression('permissions')} "
            "WHERE permissions_v10 IS NULL"
        ))
        await connection.execute(text(
            f"UPDATE channel_permission_overwrites SET allow_v10 = {_permission_expression('allow')} "
            "WHERE allow_v10 IS NULL"
        ))
        await connection.execute(text(
            f"UPDATE channel_permission_overwrites SET deny_v10 = {_permission_expression('deny')} "
            "WHERE deny_v10 IS NULL"
        ))
        await connection.execute(text(
            f"UPDATE bot_installs SET permissions_v10 = {_permission_expression('permissions')} "
            "WHERE permissions_v10 IS NULL"
        ))
        # The former default requested MESSAGE_CONTENT but omitted GUILDS. New
        # installs use Discord's non-privileged GUILDS + GUILD_MESSAGES baseline.
        await connection.execute(text(
            "UPDATE bot_installs SET intents = 513 WHERE intents = 33280"
        ))
        await connection.execute(text(
            f"UPDATE bot_commands SET default_member_permissions_v10 = {_permission_expression('default_member_permissions')} "
            "WHERE default_member_permissions IS NOT NULL AND default_member_permissions_v10 IS NULL"
        ))

        missing_secrets = await connection.execute(text(
            "SELECT id FROM bot_application_secrets "
            "WHERE client_secret_hash IS NULL OR client_secret_hint IS NULL"
        ))
        for secret_id in missing_secrets.scalars().all():
            generated = secrets.token_urlsafe(32)
            await connection.execute(
                text(
                    "UPDATE bot_application_secrets "
                    "SET client_secret_hash = :digest, client_secret_hint = :hint "
                    "WHERE id = :secret_id"
                ),
                {
                    "digest": hashlib.sha256(generated.encode("utf-8")).hexdigest(),
                    "hint": generated[-6:],
                    "secret_id": int(secret_id),
                },
            )

        for statement in FINALIZE_STATEMENTS:
            await connection.execute(text(statement))

    await engine.dispose()


if __name__ == "__main__":
    asyncio.run(migrate())
