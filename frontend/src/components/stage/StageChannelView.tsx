'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Hand, Mic2, Radio, Square, Users } from 'lucide-react'

import { useStore } from '../../lib/store'
import { Permissions } from '../../lib/permissions'
import { useServerPermissions } from '../../lib/serverPermissions'
import stageService, { type StageInstance, type StageRequest, type StageRole } from '../../services/stageService'
import channelService from '../../services/channelService'
import unifiedWebSocketService from '../../services/unifiedWebSocketService'
import { useAuthStore } from '../../store/store'
import { useVoiceStore } from '../../store/slices/voiceSlice'
import type { Channel, VoiceUser } from '../../types'
import { UserAvatar } from '../ui/user-avatar'

function errorText(error: unknown): string {
  const detail = (error as any)?.response?.data?.detail
  return typeof detail === 'string' ? detail : 'Не удалось выполнить действие.'
}

function Participant({ participant, canModerate, onRole }: {
  participant: VoiceUser; canModerate: boolean; onRole: (role: StageRole) => void
}) {
  const role = participant.stage_role || 'audience'
  return <div className="flex items-center gap-3 rounded-lg px-3 py-2 hover:bg-surface-hover">
    <UserAvatar user={participant} size={38} />
    <div className="min-w-0 flex-1">
      <p className="truncate text-sm font-semibold">{participant.display_name || participant.username}</p>
      <p className="text-xs text-text-quiet">{role === 'audience' ? 'Слушатель' : role === 'moderator' ? 'Модератор' : 'Выступающий'}</p>
    </div>
    {canModerate && <button type="button" className="rounded-md border border-border px-2.5 py-1.5 text-xs hover:bg-surface-raised" onClick={() => onRole(role === 'audience' ? 'speaker' : 'audience')}>
      {role === 'audience' ? 'На сцену' : 'В слушатели'}
    </button>}
  </div>
}

