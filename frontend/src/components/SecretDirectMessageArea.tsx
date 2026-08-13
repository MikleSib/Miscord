'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';
import { ArrowLeft, KeyRound, Loader2, LockKeyhole, RotateCcw, Send } from 'lucide-react';
import type { User } from '../types';
import websocketService from '../services/websocketService';
import { secretDmApi, type SecretWireMessage } from '../services/e2ee/secretDmApi';
import { secretDmCrypto, type DecryptedSecretMessage } from '../services/e2ee/secretDmCrypto';
import { useAuthStore } from '../store/store';
import { UserAvatar } from './ui/user-avatar';

type DisplayMessage = DecryptedSecretMessage & { pending?: boolean };

export function SecretDirectMessageArea({ friend, onClose }: { friend: User; onClose: () => void }) {
  const user = useAuthStore((state) => state.user);
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [peerReady, setPeerReady] = useState<boolean | null>(null);
  const [checkingPeer, setCheckingPeer] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [safetyCode, setSafetyCode] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const pendingNonces = useRef(new Set<string>());

  useEffect(() => {
    if (!user) return;
    let active = true;
    setLoading(true);
    setPeerReady(null);
    setError(null);
    setMessages([]);
    void (async () => {
      try {
        await secretDmCrypto.initialize(user.id);
        const [wireMessages, session, peerDevice] = await Promise.all([
          secretDmApi.messages(friend.id),
          secretDmApi.session(friend.id),
          secretDmApi.peerDevice(friend.id),
        ]);
        if (active) setPeerReady(Boolean(session || peerDevice));
        const decrypted: DisplayMessage[] = [];
        for (const wire of wireMessages) decrypted.push(await secretDmCrypto.decrypt(friend.id, wire));
        if (active) setMessages(decrypted);
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : 'Не удалось открыть секретный чат');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [friend.id, user?.id]);

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
        setMessages((current) => {
          const withoutPending = current.filter((item) => item.client_nonce !== wire.client_nonce);
          return withoutPending.some((item) => item.id === wire.id) ? withoutPending : [...withoutPending, message];
        });
        setSending(false);
      }).catch((cause) => setError(cause instanceof Error ? cause.message : 'Не удалось расшифровать сообщение'));
    };
    const onReset = (payload: { data?: { peer_id?: number } }) => {
      if (payload.data?.peer_id === friend.id) {
        void secretDmCrypto.forgetSession(friend.id);
        setMessages([]);
        setError('Собеседник сбросил ключи. Отправьте новое сообщение, чтобы создать защищённую сессию.');
      }
    };
    const onFailure = (payload: { data?: { client_nonce?: string; message?: string } }) => {
      const nonce = payload.data?.client_nonce;
      if (!nonce || !pendingNonces.current.delete(nonce)) return;
      setMessages((current) => current.filter((message) => message.client_nonce !== nonce));
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
  }, [friend.id, user?.id]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'auto' }); }, [messages.length]);

  const checkPeer = async () => {
    setCheckingPeer(true);
    setError(null);
    try {
      setPeerReady(Boolean(await secretDmApi.peerDevice(friend.id)));
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
      setMessages((current) => [...current, {
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
      setMessages((current) => current.filter((message) => message.client_nonce !== clientNonce));
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
    setMessages([]);
    setSafetyCode(null);
    setError(null);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-[#323339]">
      <header className="flex min-h-14 flex-shrink-0 items-center gap-2 border-b border-[#2c2d32] px-3 sm:px-4">
        <button onClick={onClose} className="grid h-11 w-11 place-items-center rounded-md text-text-quiet hover:bg-surface-raised hover:text-white" aria-label="Вернуться в обычный чат">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <UserAvatar user={friend} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2"><h2 className="truncate font-semibold text-white">{friend.username}</h2><LockKeyhole className="h-4 w-4 text-emerald-400" /></div>
          <p className="truncate text-xs text-emerald-300">Сквозное шифрование OpenMLS</p>
        </div>
        <button onClick={() => void showSafetyCode()} className="grid h-11 w-11 place-items-center rounded-md text-text-quiet hover:bg-surface-raised hover:text-white" aria-label="Показать код безопасности" title="Код безопасности"><KeyRound className="h-5 w-5" /></button>
        <button onClick={() => void resetSession()} className="grid h-11 w-11 place-items-center rounded-md text-text-quiet hover:bg-red-500/10 hover:text-red-300" aria-label="Сбросить секретную сессию" title="Сбросить ключи"><RotateCcw className="h-5 w-5" /></button>
      </header>
      <div className="border-b border-emerald-500/15 bg-emerald-500/5 px-4 py-2 text-xs leading-5 text-emerald-100">
        Текст шифруется на этом устройстве. Miscord хранит только MLS-шифротекст. Вложения, ответы и реакции здесь отключены.
      </div>
      {safetyCode && <div className="border-b border-border bg-surface-raised px-4 py-3 text-sm text-white"><span className="text-text-quiet">Сверьте код голосом:</span> <strong className="ml-2 font-mono tracking-wider">{safetyCode}</strong></div>}
      {error && <div role="alert" className="mx-4 mt-3 rounded-md border border-red-400/25 bg-red-500/10 px-3 py-2 text-sm text-red-100">{error}</div>}
      <div className="chat-scroll min-h-0 flex-1 overflow-y-auto px-3 py-4 sm:px-5">
        {loading ? (
          <div className="flex h-full items-center justify-center gap-2 text-text-quiet"><Loader2 className="h-5 w-5 animate-spin" />Подготовка защищённого чата…</div>
        ) : peerReady === false ? (
          <div className="flex h-full flex-col items-center justify-center px-6 text-center">
            <LockKeyhole className="mb-4 h-10 w-10 text-amber-300" />
            <h3 className="font-semibold text-white">Ожидаем ключ собеседника</h3>
            <p className="mt-2 max-w-md text-sm leading-6 text-text-quiet">
              Сквозное шифрование включается автоматически при входе в Miscord. Попросите собеседника открыть приложение, затем проверьте снова.
            </p>
            <button
              type="button"
              onClick={() => void checkPeer()}
              disabled={checkingPeer}
              className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-lg bg-primary px-4 font-semibold text-white disabled:opacity-50"
            >
              {checkingPeer && <Loader2 className="h-4 w-4 animate-spin" />}
              Проверить снова
            </button>
          </div>
        ) : messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center px-6 text-center"><LockKeyhole className="mb-4 h-10 w-10 text-emerald-400" /><h3 className="font-semibold text-white">Начните секретный чат</h3><p className="mt-2 max-w-md text-sm leading-6 text-text-quiet">Первое сообщение создаст MLS-сессию. Сервер не получит его открытый текст.</p></div>
        ) : messages.map((message) => {
          const own = message.sender_id === user?.id;
          return (
            <div key={message.id} className={`mb-2 flex ${own ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[82%] rounded-xl px-3 py-2 ${own ? 'bg-primary text-white' : 'bg-surface-raised text-white'} ${message.pending ? 'opacity-65' : ''}`}>
                {message.decryptError ? <span className="text-sm text-red-200">{message.decryptError}</span> : <p className="whitespace-pre-wrap break-words text-sm leading-5">{message.content}</p>}
                <div className="mt-1 flex items-center justify-end gap-1 text-[10px] opacity-60"><LockKeyhole className="h-3 w-3" />{new Date(message.timestamp).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}{message.pending && ' · отправка'}</div>
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>
      <form onSubmit={sendMessage} className="flex-shrink-0 border-t border-[#2c2d32] p-3 sm:p-4">
        <div className="flex items-end gap-2 rounded-xl bg-[#393a41] p-2">
          <textarea value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} rows={1} maxLength={5000} placeholder={peerReady === false ? 'Ожидаем ключ собеседника' : `Секретное сообщение для @${friend.username}`} className="max-h-40 min-h-11 flex-1 resize-none bg-transparent px-2 py-3 text-white outline-none placeholder:text-text-quiet" disabled={loading || sending || !peerReady} />
          <button type="submit" disabled={!input.trim() || loading || sending || !peerReady} className="grid h-11 w-11 place-items-center rounded-lg bg-primary text-white disabled:opacity-40" aria-label="Отправить секретное сообщение">{sending ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}</button>
        </div>
      </form>
    </div>
  );
}
