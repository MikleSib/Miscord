"""Bounded realtime handlers; shared protocol helpers live in unified_support."""

from .unified_support import *  # noqa: F401,F403
from app.services.message_delivery import load_message_for_delivery, message_ack_payload
from app.schemas.expressions import GifSelection
from app.services.message_media import attach_message_media
from app.core.metrics import record_voice_join
from time import perf_counter

async def websocket_unified_endpoint(
    websocket: WebSocket,
):
    db: Optional[AsyncSession] = None
    user: Optional[User] = None
    current_text_channels: set = set()
    current_voice_channel: Optional[int] = None
    current_voice_connection_id: Optional[str] = None
    ws_id = id(websocket)
    heartbeat_misses = 0

    try:
        db = AsyncSessionLocal()
        await websocket.accept()
        try:
            raw_identify = await asyncio.wait_for(websocket.receive_text(), timeout=10.0)
            identify = json.loads(raw_identify)
            token = identify.get("token") if isinstance(identify, dict) and identify.get("type") == "identify" else None
        except WebSocketDisconnect:
            return
        except (asyncio.TimeoutError, json.JSONDecodeError):
            token = None
        if not isinstance(token, str) or not token:
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION, reason="Identify required")
            return
        user = await get_user_by_token_ws(token, db)
        if not user:
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
            return

        await manager.connect(websocket, user.id, accept=False)
        await websocket.send_text(json.dumps({"type": "identified", "protocol_version": 1}))
        await user_activity_service.update_user_activity(user.id, db)
        _structured_log(user, "connect", ws_id=ws_id)

        try:
            while True:
                try:
                    data = await asyncio.wait_for(websocket.receive_text(), timeout=30.0)
                    if not isinstance(data, str):
                        continue

                    try:
                        message_data = json.loads(data)
                    except json.JSONDecodeError as e:
                        _structured_log(user, "invalid_json", ws_id=ws_id, error=str(e))
                        continue

                    if not isinstance(message_data, dict):
                        continue

                    msg_type = message_data.get("type")
                    request_id = _extract_request_id(message_data)
                    heartbeat_misses = 0
                    _structured_log(
                        user,
                        "message_received",
                        message_type=msg_type,
                        request_id=request_id,
                        ws_id=ws_id,
                    )

                    if msg_type == "ping":
                        await user_activity_service.heartbeat_user(user.id, db)
                        if current_voice_connection_id:
                            await voice_presence.touch(current_voice_connection_id)
                        await websocket.send_text(json.dumps({"type": "pong"}))

                    elif msg_type == "chat_message":
                        await handle_chat_message(user, message_data, db, manager, current_text_channels)

                    elif msg_type == "subscribe_channel":
                        try:
                            channel_id = int(message_data.get("text_channel_id"))
                        except (TypeError, ValueError):
                            channel_id = 0
                        channel = await get_visible_text_channel(db, channel_id) if channel_id else None
                        if channel and await user_can_access_text_channel(db, user, channel):
                            await manager.register_channel(websocket, user.id, channel.id)
                            current_text_channels.add(channel.id)
                            await websocket.send_text(json.dumps({
                                "type": "channel_subscribed",
                                "data": {"text_channel_id": channel.id},
                            }))
                        else:
                            await websocket.send_text(json.dumps({
                                "type": "error",
                                "code": "access_denied",
                                "message": "No access to channel",
                            }))

                    elif msg_type == "unsubscribe_channel":
                        try:
                            channel_id = int(message_data.get("text_channel_id"))
                        except (TypeError, ValueError):
                            channel_id = 0
                        if channel_id in current_text_channels:
                            await manager.unregister_channel(websocket, user.id, channel_id)
                            current_text_channels.discard(channel_id)

                    elif msg_type == "typing":
                        await handle_typing(user, message_data, manager, current_text_channels, db)

                    elif msg_type == "join_voice":
                        voice_join_started_at = perf_counter()
                        try:
                            current_voice_channel, current_voice_connection_id = await join_group_voice(
                                user=user,
                                message=message_data,
                                db=db,
                                websocket=websocket,
                                manager=manager,
                                local_connections=voice_connections,
                                request_id=request_id,
                            )
                            voice_join_status = "success" if current_voice_connection_id else "rejected"
                        except Exception:
                            record_voice_join("error", perf_counter() - voice_join_started_at)
                            raise
                        record_voice_join(voice_join_status, perf_counter() - voice_join_started_at)

                    elif msg_type == "leave_voice":
                        if current_voice_channel:
                            await leave_group_voice(
                                user=user,
                                channel_id=current_voice_channel,
                                session_id=current_voice_connection_id,
                                db=db,
                                manager=manager,
                                local_connections=voice_connections,
                            )
                        current_voice_channel, current_voice_connection_id = None, None

                    elif msg_type == "voice_mute":
                        await update_group_voice_state(
                            user=user,
                            channel_id=current_voice_channel,
                            session_id=current_voice_connection_id,
                            field="is_muted",
                            value=bool(message_data.get("is_muted", False)),
                            db=db,
                            manager=manager,
                            local_connections=voice_connections,
                        )

                    elif msg_type == "voice_deafen":
                        await update_group_voice_state(
                            user=user,
                            channel_id=current_voice_channel,
                            session_id=current_voice_connection_id,
                            field="is_deafened",
                            value=bool(message_data.get("is_deafened", False)),
                            db=db,
                            manager=manager,
                            local_connections=voice_connections,
                        )

                    elif msg_type == "screen_share_start":
                        await update_group_voice_state(
                            user=user,
                            channel_id=current_voice_channel,
                            session_id=current_voice_connection_id,
                            field="is_sharing_screen",
                            value=True,
                            db=db,
                            manager=manager,
                            local_connections=voice_connections,
                        )

                    elif msg_type == "screen_share_stop":
                        await update_group_voice_state(
                            user=user,
                            channel_id=current_voice_channel,
                            session_id=current_voice_connection_id,
                            field="is_sharing_screen",
                            value=False,
                            db=db,
                            manager=manager,
                            local_connections=voice_connections,
                        )

                    elif msg_type == "screen_share_viewer_joined":
                        try:
                            streamer_id = int(message_data.get("streamer_id"))
                        except (TypeError, ValueError):
                            streamer_id = 0
                        await notify_screen_share_viewer_joined(
                            user=user,
                            channel_id=current_voice_channel,
                            streamer_id=streamer_id,
                            manager=manager,
                        )

                    elif msg_type == "voice_media_ticket_refresh":
                        await refresh_group_voice_ticket(
                            user=user,
                            channel_id=current_voice_channel,
                            session_id=current_voice_connection_id,
                            websocket=websocket,
                            request_id=request_id,
                            db=db,
                        )

                    elif msg_type == "voice_speaking":
                        if current_voice_channel:
                            await broadcast_voice(manager, current_voice_channel, {
                                "type": "voice_speaking",
                                "user_id": user.id,
                                "is_speaking": bool(message_data.get("is_speaking")),
                                "voice_channel_id": current_voice_channel,
                            })

                    elif msg_type == "dm_message":
                        await handle_dm_message(user, message_data, db, manager)

                    elif msg_type == "secret_dm_message":
                        await handle_secret_dm_message(user, message_data, db, manager)

                    elif msg_type == "pong":
                        await user_activity_service.heartbeat_user(user.id, db)

                    elif msg_type == "voice_debug":
                        await websocket.send_text(json.dumps({
                            "type": "voice_debug",
                            "data": _voice_debug_metrics(),
                        }))

                    else:
                        print(f"[UnifiedWS] unhandled message: {msg_type}")

                except asyncio.TimeoutError:
                    heartbeat_misses += 1
                    if heartbeat_misses >= 2:
                        _structured_log(
                            user,
                            "heartbeat_timeout",
                            ws_id=ws_id,
                            misses=heartbeat_misses,
                        )
                        break
                    await websocket.send_text(json.dumps({"type": "ping"}))

        except WebSocketDisconnect:
            _structured_log(user, "disconnect_socket", ws_id=ws_id)
        except Exception as e:
            _structured_log(user, "endpoint_error", error=str(e))
            import traceback
            traceback.print_exc()

    except Exception as e:
        _structured_log(user, "startup_error", error=str(e))
        import traceback
        traceback.print_exc()
    finally:
        if user and db:
            if current_voice_channel:
                await leave_group_voice(
                    user=user,
                    channel_id=current_voice_channel,
                    session_id=current_voice_connection_id,
                    db=db,
                    manager=manager,
                    local_connections=voice_connections,
                )

            for channel_id in tuple(current_text_channels):
                await manager.unregister_channel(websocket, user.id, channel_id)
            current_text_channels.clear()
            await manager.disconnect(websocket, user.id)
            if not manager.is_user_connected(user.id):
                await user_activity_service.set_user_offline(user.id, db)
            _structured_log(user, "disconnect", ws_id=ws_id)

        if db:
            await db.close()


