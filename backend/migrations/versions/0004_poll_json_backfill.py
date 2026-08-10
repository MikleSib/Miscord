"""Backfill normalized polls from valid legacy message JSON.

Revision ID: 0004_poll_json_backfill
Revises: 0003_channel_id_namespace
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from alembic import op
import sqlalchemy as sa

revision = "0004_poll_json_backfill"
down_revision = "0003_channel_id_namespace"
branch_labels = None
depends_on = None


def _answers(payload: dict) -> list[dict]:
    raw = payload.get("answers") or payload.get("options") or []
    result = []
    for item in raw[:10]:
        if isinstance(item, str):
            text, emoji = item.strip(), None
        elif isinstance(item, dict):
            text = str(item.get("text") or item.get("answer_text") or "").strip()
            emoji = item.get("emoji")
            if isinstance(emoji, dict):
                emoji = emoji.get("name")
        else:
            continue
        if text:
            result.append({"text": text[:200], "emoji": str(emoji)[:128] if emoji else None})
    return result


def upgrade() -> None:
    bind = op.get_bind()
    rows = bind.execute(sa.text("SELECT id, author_id, timestamp, poll FROM messages WHERE poll IS NOT NULL ORDER BY id")).mappings()
    for row in rows:
        payload = row["poll"] if isinstance(row["poll"], dict) else {}
        question = str(payload.get("question") or payload.get("question_text") or "").strip()
        answers = _answers(payload)
        if not question or len(answers) < 2:
            continue
        exists = bind.execute(sa.text("SELECT 1 FROM polls WHERE message_id=:message_id"), {"message_id": row["id"]}).scalar()
        if exists:
            continue
        created_at = row["timestamp"] or datetime.now(timezone.utc)
        if created_at.tzinfo is None:
            created_at = created_at.replace(tzinfo=timezone.utc)
        expires_at = payload.get("expires_at")
        if isinstance(expires_at, str):
            try:
                expires_at = datetime.fromisoformat(expires_at.replace("Z", "+00:00"))
            except ValueError:
                expires_at = None
        if not isinstance(expires_at, datetime):
            duration = int(payload.get("duration_seconds") or 86400)
            expires_at = created_at + timedelta(seconds=max(3600, min(duration, 604800)))
        elif expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=timezone.utc)
        poll_id = bind.execute(sa.text("""
            INSERT INTO polls(message_id, question, allow_multiselect, expires_at, closed_at, created_by_id, created_at)
            VALUES (:message_id, :question, :multi, :expires_at, :closed_at, :creator, :created_at)
            RETURNING id
        """), {
            "message_id": row["id"], "question": question[:300],
            "multi": bool(payload.get("allow_multiselect")), "expires_at": expires_at,
            "closed_at": expires_at if expires_at <= datetime.now(timezone.utc) else None,
            "creator": row["author_id"], "created_at": created_at,
        }).scalar_one()
        for position, answer in enumerate(answers):
            bind.execute(sa.text("INSERT INTO poll_answers(poll_id, text, emoji, position) VALUES (:poll_id, :text, :emoji, :position)"), {"poll_id": poll_id, "position": position, **answer})


def downgrade() -> None:
    # Legacy JSON remains intact, so only normalized rows originating from it are removed.
    op.execute("DELETE FROM polls WHERE message_id IN (SELECT id FROM messages WHERE poll IS NOT NULL)")
