'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';
import { ArrowLeft, KeyRound, Loader2, LockKeyhole, RotateCcw, Send } from 'lucide-react';
import type { User } from '../types';
import websocketService from '../services/websocketService';
import { secretDmApi, type SecretWireMessage } from '../services/e2ee/secretDmApi';
import { secretDmCrypto } from '../services/e2ee/secretDmCrypto';
import { useAuthStore } from '../store/store';
import {
  EMPTY_SECRET_DM_HISTORY,
  type DisplaySecretMessage,
  secretDmHistoryKey,
  useSecretDmHistoryStore,
} from '../store/secretDmHistoryStore';
import { UserAvatar } from './ui/user-avatar';
import { formatDirectMessageDate, formatDirectMessageTime } from '../lib/directMessageTimeline';

const SECRET_GROUP_WINDOW_MS = 5 * 60 * 1000;

function startsSecretMessageGroup(message: DisplaySecretMessage, previous?: DisplaySecretMessage): boolean {
  if (!previous || previous.sender_id !== message.sender_id) return true;
  return new Date(message.timestamp).getTime() - new Date(previous.timestamp).getTime() > SECRET_GROUP_WINDOW_MS;
}

function startsSecretMessageDay(message: DisplaySecretMessage, previous?: DisplaySecretMessage): boolean {
  if (!previous) return true;
  return new Date(message.timestamp).toDateString() !== new Date(previous.timestamp).toDateString();
}

