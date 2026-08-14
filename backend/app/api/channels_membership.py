"""Bounded route group extracted from channels_servers.py."""

from .channels_shared import *  # noqa: F401,F403
from app.services.channel_serialization import voice_channel_payload

router = APIRouter()

@router.get("/{channel_id}")
async def get_channel_details(
    channel_id: int,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db)
):
    from app.api.community_threads import get_thread_response

    thread = await get_thread_response(db, current_user, channel_id)
    if thread is not None:
        if not settings.THREADS_ENABLED:
            raise HTTPException(status_code=404, detail="Обсуждения пока недоступны")
        return thread
    """Получение детальной информации о канале и участниках сервера"""
    # Получаем основной канал
    channel_result = await db.execute(
        select(Channel)
        .options(selectinload(Channel.owner))
        .where(Channel.id == channel_id)
    )
    channel = channel_result.scalar_one_or_none()
    if not channel:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Channel not found"
        )

    # Данные сервера доступны только его участникам
    await require_membership(db, channel_id, current_user)

    # Получаем текстовые каналы
    text_result = await db.execute(
        select(TextChannel)
        .where(TextChannel.channel_id == channel_id)
        .order_by(TextChannel.position)
    )
    all_text_channels = text_result.scalars().all()
    text_channels = await filter_viewable_text_channels(
        db, channel_id, current_user.id, all_text_channels, owner_id=channel.owner_id
    )

    # Получаем голосовые каналы
    voice_result = await db.execute(
        select(VoiceChannel).where(VoiceChannel.channel_id == channel_id).order_by(VoiceChannel.position)
    )
    all_voice_channels = voice_result.scalars().all()
    voice_channels = await filter_viewable_voice_channels(
        db, channel_id, current_user.id, all_voice_channels, owner_id=channel.owner_id
    )

    # Получаем участников сервера вместе с их серверными никнеймами
    members_result = await db.execute(
        select(ChannelMember, User)
        .join(User, User.id == ChannelMember.user_id)
        .where(ChannelMember.channel_id == channel_id)
    )
    member_rows = members_result.all()

    # Роли участников определяют цвет имени в списке
    member_roles_result = await db.execute(
        select(MemberRole.user_id, Role)
        .join(Role, MemberRole.role_id == Role.id)
        .where(MemberRole.server_id == channel_id)
        .order_by(Role.position.desc())
    )
    roles_by_user: dict[int, list[Role]] = {}
    for user_id, role in member_roles_result.all():
        roles_by_user.setdefault(user_id, []).append(role)

    return {
        "id": channel.id,
        "name": channel.name,
        "description": channel.description,
        "icon": channel.icon,
        "banner": channel.banner,
        "is_public": bool(channel.is_public),
        "owner_id": channel.owner_id,
        "created_at": channel.created_at,
        "updated_at": channel.updated_at,
        "members_count": len(member_rows),
        "type": "server",  # Это сервер, содержащий каналы
        "owner": {
            "id": channel.owner.id,
            "username": channel.owner.display_name or channel.owner.username,
            "is_active": channel.owner.is_active,
            "is_online": channel.owner.is_online,
            "avatar_url": channel.owner.avatar_url,
            "created_at": channel.owner.created_at,
            "updated_at": channel.owner.updated_at
        } if channel.owner else None,
        "channels": [
            {
                "id": tc.id,
                "name": tc.name,
                "type": "text",
                "kind": tc.kind,
                "parent_id": tc.parent_id,
                "position": tc.position,
                "category_id": tc.category_id,
                "slow_mode_seconds": tc.slow_mode_seconds,
            }
            for tc in text_channels
        ] + [voice_channel_payload(vc) for vc in voice_channels],
        "members": [
            {
                "id": member.id,
                "username": member.display_name or member.username,
                "display_name": member.display_name,
                "nickname": membership.nickname,
                "is_active": member.is_active,
                "is_online": member.is_online,
                "avatar_url": member.avatar_url,
                "created_at": member.created_at,
                "updated_at": member.updated_at,
                "is_owner": member.id == channel.owner_id,
                "role_ids": [role.id for role in roles_by_user.get(member.id, [])],
                "color": next(
                    (role.color for role in roles_by_user.get(member.id, []) if role.color),
                    None,
                ),
            }
            for membership, member in member_rows
        ]
    }

@router.post("/{channel_id}/join")
async def join_channel(
    channel_id: int,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db)
):
    """Присоединение к публичному серверу. Закрытый — только по приглашению."""
    channel_result = await db.execute(
        select(Channel).where(Channel.id == channel_id)
    )
    channel = channel_result.scalar_one_or_none()
    if not channel:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Channel not found"
        )

    ban_result = await db.execute(
        select(ServerBan.id).where(
            and_(ServerBan.server_id == channel_id, ServerBan.user_id == current_user.id)
        )
    )
    if ban_result.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Вы заблокированы на этом сервере"
        )

    if not channel.is_public and current_user.id != channel.owner_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Сервер закрыт. Нужно приглашение.",
        )

    if await is_server_member(db, channel_id, current_user.id):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Already a member of this channel"
        )

    await add_member_and_notify(db, channel_id, current_user)
    return {"detail": "Successfully joined the channel"}


@router.post("/{channel_id}/leave")
async def leave_channel(
    channel_id: int,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    """Покинуть сервер (недоступно владельцу — только удаление сервера)."""
    channel_result = await db.execute(
        select(Channel).where(Channel.id == channel_id)
    )
    channel = channel_result.scalar_one_or_none()
    if not channel:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Сервер не найден",
        )

    if channel.owner_id == current_user.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Владелец не может покинуть сервер. Удалите сервер, если хотите закрыть его.",
        )

    member_result = await db.execute(
        select(ChannelMember).where(
            and_(
                ChannelMember.channel_id == channel_id,
                ChannelMember.user_id == current_user.id,
            )
        )
    )
    if not member_result.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Вы не состоите в этом сервере",
        )

    voice_channel_ids_result = await db.execute(
        select(VoiceChannel.id).where(VoiceChannel.channel_id == channel_id)
    )
    voice_channel_ids = [row[0] for row in voice_channel_ids_result.fetchall()]
    if voice_channel_ids:
        await db.execute(
            delete(VoiceChannelUser).where(
                and_(
                    VoiceChannelUser.user_id == current_user.id,
                    VoiceChannelUser.voice_channel_id.in_(voice_channel_ids),
                )
            )
        )

    await db.execute(
        delete(MemberRole).where(
            and_(
                MemberRole.server_id == channel_id,
                MemberRole.user_id == current_user.id,
            )
        )
    )

    await db.execute(
        delete(ChannelMember).where(
            and_(
                ChannelMember.channel_id == channel_id,
                ChannelMember.user_id == current_user.id,
            )
        )
    )
    await db.commit()

    try:
        await _notify_server_member_left(
            db,
            channel_id,
            current_user.id,
            exclude_user_id=current_user.id,
        )
    except Exception as exc:
        print(f"[Leave] Не удалось уведомить участников сервера: {exc}")

    await log_audit(
        db,
        channel_id,
        current_user,
        AuditAction.MEMBER_LEAVE,
        target_type="member",
        target_id=current_user.id,
        target_name=current_user.display_name or current_user.username,
    )

    return {"detail": "Successfully left the server", "channel_id": channel_id}
