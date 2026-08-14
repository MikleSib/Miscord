"""add sound expression emoji and default volume

Revision ID: 0016_sound_expression_controls
Revises: 0015_media_and_stage
"""

from alembic import op
import sqlalchemy as sa


revision = "0016_sound_expression_controls"
down_revision = "0015_media_and_stage"
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    columns = {column["name"] for column in inspector.get_columns("server_expressions")}
    if "emoji" not in columns:
        op.add_column("server_expressions", sa.Column("emoji", sa.String(64), nullable=True))
    if "volume" not in columns:
        op.add_column(
            "server_expressions",
            sa.Column("volume", sa.Integer(), nullable=False, server_default="100"),
        )
    constraints = {item["name"] for item in inspector.get_check_constraints("server_expressions")}
    if "ck_server_expressions_volume" not in constraints:
        op.create_check_constraint(
            "ck_server_expressions_volume",
            "server_expressions",
            "volume >= 0 AND volume <= 100",
        )


def downgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    constraints = {item["name"] for item in inspector.get_check_constraints("server_expressions")}
    if "ck_server_expressions_volume" in constraints:
        op.drop_constraint("ck_server_expressions_volume", "server_expressions", type_="check")
    columns = {column["name"] for column in inspector.get_columns("server_expressions")}
    if "volume" in columns:
        op.drop_column("server_expressions", "volume")
    if "emoji" in columns:
        op.drop_column("server_expressions", "emoji")
