"""Add the durable Community phase-one data model."""

from alembic import op


revision = "0002_community_phase_one"
down_revision = "0001_legacy_baseline"
branch_labels = None
depends_on = None


def upgrade() -> None:
    statements = [
        "ALTER TABLE text_channels ADD COLUMN IF NOT EXISTS kind VARCHAR(24) NOT NULL DEFAULT 'text'",
        "ALTER TABLE text_channels ADD COLUMN IF NOT EXISTS parent_id INTEGER REFERENCES text_channels(id) ON DELETE CASCADE",
        "ALTER TABLE text_channels ADD COLUMN IF NOT EXISTS owner_id INTEGER REFERENCES users(id) ON DELETE SET NULL",
        "ALTER TABLE text_channels ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ",
        "ALTER TABLE text_channels ADD COLUMN IF NOT EXISTS locked BOOLEAN NOT NULL DEFAULT false",
        "ALTER TABLE text_channels ADD COLUMN IF NOT EXISTS auto_archive_minutes INTEGER NOT NULL DEFAULT 1440",
        "ALTER TABLE text_channels ADD COLUMN IF NOT EXISTS last_message_at TIMESTAMPTZ",
        "ALTER TABLE text_channels ADD COLUMN IF NOT EXISTS starter_message_id INTEGER REFERENCES messages(id) ON DELETE SET NULL",
        "CREATE INDEX IF NOT EXISTS ix_text_channels_kind ON text_channels(kind)",
        "CREATE INDEX IF NOT EXISTS ix_text_channels_parent_id ON text_channels(parent_id)",
        "CREATE INDEX IF NOT EXISTS ix_text_channels_owner_id ON text_channels(owner_id)",
        "CREATE INDEX IF NOT EXISTS ix_text_channels_archived_at ON text_channels(archived_at)",
        "CREATE INDEX IF NOT EXISTS ix_text_channels_last_message_at ON text_channels(last_message_at)",
        "CREATE INDEX IF NOT EXISTS ix_text_channels_parent_activity ON text_channels(parent_id, archived_at, last_message_at)",
    ]
    for statement in statements:
        op.execute(statement)

    # Base.metadata creates these tables on a fresh database. The IF NOT EXISTS
    # forms make the same revision safe for pre-Alembic production databases.
    op.execute("""
        CREATE TABLE IF NOT EXISTS thread_members (
          id SERIAL PRIMARY KEY,
          thread_id INTEGER NOT NULL REFERENCES text_channels(id) ON DELETE CASCADE,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          notification_level VARCHAR(16) NOT NULL DEFAULT 'all',
          last_read_message_id INTEGER REFERENCES messages(id) ON DELETE SET NULL,
          CONSTRAINT uq_thread_members_thread_user UNIQUE(thread_id, user_id),
          CONSTRAINT ck_thread_members_notification_level CHECK(notification_level IN ('all','mentions','none'))
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_thread_members_thread_id ON thread_members(thread_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_thread_members_user_id ON thread_members(user_id)")
    op.execute("""
        CREATE TABLE IF NOT EXISTS forum_settings (
          channel_id INTEGER PRIMARY KEY REFERENCES text_channels(id) ON DELETE CASCADE,
          guidelines TEXT,
          default_layout VARCHAR(16) NOT NULL DEFAULT 'list',
          default_sort VARCHAR(24) NOT NULL DEFAULT 'latest_activity',
          require_tag BOOLEAN NOT NULL DEFAULT false,
          auto_archive_minutes INTEGER NOT NULL DEFAULT 10080,
          CONSTRAINT ck_forum_layout CHECK(default_layout IN ('list','gallery')),
          CONSTRAINT ck_forum_sort CHECK(default_sort IN ('latest_activity','created_at'))
        )
    """)
    op.execute("""
        CREATE TABLE IF NOT EXISTS forum_tags (
          id SERIAL PRIMARY KEY,
          channel_id INTEGER NOT NULL REFERENCES text_channels(id) ON DELETE CASCADE,
          name VARCHAR(32) NOT NULL,
          emoji VARCHAR(128),
          moderated BOOLEAN NOT NULL DEFAULT false,
          position INTEGER NOT NULL DEFAULT 0,
          CONSTRAINT uq_forum_tags_channel_name UNIQUE(channel_id, name)
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_forum_tags_channel_id ON forum_tags(channel_id)")
    op.execute("""
        CREATE TABLE IF NOT EXISTS forum_post_tags (
          post_id INTEGER NOT NULL REFERENCES text_channels(id) ON DELETE CASCADE,
          tag_id INTEGER NOT NULL REFERENCES forum_tags(id) ON DELETE CASCADE,
          PRIMARY KEY(post_id, tag_id)
        )
    """)
    op.execute("""
        CREATE TABLE IF NOT EXISTS polls (
          id SERIAL PRIMARY KEY,
          message_id INTEGER NOT NULL UNIQUE REFERENCES messages(id) ON DELETE CASCADE,
          question VARCHAR(300) NOT NULL,
          allow_multiselect BOOLEAN NOT NULL DEFAULT false,
          expires_at TIMESTAMPTZ NOT NULL,
          closed_at TIMESTAMPTZ,
          created_by_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_polls_message_id ON polls(message_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_polls_expires_at ON polls(expires_at)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_polls_closed_at ON polls(closed_at)")
    op.execute("""
        CREATE TABLE IF NOT EXISTS poll_answers (
          id SERIAL PRIMARY KEY,
          poll_id INTEGER NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
          text VARCHAR(200) NOT NULL,
          emoji VARCHAR(128),
          position INTEGER NOT NULL,
          CONSTRAINT uq_poll_answers_position UNIQUE(poll_id, position)
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_poll_answers_poll_id ON poll_answers(poll_id)")
    op.execute("""
        CREATE TABLE IF NOT EXISTS poll_votes (
          id BIGSERIAL PRIMARY KEY,
          poll_id INTEGER NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
          answer_id INTEGER NOT NULL REFERENCES poll_answers(id) ON DELETE CASCADE,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          CONSTRAINT uq_poll_votes_poll_answer_user UNIQUE(poll_id, answer_id, user_id)
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_poll_votes_poll_id ON poll_votes(poll_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_poll_votes_answer_id ON poll_votes(answer_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_poll_votes_user_id ON poll_votes(user_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_poll_votes_poll_user ON poll_votes(poll_id, user_id)")
    op.execute("""
        CREATE TABLE IF NOT EXISTS user_notifications (
          id BIGSERIAL PRIMARY KEY,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          type VARCHAR(32) NOT NULL,
          actor_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
          server_id INTEGER REFERENCES channels(id) ON DELETE SET NULL,
          channel_id INTEGER REFERENCES text_channels(id) ON DELETE SET NULL,
          message_id INTEGER REFERENCES messages(id) ON DELETE SET NULL,
          dedupe_key VARCHAR(160),
          payload JSONB NOT NULL DEFAULT '{}'::jsonb,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          read_at TIMESTAMPTZ,
          CONSTRAINT uq_user_notifications_dedupe UNIQUE(user_id, dedupe_key)
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_user_notifications_user_id ON user_notifications(user_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_user_notifications_type ON user_notifications(type)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_user_notifications_inbox ON user_notifications(user_id, read_at, created_at)")
    op.execute("""
        CREATE TABLE IF NOT EXISTS server_templates (
          id SERIAL PRIMARY KEY,
          creator_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          source_server_id INTEGER REFERENCES channels(id) ON DELETE SET NULL,
          name VARCHAR(100) NOT NULL,
          description VARCHAR(500),
          schema_version INTEGER NOT NULL DEFAULT 1,
          definition JSONB NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_server_templates_creator_id ON server_templates(creator_id)")
    op.execute("""
        CREATE TABLE IF NOT EXISTS outbox_events (
          id VARCHAR(36) PRIMARY KEY,
          event_type VARCHAR(64) NOT NULL,
          topic VARCHAR(16) NOT NULL,
          target_id INTEGER,
          payload JSONB NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          available_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          published_at TIMESTAMPTZ,
          attempts INTEGER NOT NULL DEFAULT 0,
          last_error VARCHAR(500),
          CONSTRAINT ck_outbox_topic CHECK(topic IN ('user','channel','server','broadcast'))
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_outbox_events_event_type ON outbox_events(event_type)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_outbox_events_target_id ON outbox_events(target_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_outbox_pending ON outbox_events(published_at, available_at, created_at)")


def downgrade() -> None:
    for table in (
        "outbox_events",
        "server_templates",
        "user_notifications",
        "poll_votes",
        "poll_answers",
        "polls",
        "forum_post_tags",
        "forum_tags",
        "forum_settings",
        "thread_members",
    ):
        op.execute(f"DROP TABLE IF EXISTS {table} CASCADE")
    for column in (
        "starter_message_id",
        "last_message_at",
        "auto_archive_minutes",
        "locked",
        "archived_at",
        "owner_id",
        "parent_id",
        "kind",
    ):
        op.execute(f"ALTER TABLE text_channels DROP COLUMN IF EXISTS {column} CASCADE")
