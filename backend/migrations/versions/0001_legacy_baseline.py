"""Establish an Alembic baseline for existing Miscord databases."""

from alembic import op

from app.db.database import Base
import app.models  # noqa: F401


revision = "0001_legacy_baseline"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Existing deployments already contain these tables. checkfirst makes the
    # baseline safe there while still bootstrapping a completely empty database.
    Base.metadata.create_all(bind=op.get_bind(), checkfirst=True)


def downgrade() -> None:
    # A baseline downgrade must never destroy a pre-Alembic production schema.
    pass
