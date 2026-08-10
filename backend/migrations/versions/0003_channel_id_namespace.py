"""Reserve a collision-free API ID range for text resources.

The legacy schema uses independent integer sequences for servers and text
channels even though both are addressed through /api/v1/channels/{id}.
Moving only the text sequence forward keeps existing IDs stable and guarantees
that newly-created threads cannot shadow a server route.
"""

from alembic import op


revision = "0003_channel_id_namespace"
down_revision = "0002_community_phase_one"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        SELECT setval(
          pg_get_serial_sequence('text_channels', 'id'),
          GREATEST((SELECT COALESCE(MAX(id), 0) + 1 FROM text_channels), 1000000000),
          false
        )
    """)


def downgrade() -> None:
    op.execute("""
        SELECT setval(
          pg_get_serial_sequence('text_channels', 'id'),
          GREATEST((SELECT COALESCE(MAX(id), 0) + 1 FROM text_channels), 1),
          false
        )
    """)