# ==================== CHAT ====================


async def handle_chat_message(
    user: User,
    message_data: dict,
    db: AsyncSession,
    manager,
    current_channels: set
):
    content = message_data.get("content", "").strip()
    text_channel_id = message_data.get("text_channel_id")
    attachments = list(message_data.get("attachments", []) or [])
    attachment_upload_ids = list(dict.fromkeys(str(item) for item in (message_data.get("attachment_upload_ids") or [])))
    client_nonce = message_data.get("client_nonce")
    reply_to_id = message_data.get("reply_to_id")
    poll_data = message_data.get("poll")
    sticker_ids = list(dict.fromkeys(int(item) for item in (message_data.get("sticker_ids") or [])))
    gif_data = message_data.get("gif")
    try:
        gif_selection = GifSelection.model_validate(gif_data) if gif_data else None
    except Exception:
        await send_message_failure(user.id, client_nonce, "invalid_gif", "Выбранный GIF недоступен")
        return

    if client_nonce is not None and (not isinstance(client_nonce, str) or len(client_nonce) > 64):
        return

    if not text_channel_id:
        await send_message_failure(user.id, client_nonce, "invalid_channel", "Канал не указан")
        return

    text_channel = await get_visible_text_channel(db, text_channel_id)
    if not text_channel:
        await send_message_failure(user.id, client_nonce, "access_denied", "Канал не найден или недоступен")
        return

    from app.services.channel_access import user_can_access_text_channel
    if not await user_can_access_text_channel(db, user, text_channel, need_send=True):
        await send_message_failure(user.id, client_nonce, "access_denied", "Нет права отправлять сообщения в этот канал")
        await manager.send_to_user(user.id, {
            "type": "error",
            "message": "No access to channel",
            "text_channel_id": text_channel_id,
        })
        return

    if client_nonce:
        existing = (await db.execute(select(Message).where(
            Message.author_id == user.id,
            Message.client_nonce == client_nonce,
        ))).scalar_one_or_none()
        if existing is not None:
            if existing.text_channel_id != text_channel_id or (existing.content or "") != content:
                await send_message_failure(user.id, client_nonce, "nonce_conflict", "client_nonce уже использован для другого сообщения")
                return
            _, existing_payload = await load_message_for_delivery(db, existing.id, user.id)
            await manager.send_to_user(user.id, message_ack_payload(existing_payload))
            return

    pending_uploads = []
    if attachment_upload_ids:
        pending_uploads = (await db.execute(select(PendingChatUpload).where(
            PendingChatUpload.id.in_(attachment_upload_ids),
            PendingChatUpload.owner_id == user.id,
        ))).scalars().all()
        if len(pending_uploads) != len(attachment_upload_ids):
            await send_message_failure(user.id, client_nonce, "upload_expired", "Загрузка файла не найдена или истекла", True)
            return
        attachments.extend(item.file_url for item in pending_uploads)

    poll_payload = None
    if poll_data is not None:
        if not settings.POLLS_ENABLED:
            await send_message_failure(user.id, client_nonce, "feature_disabled", "Опросы пока недоступны")
            return
        try:
            poll_payload = PollCreate.model_validate(poll_data)
        except Exception:
            await send_message_failure(user.id, client_nonce, "invalid_poll", "Проверьте вопрос, варианты и длительность опроса")
            return
        await require_poll_permission(db, text_channel, user)

    if not content and not attachments and poll_payload is None and not sticker_ids and gif_selection is None:
        await send_message_failure(user.id, client_nonce, "empty_message", "Сообщение не содержит текста или файлов")
        return

    if reply_to_id:
        reply_channel_id = await db.scalar(
            select(Message.text_channel_id).where(Message.id == reply_to_id)
        )
        if reply_channel_id != text_channel_id:
            await send_message_failure(
                user.id,
                client_nonce,
                "invalid_reply",
                "Сообщение для ответа не найдено в этом канале",
            )
            return
    if len(content) > 5000 or len(attachments) > 10:
        await send_message_failure(user.id, client_nonce, "validation_error", "Превышен лимит текста или вложений")
        return

    from app.services.communication_safety import evaluate_automod
    automod_allowed, automod_reason = await evaluate_automod(
        db,
        int(text_channel.channel_id),
        content,
        user_id=user.id,
        channel_id=int(text_channel_id),
    )
    if not automod_allowed:
        await send_message_failure(
            user.id,
            client_nonce,
            "automod_blocked",
            automod_reason or "Сообщение заблокировано AutoMod.",
        )
        return

    allowed, retry_after, limit_message = enforce_message_antispam(
        user.id,
        dest_key=f"channel:{text_channel_id}",
        content=content,
    )
    if not allowed:
        await send_message_failure(user.id, client_nonce, "rate_limited", limit_message, True, retry_after)
        await manager.send_to_user(
            user.id,
            rate_limit_payload(
                message=limit_message,
                retry_after_seconds=retry_after,
                scope="channel",
                text_channel_id=text_channel_id,
            ),
        )
        return

    allowed, retry_after = await check_slow_mode(db, text_channel, user)
    if not allowed:
        await send_message_failure(user.id, client_nonce, "slow_mode", "В канале включен медленный режим", True, retry_after)
        await manager.send_to_user(user.id, {
            "type": "slow_mode",
            "text_channel_id": text_channel_id,
            "retry_after_seconds": retry_after,
        })
        return

    db_message = Message(
        client_nonce=client_nonce,
        content=content if content else None,
        author_id=user.id,
        text_channel_id=text_channel_id,
        reply_to_id=reply_to_id if reply_to_id else None,
    )

    pending_by_url = {item.file_url: item for item in pending_uploads}
    for url in attachments:
        pending = pending_by_url.get(url)
        attachment = Attachment(
            file_url=url,
            original_filename=pending.original_filename if pending else None,
            content_type=pending.content_type if pending else None,
            size_bytes=pending.size_bytes if pending else None,
            storage_key=pending.storage_key if pending else None,
        )
        db_message.attachments.append(attachment)

    db.add(db_message)
    await db.flush()
    try:
        await attach_message_media(
            db,
            message_id=db_message.id,
            sticker_ids=sticker_ids,
            gif=gif_selection,
            server_id=text_channel.channel_id,
        )
    except ValueError as exc:
        await db.rollback()
        await send_message_failure(user.id, client_nonce, "invalid_sticker", str(exc))
        return
    if poll_payload is not None:
        await create_poll_for_message(
            db,
            message=db_message,
            creator_id=user.id,
            payload=poll_payload,
        )
    if getattr(text_channel, "kind", "text") in {"public_thread", "private_thread", "forum_post"}:
        text_channel.last_message_at = datetime.now(timezone.utc)
        if text_channel.kind == "forum_post" and text_channel.parent_id:
            from app.services.realtime_events import enqueue_realtime_event
            enqueue_realtime_event(
                db,
                event_type="THREAD_UPDATE",
                data={
                    "id": text_channel.id,
                    "server_id": text_channel.channel_id,
                    "parent_id": text_channel.parent_id,
                    "last_message_at": text_channel.last_message_at.isoformat(),
                },
                topic="server",
                target_id=text_channel.channel_id,
            )
    for pending in pending_uploads:
        await db.delete(pending)
    await db.commit()
    await db.refresh(db_message)

    full_message, message_dict = await load_message_for_delivery(db, db_message.id, user.id)

    await manager.send_to_channel(text_channel_id, {
        "type": "new_message",
        "data": message_dict,
    })
    await bot_event_dispatcher.dispatch_message_create(db, full_message)
    await manager.send_to_user(user.id, message_ack_payload(message_dict))

    await notify_message_mentions(
        db,
        manager,
        content=content,
        author=user,
        text_channel=text_channel,
        message_id=full_message.id,
    )
    if full_message.reply_to and full_message.reply_to.author_id:
        await create_notification(
            db,
            user_id=full_message.reply_to.author_id,
            type="thread_reply" if text_channel.parent_id else "reply",
            actor_user_id=user.id,
            server_id=text_channel.channel_id,
            channel_id=text_channel.id,
            message_id=full_message.id,
            dedupe_key=f"reply:{full_message.id}",
            payload={"thread_id": text_channel.id if text_channel.parent_id else None},
        )
        await db.commit()
    await notify_channel_message_activity(
        db,
        manager,
        content=content,
        author=user,
        text_channel=text_channel,
        message_id=full_message.id,
    )
    await user_activity_service.update_user_activity(user.id, db)


async def handle_typing(user: User, message_data: dict, manager, current_channels: set, db: AsyncSession):
    text_channel_id = message_data.get("text_channel_id")
    if text_channel_id:
        await manager.send_to_channel(text_channel_id, {
            "type": "typing",
            "user": {"id": user.id, "username": user.display_name or user.username},
            "text_channel_id": text_channel_id,
        })
        await bot_event_dispatcher.dispatch_typing_start(db, int(text_channel_id), user.id)
