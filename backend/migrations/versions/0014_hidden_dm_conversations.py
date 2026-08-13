"""persist hidden direct-message conversations

Revision ID: 0014_hidden_dm_conversations
Revises: 0013_e2ee_messaging
"""

from alembic import op
import sqlalchemy as sa

revision = "0014_hidden_dm_conversations"
down_revision = "0013_e2ee_messaging"
branch_labels = None
depends_on = None


def upgrade() -> None:
    tables = set(sa.inspect(op.get_bind()).get_table_names())
    if "hidden_dm_conversations" in tables:
        return
    op.create_table(
        "hidden_dm_conversations",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("peer_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("hidden_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("user_id", "peer_id", name="uq_hidden_dm_conversation_pair"),
    )
    op.create_index("ix_hidden_dm_conversations_user_id", "hidden_dm_conversations", ["user_id"])


def downgrade() -> None:
    tables = set(sa.inspect(op.get_bind()).get_table_names())
    if "hidden_dm_conversations" in tables:
        op.drop_table("hidden_dm_conversations")
