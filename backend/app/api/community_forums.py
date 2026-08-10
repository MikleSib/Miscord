from __future__ import annotations

from datetime import datetime, timezone
import math

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.config import settings
from app.core.dependencies import get_current_active_user
from app.core.permissions import Permission, has_permission, require_permission
from app.db.database import get_db
from app.models import (
    Attachment,
    AuditLog,
    Channel,
    ChannelCategory,
    ForumPostTag,
    ForumSettings,
    ForumTag,
    Message,
    PendingChatUpload,
    TextChannel,
    ThreadMember,
    User,
)
from app.schemas.forum import ForumCreate, ForumPostCreate, ForumSettingsUpdate, ForumTagCreate, ForumTagUpdate
from app.services.bot_event_dispatcher import dispatcher as bot_dispatcher
from app.services.channel_access import require_text_channel_access
from app.services.channel_permissions import get_effective_channel_permissions
from app.services.realtime_events import enqueue_realtime_event
from app.services.thread_serializer import serialize_thread

router = APIRouter()


def _add_forum_audit(
    db: AsyncSession,
    *,
    forum: TextChannel,
    user: User,
    action: str,
    target_type: str,
    target_id: int | None = None,
    target_name: str | None = None,
    changes: dict | None = None,
) -> None:
    db.add(AuditLog(
        server_id=forum.channel_id,
        actor_id=user.id,
        action=action,
        target_type=target_type,
        target_id=target_id,
        target_name=target_name,
        changes=changes,
    ))


def _require_feature() -> None:
    if not settings.FORUMS_ENABLED:
        raise HTTPException(status_code=404, detail="Форумы пока недоступны")


async def _get_forum(db: AsyncSession, user: User, forum_id: int) -> TextChannel:
    forum = await require_text_channel_access(db, user, forum_id)
    if forum.kind != "forum":
        raise HTTPException(status_code=404, detail="Форум не найден")
    return forum


async def _forum_permissions(db: AsyncSession, forum: TextChannel, user: User) -> int:
    server = await db.get(Channel, forum.channel_id)
    if not server:
        return 0
    return await get_effective_channel_permissions(
        db, server.id, user.id, "text", forum.id, owner_id=server.owner_id
    )


async def _serialize_forum(db: AsyncSession, forum: TextChannel) -> dict:
    forum_settings = await db.get(ForumSettings, forum.id)
    tags = list((await db.execute(select(ForumTag).where(ForumTag.channel_id == forum.id).order_by(ForumTag.position, ForumTag.id))).scalars().all())
    return {
        "id": forum.id,
        "server_id": forum.channel_id,
        "name": forum.name,
        "kind": forum.kind,
        "category_id": forum.category_id,
        "position": forum.position,
        "created_at": forum.created_at,
        "settings": {
            "guidelines": forum_settings.guidelines,
            "default_layout": forum_settings.default_layout,
            "default_sort": forum_settings.default_sort,
            "require_tag": forum_settings.require_tag,
            "auto_archive_minutes": forum_settings.auto_archive_minutes,
            "slow_mode_seconds": forum.slow_mode_seconds,
        } if forum_settings else None,
        "tags": [
            {"id": tag.id, "name": tag.name, "emoji": tag.emoji, "moderated": tag.moderated, "position": tag.position}
            for tag in tags
        ],
    }