export function SecretDirectMessageArea({ friend, onClose }: { friend: User; onClose: () => void }) {
  const user = useAuthStore((state) => state.user);
  const historyKey = user ? secretDmHistoryKey(user.id, friend.id) : '';
  const history = useSecretDmHistoryStore((state) => (
    historyKey ? state.conversations[historyKey] ?? EMPTY_SECRET_DM_HISTORY : EMPTY_SECRET_DM_HISTORY
  ));
  const refreshHistory = useSecretDmHistoryStore((state) => state.refresh);
  const updateMessages = useSecretDmHistoryStore((state) => state.updateMessages);
  const setCachedPeerReady = useSecretDmHistoryStore((state) => state.setPeerReady);
  const resetHistory = useSecretDmHistoryStore((state) => state.reset);
  const messages = history.messages;
  const loading = !history.loaded;
  const peerReady = history.peerReady;
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [checkingPeer, setCheckingPeer] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [safetyCode, setSafetyCode] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const pendingNonces = useRef(new Set<string>());

  useEffect(() => {
    if (!user) return;
    let active = true;
    setError(null);
    void refreshHistory(user.id, friend.id, async () => {
        await secretDmCrypto.initialize(user.id);
        const [wireMessages, session, peerDevice] = await Promise.all([
          secretDmApi.messages(friend.id),
          secretDmApi.session(friend.id),
          secretDmApi.peerDevice(friend.id),
        ]);
        const decrypted: DisplaySecretMessage[] = [];
        for (const wire of wireMessages) decrypted.push(await secretDmCrypto.decrypt(friend.id, wire));
        return { messages: decrypted, peerReady: Boolean(session || peerDevice) };
    }).catch((cause) => {
      if (active) setError(cause instanceof Error ? cause.message : 'Не удалось открыть секретный чат');
    });
    return () => { active = false; };
  }, [friend.id, refreshHistory, user?.id]);

  useEffect(() => {
    if (!user) return;
    const onMessage = (payload: unknown) => {
      const wire = ((payload as { data?: SecretWireMessage }).data || payload) as SecretWireMessage;
      if (!wire || !(
        (wire.sender_id === user.id && wire.recipient_id === friend.id)
        || (wire.sender_id === friend.id && wire.recipient_id === user.id)
      )) return;
      void secretDmCrypto.decrypt(friend.id, wire).then((message) => {
        if (wire.client_nonce) pendingNonces.current.delete(wire.client_nonce);
        updateMessages(user.id, friend.id, (current) => {
          const withoutPending = current.filter((item) => item.client_nonce !== wire.client_nonce);
          return withoutPending.some((item) => item.id === wire.id) ? withoutPending : [...withoutPending, message];
        });
        setSending(false);
      }).catch((cause) => setError(cause instanceof Error ? cause.message : 'Не удалось расшифровать сообщение'));
    };
    const onReset = (payload: { data?: { peer_id?: number } }) => {
      if (payload.data?.peer_id === friend.id) {
        void secretDmCrypto.forgetSession(friend.id);
        resetHistory(user.id, friend.id);
        setError('Собеседник сбросил ключи. Отправьте новое сообщение, чтобы создать защищённую сессию.');
      }
    };
    const onFailure = (payload: { data?: { client_nonce?: string; message?: string } }) => {
      const nonce = payload.data?.client_nonce;
      if (!nonce || !pendingNonces.current.delete(nonce)) return;
      updateMessages(user.id, friend.id, (current) => current.filter((message) => message.client_nonce !== nonce));
      setSending(false);
      setError(payload.data?.message || 'Сервер отклонил зашифрованное сообщение');
    };
    websocketService.on('secret_dm', onMessage);
    websocketService.on('secret_dm_session_reset', onReset);
    websocketService.on('message_send_failed', onFailure);
    return () => {
      websocketService.off('secret_dm', onMessage);
      websocketService.off('secret_dm_session_reset', onReset);
      websocketService.off('message_send_failed', onFailure);
    };
  }, [friend.id, resetHistory, updateMessages, user?.id]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'auto' }); }, [messages.length]);

  const checkPeer = async () => {
    setCheckingPeer(true);
    setError(null);
    try {
      if (user) setCachedPeerReady(user.id, friend.id, Boolean(await secretDmApi.peerDevice(friend.id)));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не удалось проверить поддержку шифрования');
    } finally {
      setCheckingPeer(false);
    }
  };

  const sendMessage = async (event: FormEvent) => {
    event.preventDefault();
    const content = input.trim();
    if (!content || !user || sending || !peerReady) return;
    const clientNonce = crypto.randomUUID();
    pendingNonces.current.add(clientNonce);
    setInput('');
    setSending(true);
    setError(null);
    try {
      const encrypted = await secretDmCrypto.encrypt(friend.id, content, clientNonce);
      const now = new Date().toISOString();
      updateMessages(user.id, friend.id, (current) => [...current, {
        id: `pending:${clientNonce}` as unknown as number,
        client_nonce: clientNonce,
        timestamp: now,
        sender_id: user.id,
        recipient_id: friend.id,
        encryption_version: 1,
        ciphertext: encrypted.ciphertext,
        secret_session_id: encrypted.sessionId,
        sender_device_id: encrypted.senderDeviceId,
        content,
        pending: true,
      }]);
      const accepted = websocketService.send({
        type: 'secret_dm_message',
        recipient_id: friend.id,
        client_nonce: clientNonce,
        session_id: encrypted.sessionId,
        sender_device_id: encrypted.senderDeviceId,
        ciphertext: encrypted.ciphertext,
      });
      if (!accepted) throw new Error('Нет подключения к серверу. Сообщение не отправлено.');
    } catch (cause) {
      pendingNonces.current.delete(clientNonce);
      updateMessages(user.id, friend.id, (current) => current.filter((message) => message.client_nonce !== clientNonce));
      setInput(content);
      setSending(false);
      setError(cause instanceof Error ? cause.message : 'Не удалось зашифровать сообщение');
    }
  };

  const showSafetyCode = async () => {
    try {
      setSafetyCode(await secretDmCrypto.safetyCode(friend.id));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Код безопасности недоступен');
    }
  };

  const resetSession = async () => {
    if (!window.confirm('Сбросить секретный чат? Старые сообщения останутся зашифрованы старыми ключами.')) return;
    await secretDmCrypto.reset(friend.id);
    if (user) resetHistory(user.id, friend.id);
    setSafetyCode(null);
    setError(null);
  };

  const friendName = friend.display_name || friend.username;

  return (
    <div className="direct-message-shell secret-message-shell relative flex min-h-0 flex-1 flex-col">
      <header className="direct-message-header secret-message-header">
        <div className="direct-message-header__identity">
          <button
            type="button"
            onClick={onClose}
            className="secret-message-header__action"
            aria-label="Вернуться в обычный чат"
            title="Обычный чат"
          >
            <ArrowLeft aria-hidden="true" />
          </button>
          <span className="direct-message-header__avatar">
            <UserAvatar user={friend} size={28} />
            <i className={friend.is_online ? 'is-online' : undefined} aria-hidden="true" />
          </span>
          <span className="direct-message-header__copy">
            <strong>{friendName}</strong>
            <small>@{friend.username}</small>
          </span>
          <span className="secret-message-header__badge">
            <LockKeyhole aria-hidden="true" />
            Сквозное шифрование
          </span>
        </div>
        <div className="secret-message-header__actions">
          <button
            type="button"
            onClick={() => void showSafetyCode()}
            className="secret-message-header__action"
            aria-label="Показать код безопасности"
            title="Код безопасности"
          >
            <KeyRound aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => void resetSession()}
            className="secret-message-header__action is-danger"
            aria-label="Сбросить секретную сессию"
            title="Сбросить ключи"
          >
            <RotateCcw aria-hidden="true" />
          </button>
        </div>
      </header>

      {safetyCode && (
        <div className="secret-message-safety" role="status">
          <KeyRound aria-hidden="true" />
          <span>Сверьте код голосом:</span>
          <strong>{safetyCode}</strong>
        </div>
      )}
      {error && <div role="alert" className="secret-message-error">{error}</div>}

      <div className="direct-message-scroll chat-scroll">
        {loading ? (
          <div className="secret-message-state" role="status">
            <Loader2 className="is-spinning" aria-hidden="true" />
            <strong>Подготавливаем защищённый чат</strong>
            <span>Проверяем ключи этого устройства.</span>
          </div>
        ) : peerReady === false ? (
          <div className="secret-message-state">
            <span className="secret-message-state__icon is-waiting"><LockKeyhole aria-hidden="true" /></span>
            <strong>Ожидаем ключ собеседника</strong>
            <p>
              Сквозное шифрование включается автоматически при входе в Miscord. Попросите собеседника открыть приложение, затем проверьте снова.
            </p>
            <button
              type="button"
              onClick={() => void checkPeer()}
              disabled={checkingPeer}
              className="secret-message-state__button"
            >
              {checkingPeer && <Loader2 className="is-spinning" aria-hidden="true" />}
              Проверить снова
            </button>
          </div>
        ) : (
          <div className="direct-message-timeline secret-message-timeline" role="log" aria-label={`Секретная переписка с ${friendName}`}>
            <section className="direct-message-intro" aria-label="Начало секретной переписки">
              <UserAvatar user={friend} size={64} className="direct-message-intro__avatar" />
              <h2>{friendName}</h2>
              <p>@{friend.username}</p>
              <span className="direct-message-intro__summary secret-message-intro__summary">
                <LockKeyhole aria-hidden="true" />
                Сообщения защищены сквозным шифрованием.
              </span>
            </section>

            {messages.map((message, index) => {
              const previous = messages[index - 1];
              const startsGroup = startsSecretMessageGroup(message, previous);
              const startsDay = startsSecretMessageDay(message, previous);
              const own = message.sender_id === user?.id;
              const author = own ? user : friend;

              return (
                <div key={message.id}>
                  {startsDay && (
                    <div className="date-divider" role="separator">
                      <span>{formatDirectMessageDate(message.timestamp)}</span>
                    </div>
                  )}
                  <article className={`direct-message-entry ${startsGroup ? 'is-group-start' : 'is-grouped'}`}>
                    <div className="direct-message-entry__avatar">
                      {startsGroup ? (
                        <UserAvatar user={author || undefined} size={40} />
                      ) : (
                        <time dateTime={message.timestamp}>{formatDirectMessageTime(message.timestamp)}</time>
                      )}
                    </div>
                    <div className="direct-message-entry__body">
                      {startsGroup && (
                        <header>
                          <strong>{author?.display_name || author?.username || 'Пользователь'}</strong>
                          <time dateTime={message.timestamp}>{formatDirectMessageTime(message.timestamp)}</time>
                          <LockKeyhole className="secret-message-entry__lock" aria-label="Зашифровано" />
                          {message.pending && (
                            <span className="direct-message-entry__pending">
                              <Loader2 className="is-spinning" aria-hidden="true" /> Отправляется…
                            </span>
                          )}
                        </header>
                      )}
                      <div className={`direct-message-entry__content ${message.pending ? 'is-pending' : ''}`}>
                        {message.decryptError ? (
                          <span className="secret-message-entry__error">{message.decryptError}</span>
                        ) : (
                          message.content
                        )}
                      </div>
                    </div>
                  </article>
                </div>
              );
            })}
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <form onSubmit={sendMessage} className="direct-message-composer secret-message-composer">
        {!loading && peerReady === false && (
          <div className="direct-message-composer__notice">Отправка станет доступна, когда собеседник опубликует ключ.</div>
        )}
        <div className="direct-message-composer__form">
          <div className="direct-message-composer__row">
            <LockKeyhole className="secret-message-composer__lock" aria-hidden="true" />
            <textarea
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  event.currentTarget.form?.requestSubmit();
                }
              }}
              rows={1}
              maxLength={5000}
              placeholder={peerReady === false ? 'Ожидаем ключ собеседника' : `Секретное сообщение для @${friend.username}`}
              disabled={loading || sending || !peerReady}
            />
            <div className="direct-message-composer__actions">
              <button type="submit" disabled={!input.trim() || loading || sending || !peerReady} aria-label="Отправить секретное сообщение">
                {sending ? <Loader2 className="is-spinning" aria-hidden="true" /> : <Send aria-hidden="true" />}
              </button>
            </div>
          </div>
        </div>
      </form>
    </div>
  );
}