export function StageChannelView({ channel }: { channel: Channel }) {
  const server = useStore((state) => state.currentServer)
  const user = useAuthStore((state) => state.user)
  const { can, isLoaded: permissionsLoaded } = useServerPermissions(server?.id)
  const { participants, currentVoiceChannelId, isConnected, isConnecting, connectToVoiceChannel, disconnectFromVoiceChannel, updateParticipant } = useVoiceStore()
  const [stage, setStage] = useState<StageInstance | null>(null)
  const [requests, setRequests] = useState<StageRequest[]>([])
  const [previewParticipants, setPreviewParticipants] = useState<VoiceUser[]>([])
  const [topic, setTopic] = useState('')
  const [requested, setRequested] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const connectedHere = currentVoiceChannelId === channel.id && isConnected
  const self = participants.find((item) => item.user_id === user?.id)
  useEffect(() => { setRequested(Boolean(self?.requested_to_speak_at)) }, [self?.requested_to_speak_at])
  const canManage = can(Permissions.MANAGE_CHANNELS) || can(Permissions.MUTE_MEMBERS) || self?.stage_role === 'moderator'
  const refresh = useCallback(async () => {
    const next = await stageService.get(channel.id)
    setStage(next)
    setPreviewParticipants(await channelService.getVoiceChannelMembers(channel.id) as unknown as VoiceUser[])
    if (next && canManage) setRequests(await stageService.requests(channel.id).catch(() => []))
  }, [canManage, channel.id])

  useEffect(() => { void refresh().catch((value) => setError(errorText(value))) }, [refresh])
  useEffect(() => {
    const handler = (payload: any) => {
      const data = payload?.data ?? payload
      if (Number(data?.channel_id) !== channel.id) return
      if (data.user_id && data.stage_role) {
        const participant = participants.find((item) => item.user_id === Number(data.user_id))
        if (participant) updateParticipant({ ...participant, stage_role: data.stage_role, stage_suppressed: data.stage_suppressed })
        if (Number(data.user_id) === user?.id && connectedHere) {
          disconnectFromVoiceChannel()
          window.setTimeout(() => void connectToVoiceChannel(channel.id), 120)
        }
      }
      void refresh()
    }
    const events = ['STAGE_INSTANCE_CREATE', 'STAGE_INSTANCE_UPDATE', 'STAGE_INSTANCE_DELETE', 'STAGE_REQUEST_CREATE', 'STAGE_REQUEST_DELETE', 'STAGE_PARTICIPANT_UPDATE']
    events.forEach((event) => unifiedWebSocketService.on(event, handler))
    const ended = (payload: any) => {
      const data = payload?.data ?? payload
      if (Number(data?.channel_id) === channel.id && connectedHere) disconnectFromVoiceChannel()
    }
    unifiedWebSocketService.on('STAGE_INSTANCE_DELETE', ended)
    return () => {
      events.forEach((event) => unifiedWebSocketService.off(event, handler))
      unifiedWebSocketService.off('STAGE_INSTANCE_DELETE', ended)
    }
  }, [channel.id, connectToVoiceChannel, connectedHere, disconnectFromVoiceChannel, participants, refresh, updateParticipant, user?.id])

  const visibleParticipants = connectedHere ? participants : previewParticipants
  const groups = useMemo(() => ({
    speakers: visibleParticipants.filter((item) => item.stage_role === 'speaker' || item.stage_role === 'moderator'),
    audience: visibleParticipants.filter((item) => !item.stage_role || item.stage_role === 'audience'),
  }), [visibleParticipants])
  const run = async (action: () => Promise<void>) => {
    setBusy(true); setError('')
    try { await action(); await refresh() } catch (value) { setError(errorText(value)) } finally { setBusy(false) }
  }

  if (!stage) return <main className="flex min-w-0 flex-1 items-center justify-center bg-background p-5">
    <section className="w-full max-w-lg rounded-2xl border border-border bg-surface p-6 text-center shadow-lg">
      <Radio className="mx-auto h-10 w-10 text-primary" />
      <h1 className="mt-4 text-2xl font-bold">{channel.name}</h1>
      <p className="mt-2 text-sm text-text-muted">Сцена пока не запущена.</p>
      {!permissionsLoaded && <p className="mt-4 text-sm text-text-quiet">Проверяем права доступа…</p>}
      {permissionsLoaded && canManage && <form className="mt-5 flex flex-col gap-2 sm:flex-row" onSubmit={(event) => { event.preventDefault(); void run(async () => {
        await stageService.create(channel.id, topic)
        setTopic('')
        await connectToVoiceChannel(channel.id)
      }) }}>
        <input value={topic} onChange={(event) => setTopic(event.target.value)} maxLength={120} required className="min-w-0 flex-1 rounded-lg border border-border bg-input px-3 py-2.5" placeholder="Тема сцены" />
        <button disabled={busy} className="rounded-lg bg-primary px-4 py-2.5 font-semibold text-primary-foreground">{busy ? 'Запускаем…' : 'Запустить Stage и войти'}</button>
      </form>}
      {permissionsLoaded && !canManage && <p className="mt-4 text-sm text-text-muted">Сцена ещё не началась. Подключение станет доступно после запуска модератором.</p>}
      {error && <p className="mt-3 text-sm text-red-300" role="alert">{error}</p>}
    </section>
  </main>

  return <main className="flex min-w-0 flex-1 flex-col overflow-hidden bg-background">
    <header className="border-b border-border px-5 py-4 sm:px-8">
      <div className="mx-auto flex max-w-5xl items-center gap-4">
        <span className="rounded-xl bg-primary/15 p-3 text-primary"><Radio /></span>
        <div className="min-w-0 flex-1"><p className="text-xs font-bold uppercase tracking-wider text-text-quiet">Сцена · {channel.name}</p><h1 className="truncate text-xl font-bold">{stage.topic}</h1></div>
        {canManage && <button type="button" onClick={() => void run(async () => { await stageService.end(channel.id); if (connectedHere) disconnectFromVoiceChannel() })} className="rounded-lg border border-red-400/30 px-3 py-2 text-sm text-red-300 hover:bg-red-500/10"><Square className="mr-1.5 inline h-4 w-4" />Завершить</button>}
      </div>
    </header>
    <div className="min-h-0 flex-1 overflow-y-auto p-5 sm:p-8"><div className="mx-auto grid max-w-5xl gap-6 lg:grid-cols-[1fr_320px]">
      <section className="rounded-xl border border-border bg-surface p-4"><h2 className="mb-3 flex items-center gap-2 font-bold"><Mic2 className="h-4 w-4" />На сцене · {groups.speakers.length}</h2>{groups.speakers.length ? groups.speakers.map((item) => <Participant key={item.user_id} participant={item} canModerate={canManage && item.user_id !== user?.id} onRole={(role) => void run(() => stageService.setRole(channel.id, item.user_id, role))} />) : <p className="px-3 py-5 text-sm text-text-muted">Выступающих пока нет.</p>}</section>
      <aside className="space-y-5"><section className="rounded-xl border border-border bg-surface p-4"><h2 className="mb-3 flex items-center gap-2 font-bold"><Users className="h-4 w-4" />Слушатели · {groups.audience.length}</h2>{groups.audience.map((item) => <Participant key={item.user_id} participant={item} canModerate={canManage} onRole={(role) => void run(() => stageService.setRole(channel.id, item.user_id, role))} />)}</section>
      {canManage && requests.length > 0 && <section className="rounded-xl border border-primary/30 bg-primary/5 p-4"><h2 className="mb-3 font-bold">Хотят выступить · {requests.length}</h2>{requests.map((item) => <button key={item.user_id} type="button" onClick={() => void run(() => stageService.setRole(channel.id, item.user_id, 'speaker'))} className="flex w-full items-center gap-3 rounded-lg p-2 text-left hover:bg-surface-hover"><UserAvatar user={item.user} size={34} /><span className="min-w-0 flex-1 truncate text-sm font-semibold">{item.user.display_name || item.user.username}</span><span className="text-xs text-primary">Разрешить</span></button>)}</section>}</aside>
    </div></div>
    <footer className="border-t border-border bg-surface px-5 py-3"><div className="mx-auto flex max-w-5xl items-center justify-between gap-3"><p className="text-sm text-text-muted">{connectedHere ? self?.stage_role === 'audience' ? 'Вы слушаете сцену' : 'Вы на сцене' : 'Подключитесь, чтобы слушать'}</p><div className="flex gap-2">{connectedHere && self?.stage_role === 'audience' && stage.request_to_speak_enabled && <button disabled={busy} onClick={() => void run(async () => { requested ? await stageService.cancelRequest(channel.id) : await stageService.requestToSpeak(channel.id); setRequested(!requested) })} className="rounded-lg border border-border px-3 py-2 text-sm font-semibold hover:bg-surface-hover"><Hand className="mr-1.5 inline h-4 w-4" />{requested ? 'Отменить запрос' : 'Поднять руку'}</button>}<button disabled={busy || isConnecting} onClick={() => connectedHere ? disconnectFromVoiceChannel() : void connectToVoiceChannel(channel.id)} className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground">{connectedHere ? 'Отключиться' : 'Присоединиться'}</button></div></div>{error && <p className="mx-auto mt-2 max-w-5xl text-sm text-red-300" role="alert">{error}</p>}</footer>
  </main>
}