@router.post("/{server_id}/forums", status_code=201)
async def create_forum(
    server_id: int,
    payload: ForumCreate,
    user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    _require_feature()
    await require_permission(db, server_id, user, Permission.MANAGE_CHANNELS)
    if payload.category_id is not None:
        category = await db.scalar(select(ChannelCategory.id).where(ChannelCategory.id == payload.category_id, ChannelCategory.server_id == server_id))
        if category is None:
            raise HTTPException(status_code=400, detail="Категория не принадлежит серверу")
    forum = TextChannel(
        name=payload.name,
        channel_id=server_id,
        category_id=payload.category_id,
        position=payload.position,
        kind="forum",
        auto_archive_minutes=payload.auto_archive_minutes,
        slow_mode_seconds=payload.slow_mode_seconds,
    )
    db.add(forum)
    await db.flush()
    db.add(ForumSettings(
        channel_id=forum.id,
        guidelines=payload.guidelines,
        default_layout=payload.default_layout,
        default_sort=payload.default_sort,
        require_tag=payload.require_tag,
        auto_archive_minutes=payload.auto_archive_minutes,
    ))
    _add_forum_audit(db, forum=forum, user=user, action="forum_create", target_type="channel", target_id=forum.id, target_name=forum.name)
    enqueue_realtime_event(db, event_type="FORUM_CREATE", data={"id": forum.id, "server_id": server_id, "name": forum.name}, topic="server", target_id=server_id)
    await db.commit()
    await db.refresh(forum)
    await bot_dispatcher.dispatch_guild_event(db, server_id, "CHANNEL_CREATE", {"id": str(forum.id), "guild_id": str(server_id), "name": forum.name, "type": "forum"})
    return await _serialize_forum(db, forum)


@router.get("/{forum_id}/forum-settings")
async def get_forum_settings(
    forum_id: int,
    user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    _require_feature()
    return await _serialize_forum(db, await _get_forum(db, user, forum_id))


@router.patch("/{forum_id}/forum-settings")
async def update_forum_settings(
    forum_id: int,
    payload: ForumSettingsUpdate,
    user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    _require_feature()
    forum = await _get_forum(db, user, forum_id)
    await require_permission(db, forum.channel_id, user, Permission.MANAGE_CHANNELS)
    forum_settings = await db.get(ForumSettings, forum.id)
    for key, value in payload.model_dump(exclude_unset=True).items():
        if key == "slow_mode_seconds":
            forum.slow_mode_seconds = value
        else:
            setattr(forum_settings, key, value)
    _add_forum_audit(db, forum=forum, user=user, action="forum_update", target_type="channel", target_id=forum.id, target_name=forum.name, changes=payload.model_dump(exclude_unset=True))
    enqueue_realtime_event(db, event_type="FORUM_UPDATE", data={"id": forum.id, "server_id": forum.channel_id}, topic="server", target_id=forum.channel_id)
    await db.commit()
    return await _serialize_forum(db, forum)


@router.post("/{forum_id}/forum-tags", status_code=201)
async def create_forum_tag(
    forum_id: int,
    payload: ForumTagCreate,
    user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    _require_feature()
    forum = await _get_forum(db, user, forum_id)
    await require_permission(db, forum.channel_id, user, Permission.MANAGE_CHANNELS)
    position = await db.scalar(select(func.coalesce(func.max(ForumTag.position), -1)).where(ForumTag.channel_id == forum.id))
    tag = ForumTag(channel_id=forum.id, name=payload.name, emoji=payload.emoji, moderated=payload.moderated, position=int(position or -1) + 1)
    db.add(tag)
    await db.flush()
    _add_forum_audit(db, forum=forum, user=user, action="forum_tag_create", target_type="forum_tag", target_id=tag.id, target_name=tag.name)
    await db.commit()
    await db.refresh(tag)
    return {"id": tag.id, "name": tag.name, "emoji": tag.emoji, "moderated": tag.moderated, "position": tag.position}


@router.patch("/{forum_id}/forum-tags/{tag_id}")
async def update_forum_tag(
    forum_id: int,
    tag_id: int,
    payload: ForumTagUpdate,
    user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    _require_feature()
    forum = await _get_forum(db, user, forum_id)
    await require_permission(db, forum.channel_id, user, Permission.MANAGE_CHANNELS)
    tag = await db.get(ForumTag, tag_id)
    if not tag or tag.channel_id != forum.id:
        raise HTTPException(status_code=404, detail="Тег не найден")
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(tag, key, value)
    _add_forum_audit(db, forum=forum, user=user, action="forum_tag_update", target_type="forum_tag", target_id=tag.id, target_name=tag.name)
    await db.commit()
    await db.refresh(tag)
    return {"id": tag.id, "name": tag.name, "emoji": tag.emoji, "moderated": tag.moderated, "position": tag.position}


@router.delete("/{forum_id}/forum-tags/{tag_id}", status_code=204)
async def delete_forum_tag(
    forum_id: int,
    tag_id: int,
    user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    _require_feature()
    forum = await _get_forum(db, user, forum_id)
    await require_permission(db, forum.channel_id, user, Permission.MANAGE_CHANNELS)
    tag = await db.get(ForumTag, tag_id)
    if not tag or tag.channel_id != forum.id:
        raise HTTPException(status_code=404, detail="Тег не найден")
    _add_forum_audit(db, forum=forum, user=user, action="forum_tag_delete", target_type="forum_tag", target_id=tag.id, target_name=tag.name)
    await db.execute(delete(ForumTag).where(ForumTag.id == tag_id, ForumTag.channel_id == forum.id))
    await db.commit()


@router.post("/{forum_id}/posts", status_code=201)
async def create_forum_post(
    forum_id: int,
    payload: ForumPostCreate,
    user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    _require_feature()
    forum = await _get_forum(db, user, forum_id)
    permissions = await _forum_permissions(db, forum, user)
    if not has_permission(permissions, Permission.CREATE_PUBLIC_THREADS):
        raise HTTPException(status_code=403, detail="Нет права создавать публикации")
    forum_settings = await db.get(ForumSettings, forum.id)
    tag_ids = list(dict.fromkeys(payload.tag_ids))
    if forum_settings and forum_settings.require_tag and not tag_ids:
        raise HTTPException(status_code=400, detail="Выберите хотя бы один тег")
    tags = list((await db.execute(select(ForumTag).where(ForumTag.channel_id == forum.id, ForumTag.id.in_(tag_ids)))).scalars().all()) if tag_ids else []
    if len(tags) != len(tag_ids):
        raise HTTPException(status_code=400, detail="Один из тегов не принадлежит форуму")
    if any(tag.moderated for tag in tags) and not has_permission(permissions, Permission.MANAGE_THREADS):
        raise HTTPException(status_code=403, detail="Этот тег назначает только модератор")

    if forum.slow_mode_seconds > 0 and not (
        has_permission(permissions, Permission.MANAGE_CHANNELS)
        or has_permission(permissions, Permission.MANAGE_MESSAGES)
    ):
        last_post_at = await db.scalar(
            select(TextChannel.created_at)
            .where(TextChannel.parent_id == forum.id, TextChannel.owner_id == user.id)
            .order_by(TextChannel.created_at.desc())
            .limit(1)
        )
        if last_post_at is not None:
            if last_post_at.tzinfo is None:
                last_post_at = last_post_at.replace(tzinfo=timezone.utc)
            remaining = math.ceil(
                forum.slow_mode_seconds - (datetime.now(timezone.utc) - last_post_at).total_seconds()
            )
            if remaining > 0:
                raise HTTPException(
                    status_code=429,
                    detail=f"Следующую публикацию можно создать через {remaining} сек.",
                )

    upload_ids = list(dict.fromkeys(payload.attachment_upload_ids))
    uploads = list((await db.execute(select(PendingChatUpload).where(PendingChatUpload.id.in_(upload_ids), PendingChatUpload.owner_id == user.id))).scalars().all()) if upload_ids else []
    if len(uploads) != len(upload_ids):
        raise HTTPException(status_code=400, detail="Один из файлов истёк или недоступен")
    now = datetime.now(timezone.utc)
    post = TextChannel(
        name=payload.title,
        channel_id=forum.channel_id,
        category_id=forum.category_id,
        kind="forum_post",
        parent_id=forum.id,
        owner_id=user.id,
        slow_mode_seconds=forum.slow_mode_seconds,
        auto_archive_minutes=forum_settings.auto_archive_minutes if forum_settings else 10080,
        last_message_at=now,
    )
    db.add(post)
    await db.flush()
    starter = Message(content=payload.content, author_id=user.id, text_channel_id=post.id)
    for upload in uploads:
        starter.attachments.append(Attachment(file_url=upload.file_url, original_filename=upload.original_filename, content_type=upload.content_type, size_bytes=upload.size_bytes, storage_key=upload.storage_key))
        await db.delete(upload)
    db.add(starter)
    await db.flush()
    post.starter_message_id = starter.id
    db.add(ThreadMember(thread_id=post.id, user_id=user.id))
    for tag in tags:
        db.add(ForumPostTag(post_id=post.id, tag_id=tag.id))
    _add_forum_audit(db, forum=forum, user=user, action="forum_post_create", target_type="forum_post", target_id=post.id, target_name=post.name, changes={"tag_ids": tag_ids})
    enqueue_realtime_event(db, event_type="THREAD_CREATE", data={"id": post.id, "server_id": post.channel_id, "parent_id": forum.id, "kind": "forum_post"}, topic="server", target_id=post.channel_id)
    await db.commit()
    await db.refresh(post)
    await db.refresh(starter)
    loaded = await db.scalar(select(Message).where(Message.id == starter.id).options(selectinload(Message.author), selectinload(Message.attachments), selectinload(Message.reactions)))
    await bot_dispatcher.dispatch_guild_event(db, post.channel_id, "THREAD_CREATE", {"id": str(post.id), "guild_id": str(post.channel_id), "parent_id": str(forum.id), "name": post.name, "type": "forum_post"})
    if loaded:
        await bot_dispatcher.dispatch_message_create(db, loaded)
    response = await serialize_thread(db, post, user.id)
    response["tag_ids"] = tag_ids
    response["starter_message_id"] = starter.id
    return response


@router.get("/{forum_id}/posts")
async def list_forum_posts(
    forum_id: int,
    tag_ids: list[int] = Query(default=[]),
    query: str | None = Query(default=None, max_length=100),
    include_archived: bool = False,
    limit: int = Query(30, ge=1, le=100),
    before: int | None = None,
    user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    _require_feature()
    forum = await _get_forum(db, user, forum_id)
    forum_settings = await db.get(ForumSettings, forum.id)
    statement = select(TextChannel).where(TextChannel.parent_id == forum.id, TextChannel.kind == "forum_post", TextChannel.is_hidden.is_(False))
    if not include_archived:
        statement = statement.where(TextChannel.archived_at.is_(None))
    if before is not None:
        statement = statement.where(TextChannel.id < before)
    if query:
        message_match = select(Message.text_channel_id).where(Message.content.ilike(f"%{query}%"))
        statement = statement.where((TextChannel.name.ilike(f"%{query}%")) | TextChannel.id.in_(message_match))
    for tag_id in set(tag_ids):
        statement = statement.where(TextChannel.id.in_(select(ForumPostTag.post_id).where(ForumPostTag.tag_id == tag_id)))
    if forum_settings and forum_settings.default_sort == "created_at":
        statement = statement.order_by(TextChannel.created_at.desc(), TextChannel.id.desc())
    else:
        statement = statement.order_by(TextChannel.last_message_at.desc().nullslast(), TextChannel.id.desc())
    result = await db.execute(statement.limit(limit))
    posts = []
    for post in result.scalars().all():
        item = await serialize_thread(db, post, user.id)
        item["tag_ids"] = list((await db.execute(select(ForumPostTag.tag_id).where(ForumPostTag.post_id == post.id))).scalars().all())
        item["starter_message_id"] = await db.scalar(select(Message.id).where(Message.text_channel_id == post.id).order_by(Message.id).limit(1))
        posts.append(item)
    return posts
