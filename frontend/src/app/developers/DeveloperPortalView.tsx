'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  Bot,
  Check,
  Copy,
  KeyRound,
  Send,
  Plus,
  RefreshCw,
  Save,
  ShieldCheck,
  Trash2,
  X,
} from 'lucide-react';

import botService from '../../services/botService';
import authService from '../../services/authService';
import { useAuthStore } from '../../store/store';
import { Permissions, permissionBitfield } from '../../lib/permissions';
import { DeveloperBotSettings } from '../../components/developers/DeveloperBotSettings';
import type {
  BotApplication,
  BotCommand,
  BotCommandPayload,
  BotCommandDispatchPayload,
  BotCommandDispatchResponse,
} from '../../types/bot';

export function DeveloperPortalView({ model }: { model: any }) {
  const {
    mounted, setMounted, authChecked, setAuthChecked, applications, setApplications,
    selectedId, setSelectedId, loading, setLoading, saving, setSaving,
    error, setError, createOpen, setCreateOpen, createName, setCreateName,
    createDescription, setCreateDescription, editName, setEditName, editDescription, setEditDescription,
    oneTimeToken, setOneTimeToken, oneTimeClientSecret, setOneTimeClientSecret, editBotPublic, setEditBotPublic,
    editRequireCodeGrant, setEditRequireCodeGrant, editGuildInstall, setEditGuildInstall, editUserInstall, setEditUserInstall,
    editRedirectUris, setEditRedirectUris, editInteractionsEndpoint, setEditInteractionsEndpoint, editEventWebhooksEndpoint, setEditEventWebhooksEndpoint,
    editEventWebhooksEnabled, setEditEventWebhooksEnabled, editEventWebhookTypes, setEditEventWebhookTypes, editTermsUrl, setEditTermsUrl,
    editPrivacyUrl, setEditPrivacyUrl, editFlags, setEditFlags, editInstallPermissions, setEditInstallPermissions,
    activeSection, setActiveSection, mediaBusy, setMediaBusy, inviteCopied, setInviteCopied,
    copied, setCopied, dispatchToken, setDispatchToken, dispatchPayload, setDispatchPayload,
    dispatchResponse, setDispatchResponse, dispatchBusy, setDispatchBusy, dispatchError, setDispatchError,
    dispatchCopied, setDispatchCopied, commands, setCommands, commandsLoading, setCommandsLoading,
    commandsError, setCommandsError, creatingCommand, setCreatingCommand, editingCommandId, setEditingCommandId,
    commandServerId, setCommandServerId, commandName, setCommandName, commandDescription, setCommandDescription,
    commandType, setCommandType, commandResponseContent, setCommandResponseContent, commandDefaultMemberPermissions, setCommandDefaultMemberPermissions,
    commandDmPermission, setCommandDmPermission, commandAllowedUsers, setCommandAllowedUsers, commandAllowedRoles, setCommandAllowedRoles,
    commandOptionsJson, setCommandOptionsJson, commandNameLocalizationsJson, setCommandNameLocalizationsJson, commandDescriptionLocalizationsJson, setCommandDescriptionLocalizationsJson,
    commandContexts, setCommandContexts, commandIntegrationTypes, setCommandIntegrationTypes, commandNsfw, setCommandNsfw,
    commandHandler, setCommandHandler, router, initializedApplicationId, user, selected,
    botSettingsDirty, normalizeIdList, appFlagEnabled, toggleAppFlag, resetCommandForm, createApplication,
    saveApplication, resetToken, copyInviteLink, replaceApplication, uploadBotMedia, deleteBotMedia,
    disableApplication, copyToken, startCreateCommand, startEditCommand, submitCommand, deleteCommand,
    syncCommands, resetClientSecret, testDispatch, copyDispatchCurl
  } = model
  return (
    <main className="developer-portal min-h-[100dvh] bg-[#1e1f22] text-[#f2f3f5]">
      <header className="developer-portal__header sticky top-0 z-20 flex min-h-14 items-center gap-3 border-b border-white/10 bg-[#1e1f22]/95 px-4 backdrop-blur md:px-7">
        <button onClick={() => router.push('/app')} className="grid h-11 w-11 place-items-center rounded-xl text-[#b5bac1] hover:bg-white/10 hover:text-white" aria-label="Вернуться в Miscord">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="grid h-10 w-10 place-items-center rounded-xl bg-[#5865f2] shadow-lg shadow-[#5865f2]/20">
          <Bot className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <h1 className="truncate text-base font-bold">Портал разработчиков Miscord</h1>
          <p className="truncate text-xs text-[#949ba4]">Приложения, боты и команды</p>
        </div>
        {applications.length > 0 && (
          <select
            value={selectedId ?? ''}
            onChange={(event) => setSelectedId(Number(event.target.value))}
            className="ml-2 hidden min-h-9 max-w-60 rounded-md border border-white/10 bg-[#2b2d31] px-3 text-sm font-semibold outline-none focus:border-[#5865f2] md:block"
            aria-label="Выбрать приложение"
          >
            {applications.map((application: BotApplication) => <option key={application.id} value={application.id}>{application.name}</option>)}
          </select>
        )}
        <div className="ml-auto hidden items-center gap-1 sm:flex">
          <button onClick={() => setCreateOpen(true)} className="inline-flex min-h-9 items-center gap-2 rounded-md bg-[#2b2d31] px-3 text-sm font-semibold hover:bg-[#35373c]"><Plus className="h-4 w-4" /> Создать</button>
          <button onClick={() => setActiveSection('bot')} className={`min-h-9 rounded-md px-3 text-sm font-semibold hover:bg-white/5 ${activeSection === 'bot' ? 'text-white' : 'text-[#b5bac1]'}`}>Бот</button>
          <button onClick={() => setActiveSection('advanced')} className={`min-h-9 rounded-md px-3 text-sm font-semibold hover:bg-white/5 ${activeSection === 'advanced' ? 'text-white' : 'text-[#b5bac1]'}`}>Расширенные настройки</button>
        </div>
      </header>

      <div className="mx-auto w-full max-w-[1600px] p-4 md:px-12 md:py-7">
        <aside className="mb-4 border border-white/10 bg-[#2b2d31] p-3 md:hidden">
          <div className="mb-3 flex items-center justify-between px-2">
            <span className="text-xs font-bold uppercase tracking-wider text-[#949ba4]">Мои приложения</span>
            <button onClick={() => setCreateOpen(true)} className="grid h-10 w-10 place-items-center rounded-xl bg-[#5865f2] hover:bg-[#4752c4]" aria-label="Новое приложение">
              <Plus className="h-5 w-5" />
            </button>
          </div>
          <div className="flex gap-2 overflow-x-auto pb-1 md:block md:space-y-1 md:overflow-visible">
            {applications.map((application: BotApplication) => (
              <button
                key={application.id}
                onClick={() => setSelectedId(application.id)}
                className={`flex min-w-52 items-center gap-3 rounded-xl px-3 py-3 text-left md:w-full ${selectedId === application.id ? 'bg-[#404249] text-white' : 'text-[#b5bac1] hover:bg-[#35373c]'}`}
              >
                {application.avatar_url ? (
                  <img src={application.avatar_url} alt="" className="h-10 w-10 shrink-0 rounded-full object-cover" />
                ) : (
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[#5865f2] font-bold">{application.name.slice(0, 1).toUpperCase()}</span>
                )}
                <span className="min-w-0">
                  <strong className="block truncate text-sm">{application.name}</strong>
                  <span className="block truncate text-xs text-[#949ba4]">{application.client_id}</span>
                </span>
              </button>
            ))}
          </div>
          {!loading && applications.length === 0 && (
            <div className="rounded-xl border border-dashed border-white/15 px-4 py-8 text-center text-sm text-[#949ba4]">
              Создайте первое приложение, чтобы получить bot identity и токен.
            </div>
          )}
          {selected && (
            <nav className="mt-4 border-t border-white/10 pt-3" aria-label="Разделы приложения">
              <button type="button" onClick={() => setActiveSection('bot')} className={`flex min-h-10 w-full items-center gap-2 rounded-md px-3 text-left text-sm font-semibold ${activeSection === 'bot' ? 'bg-[#404249] text-white' : 'text-[#b5bac1] hover:bg-[#35373c]'}`}><Bot className="h-4 w-4" /> Бот</button>
              <button type="button" onClick={() => setActiveSection('advanced')} className={`mt-1 flex min-h-10 w-full items-center gap-2 rounded-md px-3 text-left text-sm font-semibold ${activeSection === 'advanced' ? 'bg-[#404249] text-white' : 'text-[#b5bac1] hover:bg-[#35373c]'}`}><ShieldCheck className="h-4 w-4" /> Расширенные настройки</button>
            </nav>
          )}
        </aside>

        <section className="min-w-0">
          {error && (
            <div role="alert" className="mb-4 flex items-start justify-between rounded-xl border border-[#da373c]/40 bg-[#da373c]/10 px-4 py-3 text-sm text-[#ffb8bb]">
              <span>{error}</span>
              <button onClick={() => setError(null)} aria-label="Закрыть ошибку"><X className="h-4 w-4" /></button>
            </div>
          )}

          {loading ? (
            <div className="rounded-2xl border border-white/10 bg-[#2b2d31] p-8 text-[#949ba4]">Загрузка приложений...</div>
          ) : selected ? (
            <>
              {activeSection === 'bot' ? (
                <DeveloperBotSettings
                  application={selected}
                  name={editName}
                  onNameChange={setEditName}
                  botPublic={editBotPublic}
                  onBotPublicChange={setEditBotPublic}
                  requireCodeGrant={editRequireCodeGrant}
                  onRequireCodeGrantChange={setEditRequireCodeGrant}
                  flags={editFlags}
                  onFlagChange={toggleAppFlag}
                  permissions={editInstallPermissions}
                  onPermissionsChange={setEditInstallPermissions}
                  saving={saving}
                  dirty={botSettingsDirty}
                  mediaBusy={mediaBusy}
                  inviteCopied={inviteCopied}
                  onSave={saveApplication}
                  onResetToken={resetToken}
                  onCopyInvite={copyInviteLink}
                  onUploadMedia={uploadBotMedia}
                  onDeleteMedia={deleteBotMedia}
                />
              ) : (
            <div className="space-y-5">
              <div className="overflow-hidden rounded-2xl border border-white/10 bg-[#2b2d31]">
                <div className="border-b border-white/10 bg-[radial-gradient(circle_at_top_right,_rgba(88,101,242,.28),_transparent_42%)] p-6 md:p-8">
                  <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
                    <div className="grid h-20 w-20 shrink-0 place-items-center rounded-3xl bg-[#5865f2] text-3xl font-black shadow-xl shadow-black/20">{selected.name.slice(0, 1).toUpperCase()}</div>
                    <div className="min-w-0">
                      <span className="mb-2 inline-flex items-center gap-1.5 rounded-full bg-[#23a55a]/15 px-2.5 py-1 text-xs font-bold text-[#53d487]"><ShieldCheck className="h-3.5 w-3.5" /> BOT APPLICATION</span>
                      <h2 className="truncate text-2xl font-black md:text-3xl">{selected.name}</h2>
                      <p className="mt-1 font-mono text-xs text-[#949ba4]">Application ID: {selected.client_id}</p>
                    </div>
                  </div>
                </div>

                <div className="grid gap-5 p-5 md:p-8">
                  <label className="grid gap-2">
                    <span className="text-xs font-bold uppercase tracking-wide text-[#b5bac1]">Название</span>
                    <input value={editName} maxLength={80} onChange={(event) => setEditName(event.target.value)} className="min-h-11 rounded-xl border border-white/10 bg-[#1e1f22] px-3.5 text-base outline-none focus:border-[#5865f2]" />
                  </label>
                  <label className="grid gap-2">
                    <span className="text-xs font-bold uppercase tracking-wide text-[#b5bac1]">Описание</span>
                    <textarea value={editDescription} maxLength={400} rows={4} onChange={(event) => setEditDescription(event.target.value)} className="resize-y rounded-xl border border-white/10 bg-[#1e1f22] p-3.5 text-base outline-none focus:border-[#5865f2]" placeholder="Что делает это приложение?" />
                    <span className="text-right text-xs text-[#949ba4]">{editDescription.length}/400</span>
                  </label>
                  <div className="flex justify-end">
                    <button disabled={saving || !editName.trim()} onClick={saveApplication} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-[#5865f2] px-5 text-sm font-bold hover:bg-[#4752c4] disabled:opacity-50"><Save className="h-4 w-4" /> Сохранить</button>
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-white/10 bg-[#2b2d31] p-5 md:p-8">
                <div className="mb-5">
                  <h3 className="text-lg font-bold">OAuth2 и Bot</h3>
                  <p className="mt-1 text-sm text-[#949ba4]">Redirect URI, Interactions Endpoint URL и привилегированные Gateway Intents доступны в Miscord API v1.</p>
                </div>
                <div className="grid gap-4 lg:grid-cols-2">
                  <label className="grid gap-2 lg:col-span-2">
                    <span className="text-xs font-bold uppercase tracking-wide text-[#b5bac1]">Redirect URIs — по одному в строке</span>
                    <textarea value={editRedirectUris} rows={3} onChange={(event) => setEditRedirectUris(event.target.value)} className="rounded-xl border border-white/10 bg-[#1e1f22] p-3.5 font-mono text-sm outline-none focus:border-[#5865f2]" placeholder="https://example.com/oauth/callback" />
                  </label>
                  <label className="grid gap-2 lg:col-span-2">
                    <span className="text-xs font-bold uppercase tracking-wide text-[#b5bac1]">Interactions Endpoint URL</span>
                    <input value={editInteractionsEndpoint} onChange={(event) => setEditInteractionsEndpoint(event.target.value)} className="min-h-11 rounded-xl border border-white/10 bg-[#1e1f22] px-3.5 font-mono text-sm outline-none focus:border-[#5865f2]" placeholder="https://example.com/interactions" />
                    <span className="text-xs text-[#949ba4]">При сохранении Miscord отправит подписанный PING и примет URL только после валидного PONG.</span>
                  </label>
                  <label className="grid gap-2 lg:col-span-2">
                    <span className="text-xs font-bold uppercase tracking-wide text-[#b5bac1]">Event Webhooks URL</span>
                    <input value={editEventWebhooksEndpoint} onChange={(event) => setEditEventWebhooksEndpoint(event.target.value)} className="min-h-11 rounded-xl border border-white/10 bg-[#1e1f22] px-3.5 font-mono text-sm outline-none focus:border-[#5865f2]" placeholder="https://example.com/events" />
                    <span className="text-xs text-[#949ba4]">При сохранении Miscord отправит подписанный PING. Endpoint должен ответить пустым HTTP 204.</span>
                  </label>
                  <label className="grid gap-2"><span className="text-xs font-bold uppercase tracking-wide text-[#b5bac1]">Terms of Service URL</span><input value={editTermsUrl} onChange={(event) => setEditTermsUrl(event.target.value)} className="min-h-11 rounded-xl border border-white/10 bg-[#1e1f22] px-3.5 text-sm outline-none focus:border-[#5865f2]" /></label>
                  <label className="grid gap-2"><span className="text-xs font-bold uppercase tracking-wide text-[#b5bac1]">Privacy Policy URL</span><input value={editPrivacyUrl} onChange={(event) => setEditPrivacyUrl(event.target.value)} className="min-h-11 rounded-xl border border-white/10 bg-[#1e1f22] px-3.5 text-sm outline-none focus:border-[#5865f2]" /></label>
                </div>
                <div className="mt-5 grid gap-3 lg:grid-cols-2">
                  <label className="flex items-start gap-3 rounded-xl border border-white/10 bg-[#1e1f22] p-4 lg:col-span-2"><input type="checkbox" className="mt-1" checked={editEventWebhooksEnabled} onChange={(event) => setEditEventWebhooksEnabled(event.target.checked)} disabled={!editEventWebhooksEndpoint.trim()} /><span><strong className="block text-sm">Включить события по HTTP</strong><span className="text-xs text-[#949ba4]">Подписанные события повторно доставляются до 10 минут, если endpoint не отвечает HTTP 204.</span></span></label>
                  {[
                    ['APPLICATION_AUTHORIZED', 'Приложение авторизовано'],
                    ['APPLICATION_DEAUTHORIZED', 'Приложение деавторизовано'],
                  ].map(([eventType, title]) => (
                    <label key={eventType} className="flex items-start gap-3 rounded-xl border border-white/10 bg-[#1e1f22] p-4"><input type="checkbox" className="mt-1" checked={editEventWebhookTypes.includes(eventType)} disabled={!editEventWebhooksEnabled} onChange={(event) => setEditEventWebhookTypes((current: string[]) => event.target.checked ? (current.includes(eventType) ? current : [...current, eventType]) : current.filter((item: string) => item !== eventType))} /><span><strong className="block text-sm">{title}</strong><span className="font-mono text-[11px] text-[#949ba4]">{eventType}</span></span></label>
                  ))}
                  <label className="flex items-start gap-3 rounded-xl border border-white/10 bg-[#1e1f22] p-4"><input type="checkbox" className="mt-1" checked={editBotPublic} onChange={(event) => setEditBotPublic(event.target.checked)} /><span><strong className="block text-sm">Public Bot</strong><span className="text-xs text-[#949ba4]">Другие пользователи могут устанавливать бота.</span></span></label>
                  <label className="flex items-start gap-3 rounded-xl border border-white/10 bg-[#1e1f22] p-4"><input type="checkbox" className="mt-1" checked={editRequireCodeGrant} onChange={(event) => setEditRequireCodeGrant(event.target.checked)} /><span><strong className="block text-sm">Requires OAuth2 Code Grant</strong><span className="text-xs text-[#949ba4]">Установка требует authorization code flow.</span></span></label>
                  <label className="flex items-start gap-3 rounded-xl border border-white/10 bg-[#1e1f22] p-4"><input type="checkbox" className="mt-1" checked={editGuildInstall} onChange={(event) => setEditGuildInstall(event.target.checked)} disabled={!editUserInstall} /><span><strong className="block text-sm">Установка на сервер</strong><span className="text-xs text-[#949ba4]">Приложение можно добавить на сервер с выбранными правами.</span></span></label>
                  <label className="flex items-start gap-3 rounded-xl border border-white/10 bg-[#1e1f22] p-4"><input type="checkbox" className="mt-1" checked={editUserInstall} onChange={(event) => setEditUserInstall(event.target.checked)} disabled={!editGuildInstall} /><span><strong className="block text-sm">Установка пользователю</strong><span className="text-xs text-[#949ba4]">Команды приложения будут доступны установившему пользователю.</span></span></label>
                  {[
                    [1 << 12, 'Presence Intent', 'Получать presence updates участников.'],
                    [1 << 14, 'Server Members Intent', 'Получать список и события участников.'],
                    [1 << 18, 'Message Content Intent', 'Получать содержимое сообщений.'],
                  ].map(([flag, title, description]) => (
                    <label key={String(flag)} className="flex items-start gap-3 rounded-xl border border-white/10 bg-[#1e1f22] p-4"><input type="checkbox" className="mt-1" checked={appFlagEnabled(Number(flag))} onChange={(event) => toggleAppFlag(Number(flag), event.target.checked)} /><span><strong className="block text-sm">{title}</strong><span className="text-xs text-[#949ba4]">{description}</span></span></label>
                  ))}
                </div>
                <div className="mt-5 flex justify-end"><button disabled={saving || !editName.trim()} onClick={saveApplication} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-[#5865f2] px-5 text-sm font-bold hover:bg-[#4752c4] disabled:opacity-50"><Save className="h-4 w-4" /> Сохранить настройки</button></div>
              </div>

              <div className="grid gap-5 lg:grid-cols-2">
                <div className="rounded-2xl border border-white/10 bg-[#2b2d31] p-5 md:p-6">
                  <div className="mb-4 flex items-center gap-3"><KeyRound className="h-5 w-5 text-[#f0b232]" /><h3 className="font-bold">Bot Token</h3></div>
                  <p className="mb-5 text-sm leading-6 text-[#b5bac1]">Токен нельзя получить повторно. Если он потерян или раскрыт, создайте новый. Старый будет отозван немедленно.</p>
                  <button disabled={saving || selected.status !== 'active'} onClick={resetToken} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-[#4e5058] px-4 text-sm font-bold hover:bg-[#5d6069] disabled:opacity-50"><RefreshCw className="h-4 w-4" /> Сбросить токен</button>
                </div>
                <div className="rounded-2xl border border-white/10 bg-[#2b2d31] p-5 md:p-6">
                  <div className="mb-3 flex items-center gap-3"><Bot className="h-5 w-5 text-[#5865f2]" /><h3 className="font-bold">Установка на сервер</h3></div>
                  <p className="mb-5 text-sm leading-6 text-[#b5bac1]">Ссылка открывает безопасный экран авторизации с выбором сервера и запрашиваемыми правами.</p>
                  <button disabled={selected.status !== 'active'} onClick={copyInviteLink} className="inline-flex min-h-11 items-center rounded-xl bg-[#5865f2] px-4 text-sm font-bold hover:bg-[#4752c4] disabled:opacity-50">Копировать invite-link</button>
                </div>
                <div className="rounded-2xl border border-white/10 bg-[#2b2d31] p-5 md:p-6">
                  <div className="mb-3 flex items-center gap-3"><ShieldCheck className="h-5 w-5 text-[#53d487]" /><h3 className="font-bold">Public Key</h3></div>
                  <p className="mb-3 text-sm text-[#b5bac1]">Ed25519-ключ для проверки подписей Miscord.</p>
                  <code className="block break-all rounded-xl bg-[#1e1f22] p-3 font-mono text-xs text-[#dbdee1]">{selected.public_key}</code>
                </div>
              </div>

                <div className="rounded-2xl border border-white/10 bg-[#2b2d31] p-5 md:p-6">
                  <div className="mb-3 flex items-center gap-3"><Send className="h-5 w-5 text-[#23a55a]" /><h3 className="font-bold">Test command runtime</h3></div>
                  <p className="mb-4 text-sm leading-6 text-[#b5bac1]">Отправьте тестовый dispatch event для проверки runtime API через bot token.</p>
                  <label className="mb-3 grid gap-2">
                    <span className="text-xs font-bold uppercase tracking-wide text-[#b5bac1]">Bot token</span>
                    <input
                      value={dispatchToken}
                      onChange={(event) => setDispatchToken(event.target.value)}
                      className="min-h-11 rounded-xl border border-white/10 bg-[#1e1f22] px-3.5 text-base outline-none focus:border-[#5865f2]"
                      placeholder="mcb_... . . ."
                    />
                  </label>
                  <label className="grid gap-2">
                    <span className="text-xs font-bold uppercase tracking-wide text-[#b5bac1]">Payload JSON</span>
                    <textarea
                      rows={8}
                      value={dispatchPayload}
                      onChange={(event) => setDispatchPayload(event.target.value)}
                      className="rounded-xl border border-white/10 bg-[#1e1f22] p-3.5 font-mono text-sm text-[#dbdee1] outline-none focus:border-[#5865f2]"
                    />
                  </label>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      onClick={testDispatch}
                      disabled={dispatchBusy || !dispatchToken.trim()}
                      className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-[#5865f2] px-4 text-sm font-bold hover:bg-[#4752c4] disabled:opacity-50"
                    >
                      <Send className="h-4 w-4" />
                      {dispatchBusy ? 'Отправляется...' : 'Отправить тест'}
                    </button>
                    <button
                      onClick={copyDispatchCurl}
                      disabled={!dispatchToken.trim()}
                      className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-[#5865f2]/30 px-4 text-sm font-bold text-[#b5bac1] hover:bg-white/10 disabled:opacity-50"
                    >
                      {dispatchCopied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                      {dispatchCopied ? 'Копировано' : 'Copy curl'}
                    </button>
                  </div>
                  {dispatchError && (
                    <div className="mt-3 rounded-xl border border-[#da373c]/40 bg-[#da373c]/12 px-3 py-2 text-sm text-[#ffb8bb]">
                      {dispatchError}
                    </div>
                  )}
                  {dispatchResponse && (
                    <div className="mt-3 rounded-xl border border-[#5865f2]/20 bg-[#1e1f22] p-3">
                      <p className="mb-2 text-xs font-bold text-[#b5bac1]">Latest response</p>
                      <code className="block whitespace-pre-wrap break-all text-xs text-[#dbdee1]">
                        {JSON.stringify(dispatchResponse, null, 2)}
                      </code>
                    </div>
                  )}
                </div>
                <div className="rounded-2xl border border-white/10 bg-[#2b2d31] p-5 md:p-6">
                  <div className="mb-4 flex items-center gap-3"><KeyRound className="h-5 w-5 text-[#53d487]" /><h3 className="font-bold">OAuth2 Client Secret</h3></div>
                  <p className="mb-5 text-sm leading-6 text-[#b5bac1]">Client secret используется серверными OAuth2 flows и показывается только после создания или сброса.</p>
                  <button disabled={saving || selected.status !== 'active'} onClick={resetClientSecret} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-[#4e5058] px-4 text-sm font-bold hover:bg-[#5d6069] disabled:opacity-50"><RefreshCw className="h-4 w-4" /> Сбросить client secret</button>
                </div>

                <div className="rounded-2xl border border-white/10 bg-[#2b2d31] p-5 md:p-6">
                  <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-3"><Bot className="h-5 w-5 text-[#5865f2]" /><h3 className="font-bold">Slash commands</h3></div>
                    <div className="flex gap-2">
                      <button onClick={startCreateCommand} className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-[#5865f2] px-4 text-sm font-bold hover:bg-[#4752c4]">Create</button>
                      <button onClick={syncCommands} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-[#5865f2]/40 px-4 text-sm font-bold text-[#b5bac1] hover:bg-white/10">Sync</button>
                    </div>
                  </div>

                  {commandsError && (
                    <div className="mb-4 rounded-xl border border-[#da373c]/40 bg-[#da373c]/12 px-4 py-3 text-sm text-[#ffb8bb]">
                      {commandsError}
                    </div>
                  )}

                  <div className="mb-5 flex flex-col gap-3">
                    {commandsLoading ? (
                      <div className="rounded-xl border border-white/10 bg-[#1e1f22] px-4 py-3 text-sm text-[#949ba4]">Loading commands...</div>
                    ) : commands.length === 0 ? (
                      <div className="rounded-xl border border-dashed border-white/10 bg-[#1e1f22] px-4 py-6 text-sm text-[#949ba4]">No commands yet.</div>
                    ) : (
                      commands.map((command: BotCommand) => (
                        <button
                          key={command.id}
                          type="button"
                          onClick={() => startEditCommand(command)}
                          className={`rounded-xl border px-4 py-3 text-left ${editingCommandId === command.id ? 'border-[#5865f2] bg-[#1f2230]' : 'border-white/15 bg-[#1e1f22]'}`}
                        >
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <div className="font-bold">/{command.name}</div>
                              <div className="text-xs text-[#949ba4]">{command.description}</div>
                            </div>
                            <button
                              type="button"
                              className="rounded-lg border border-[#da373c]/40 px-3 py-1.5 text-xs font-bold text-[#ffb8bb]"
                              onClick={(event) => {
                                event.stopPropagation();
                                void deleteCommand(command);
                              }}
                            >
                              Delete
                            </button>
                          </div>
                        </button>
                      ))
                    )}
                  </div>

                  {(creatingCommand || editingCommandId !== null) && (
                    <div className="grid gap-3">
                      <div className="grid gap-2">
                        <label className="text-xs font-bold uppercase tracking-wide text-[#b5bac1]">Command name</label>
                        <input value={commandName} onChange={(event) => setCommandName(event.target.value)} className="min-h-11 rounded-xl border border-white/10 bg-[#1e1f22] px-3.5 text-base outline-none focus:border-[#5865f2]" placeholder="ping" />
                      </div>
                      <div className="grid gap-2">
                        <label className="text-xs font-bold uppercase tracking-wide text-[#b5bac1]">Description</label>
                        <input value={commandDescription} maxLength={100} onChange={(event) => setCommandDescription(event.target.value)} className="min-h-11 rounded-xl border border-white/10 bg-[#1e1f22] px-3.5 text-base outline-none focus:border-[#5865f2]" placeholder="Pong!" />
                      </div>
                      <div className="grid gap-2">
                        <label className="text-xs font-bold uppercase tracking-wide text-[#b5bac1]">Command type</label>
                        <select value={commandType} onChange={(event) => setCommandType(event.target.value)} className="min-h-11 rounded-xl border border-white/10 bg-[#1e1f22] px-3.5 text-base outline-none focus:border-[#5865f2]">
                          <option value="1">Chat Input / slash (1)</option>
                          <option value="2">User context menu (2)</option>
                          <option value="3">Message context menu (3)</option>
                          <option value="4">Primary Entry Point (4)</option>
                        </select>
                      </div>
                      {commandType === '4' && (
                        <label className="grid gap-2"><span className="text-xs font-bold uppercase tracking-wide text-[#b5bac1]">Entry Point handler</span><select value={commandHandler} onChange={(event) => setCommandHandler(event.target.value)} className="min-h-11 rounded-xl border border-white/10 bg-[#1e1f22] px-3.5"><option value="1">Приложение отвечает само (1)</option><option value="2">Miscord запускает Activity (2)</option></select></label>
                      )}
                      <label className="grid gap-2">
                        <span className="text-xs font-bold uppercase tracking-wide text-[#b5bac1]">Server ID (optional)</span>
                        <input value={commandServerId} onChange={(event) => setCommandServerId(event.target.value)} className="min-h-11 rounded-xl border border-white/10 bg-[#1e1f22] px-3.5 text-base outline-none focus:border-[#5865f2]" />
                      </label>
                      <label className="grid gap-2">
                        <span className="text-xs font-bold uppercase tracking-wide text-[#b5bac1]">Default response</span>
                        <textarea value={commandResponseContent} rows={3} onChange={(event) => setCommandResponseContent(event.target.value)} className="rounded-xl border border-white/10 bg-[#1e1f22] p-3.5 text-base outline-none focus:border-[#5865f2]" />
                      </label>
                      <label className="grid gap-2">
                        <span className="text-xs font-bold uppercase tracking-wide text-[#b5bac1]">Options JSON</span>
                        <textarea value={commandOptionsJson} rows={7} onChange={(event) => setCommandOptionsJson(event.target.value)} disabled={commandType !== '1'} className="rounded-xl border border-white/10 bg-[#1e1f22] p-3.5 font-mono text-sm outline-none focus:border-[#5865f2] disabled:opacity-50" />
                        <span className="text-xs text-[#949ba4]">Поддерживаются choices, autocomplete, min/max, channel_types, subcommands и attachment.</span>
                      </label>
                      <div className="grid gap-3 md:grid-cols-2">
                        <label className="grid gap-2"><span className="text-xs font-bold uppercase tracking-wide text-[#b5bac1]">Name localizations JSON</span><textarea value={commandNameLocalizationsJson} rows={4} onChange={(event) => setCommandNameLocalizationsJson(event.target.value)} className="rounded-xl border border-white/10 bg-[#1e1f22] p-3.5 font-mono text-sm outline-none focus:border-[#5865f2]" /></label>
                        <label className="grid gap-2"><span className="text-xs font-bold uppercase tracking-wide text-[#b5bac1]">Description localizations JSON</span><textarea value={commandDescriptionLocalizationsJson} rows={4} onChange={(event) => setCommandDescriptionLocalizationsJson(event.target.value)} disabled={commandType === '2' || commandType === '3'} className="rounded-xl border border-white/10 bg-[#1e1f22] p-3.5 font-mono text-sm outline-none focus:border-[#5865f2] disabled:opacity-50" /></label>
                      </div>
                      <div className="grid gap-3 md:grid-cols-2">
                        <fieldset className="rounded-xl border border-white/10 bg-[#1e1f22] p-4"><legend className="px-1 text-xs font-bold uppercase tracking-wide text-[#b5bac1]">Installation contexts</legend>{[[0, 'Сервер'], [1, 'Пользователь']].map(([value, label]) => <label key={value} className="mt-2 flex items-center gap-2 text-sm"><input type="checkbox" checked={commandIntegrationTypes.includes(Number(value))} onChange={(event) => setCommandIntegrationTypes((current: number[]) => event.target.checked ? (current.includes(Number(value)) ? current : [...current, Number(value)]) : current.filter((item: number) => item !== Number(value)))} />{label}</label>)}</fieldset>
                        <fieldset className="rounded-xl border border-white/10 bg-[#1e1f22] p-4"><legend className="px-1 text-xs font-bold uppercase tracking-wide text-[#b5bac1]">Interaction contexts</legend>{[[0, 'Сервер'], [1, 'ЛС с ботом'], [2, 'Личный канал']].map(([value, label]) => <label key={value} className="mt-2 flex items-center gap-2 text-sm"><input type="checkbox" checked={commandContexts.includes(Number(value))} onChange={(event) => setCommandContexts((current: number[]) => event.target.checked ? (current.includes(Number(value)) ? current : [...current, Number(value)]) : current.filter((item: number) => item !== Number(value)))} />{label}</label>)}</fieldset>
                      </div>
                      <div className="grid gap-2 md:grid-cols-3">
                        <label className="grid gap-2">
                          <span className="text-xs font-bold uppercase tracking-wide text-[#b5bac1]">default_member_permissions</span>
                          <input value={commandDefaultMemberPermissions} onChange={(event) => setCommandDefaultMemberPermissions(event.target.value)} className="min-h-11 rounded-xl border border-white/10 bg-[#1e1f22] px-3.5 text-base outline-none focus:border-[#5865f2]" />
                        </label>
                        <label className="grid gap-2">
                          <span className="text-xs font-bold uppercase tracking-wide text-[#b5bac1]">allowed user ids</span>
                          <input value={commandAllowedUsers} onChange={(event) => setCommandAllowedUsers(event.target.value)} className="min-h-11 rounded-xl border border-white/10 bg-[#1e1f22] px-3.5 text-base outline-none focus:border-[#5865f2]" placeholder="1,2,3" />
                        </label>
                        <label className="grid gap-2">
                          <span className="text-xs font-bold uppercase tracking-wide text-[#b5bac1]">allowed role ids</span>
                          <input value={commandAllowedRoles} onChange={(event) => setCommandAllowedRoles(event.target.value)} className="min-h-11 rounded-xl border border-white/10 bg-[#1e1f22] px-3.5 text-base outline-none focus:border-[#5865f2]" placeholder="4,5,6" />
                        </label>
                      </div>
                      <label className="inline-flex cursor-pointer items-center gap-2 text-sm">
                        <input type="checkbox" checked={commandDmPermission} onChange={(event) => setCommandDmPermission(event.target.checked)} />
                        allow in DMs
                      </label>
                      <label className="inline-flex cursor-pointer items-center gap-2 text-sm"><input type="checkbox" checked={commandNsfw} onChange={(event) => setCommandNsfw(event.target.checked)} />NSFW command</label>
                      <div className="flex gap-2">
                        <button
                          disabled={saving || !commandName.trim()}
                          onClick={submitCommand}
                          className="inline-flex min-h-11 items-center rounded-xl bg-[#5865f2] px-4 text-sm font-bold hover:bg-[#4752c4] disabled:opacity-50"
                        >
                          {editingCommandId === null ? 'Create command' : 'Save changes'}
                        </button>
                        <button
                          onClick={resetCommandForm}
                          className="inline-flex min-h-11 items-center rounded-xl bg-[#4e5058] px-4 text-sm font-bold hover:bg-[#5d6069]"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                <div className="rounded-2xl border border-[#da373c]/30 bg-[#da373c]/5 p-5 md:p-6">
                <h3 className="font-bold text-[#ffb8bb]">Опасная зона</h3>
                <p className="my-3 text-sm text-[#b5bac1]">Отключение отзывает все токены. Bot identity сохраняется для истории и аудита.</p>
                <button disabled={saving} onClick={disableApplication} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-[#da373c]/50 px-4 text-sm font-bold text-[#ffb8bb] hover:bg-[#da373c]/15 disabled:opacity-50"><Trash2 className="h-4 w-4" /> Отключить приложение</button>
              </div>
            </div>
              )}
            </>
          ) : (
            <button onClick={() => setCreateOpen(true)} className="grid min-h-72 w-full place-items-center rounded-2xl border border-dashed border-white/15 bg-[#2b2d31] p-8 text-center hover:border-[#5865f2]/70">
              <span><Plus className="mx-auto mb-3 h-8 w-8 text-[#5865f2]" /><strong className="block">Создать Bot Application</strong><span className="mt-2 block text-sm text-[#949ba4]">Токен будет показан только один раз.</span></span>
            </button>
          )}
        </section>
      </div>

      {createOpen && (
        <div className="fixed inset-0 z-40 grid place-items-center bg-black/70 p-4" role="dialog" aria-modal="true" aria-labelledby="create-bot-title">
          <div className="w-full max-w-lg rounded-2xl border border-white/10 bg-[#2b2d31] p-5 shadow-2xl md:p-6">
            <div className="mb-5 flex items-center justify-between"><h2 id="create-bot-title" className="text-xl font-black">Новое приложение</h2><button onClick={() => setCreateOpen(false)} className="grid h-11 w-11 place-items-center rounded-xl hover:bg-white/10" aria-label="Закрыть"><X className="h-5 w-5" /></button></div>
            <div className="grid gap-4">
              <label className="grid gap-2"><span className="text-xs font-bold uppercase text-[#b5bac1]">Название</span><input autoFocus value={createName} maxLength={80} onChange={(event) => setCreateName(event.target.value)} className="min-h-11 rounded-xl border border-white/10 bg-[#1e1f22] px-3.5 text-base outline-none focus:border-[#5865f2]" /></label>
              <label className="grid gap-2"><span className="text-xs font-bold uppercase text-[#b5bac1]">Описание</span><textarea value={createDescription} maxLength={400} rows={4} onChange={(event) => setCreateDescription(event.target.value)} className="rounded-xl border border-white/10 bg-[#1e1f22] p-3.5 text-base outline-none focus:border-[#5865f2]" /></label>
              <div className="flex justify-end gap-2 pt-2"><button onClick={() => setCreateOpen(false)} className="min-h-11 rounded-xl px-4 text-sm font-bold text-[#b5bac1] hover:bg-white/10">Отмена</button><button disabled={saving || !createName.trim()} onClick={createApplication} className="min-h-11 rounded-xl bg-[#5865f2] px-5 text-sm font-bold hover:bg-[#4752c4] disabled:opacity-50">Создать</button></div>
            </div>
          </div>
        </div>
      )}

      {(oneTimeToken || oneTimeClientSecret) && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/80 p-4" role="dialog" aria-modal="true" aria-labelledby="token-title">
          <div className="w-full max-w-2xl rounded-2xl border border-[#f0b232]/30 bg-[#2b2d31] p-5 shadow-2xl md:p-7">
            <div className="mb-4 flex items-start gap-3"><div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-[#f0b232]/15 text-[#f0b232]"><KeyRound className="h-5 w-5" /></div><div><h2 id="token-title" className="text-xl font-black">Сохраните секреты</h2><p className="mt-1 text-sm text-[#b5bac1]">После закрытия эти значения больше нельзя будет получить.</p></div></div>
            <div className="space-y-3">{oneTimeToken && <div><span className="mb-1 block text-xs font-bold uppercase text-[#b5bac1]">Bot Token</span><code className="block max-h-36 overflow-auto break-all rounded-xl border border-white/10 bg-[#111214] p-4 font-mono text-sm text-[#dbdee1]">{oneTimeToken}</code></div>}{oneTimeClientSecret && <div><span className="mb-1 block text-xs font-bold uppercase text-[#b5bac1]">Client Secret</span><code className="block max-h-36 overflow-auto break-all rounded-xl border border-white/10 bg-[#111214] p-4 font-mono text-sm text-[#dbdee1]">{oneTimeClientSecret}</code></div>}</div>
            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><button onClick={() => { setOneTimeToken(null); setOneTimeClientSecret(null); setCopied(false); }} className="min-h-11 rounded-xl px-4 text-sm font-bold text-[#b5bac1] hover:bg-white/10">Я сохранил секреты</button><button onClick={copyToken} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[#5865f2] px-5 text-sm font-bold hover:bg-[#4752c4]">{copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}{copied ? 'Скопировано' : 'Копировать'}</button></div>
          </div>
        </div>
      )}
    </main>
  );
}
