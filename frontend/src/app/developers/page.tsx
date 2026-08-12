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
import { Permissions } from '../../lib/permissions';
import { DeveloperBotSettings } from '../../components/developers/DeveloperBotSettings';
import { DeveloperPortalView } from './DeveloperPortalView';
import { useDeveloperPortalState } from './useDeveloperPortalState';
import { errorMessage, normalizedPermissionDraft } from './developerUtils';
import type {
  BotApplication,
  BotCommand,
  BotCommandPayload,
  BotCommandDispatchPayload,
  BotCommandDispatchResponse,
} from '../../types/bot';


export default function DeveloperPortalPage() {
  const router = useRouter();
  const initializedApplicationId = useRef<number | null>(null);
  const user = useAuthStore((state) => state.user);
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
    commandHandler, setCommandHandler,
  } = useDeveloperPortalState()

  const selected = useMemo(
    () => applications.find((application) => application.id === selectedId) ?? null,
    [applications, selectedId],
  );

  const botSettingsDirty = useMemo(() => {
    if (!selected) return false;
    const storedPermissions = selected.install_params?.permissions;
    const normalizedStoredPermissions =
      typeof storedPermissions === 'string' || typeof storedPermissions === 'number'
        ? String(storedPermissions)
        : String(Permissions.VIEW_CHANNELS + Permissions.SEND_MESSAGES);
    return editName.trim() !== selected.name
      || editBotPublic !== selected.bot_public
      || editRequireCodeGrant !== selected.bot_require_code_grant
      || editFlags !== (selected.flags || 0)
      || editInstallPermissions !== normalizedStoredPermissions;
  }, [editBotPublic, editFlags, editInstallPermissions, editName, editRequireCodeGrant, selected]);

  const normalizeIdList = (value: string): number[] => value
    .split(',')
    .map((entry) => Number(entry.trim()))
    .filter((entry) => Number.isInteger(entry) && entry > 0);

  const appFlagEnabled = (flag: number) => Math.floor(editFlags / flag) % 2 === 1;
  const toggleAppFlag = (flag: number, enabled: boolean) => {
    const active = appFlagEnabled(flag);
    if (active === enabled) return;
    setEditFlags((current) => current + (enabled ? flag : -flag));
  };

  const resetCommandForm = () => {
    setEditingCommandId(null);
    setCommandServerId('');
    setCommandName('');
    setCommandDescription('');
    setCommandType('1');
    setCommandResponseContent('');
    setCommandDefaultMemberPermissions('');
    setCommandDmPermission(true);
    setCommandAllowedUsers('');
    setCommandAllowedRoles('');
    setCommandOptionsJson('[]');
    setCommandNameLocalizationsJson('{}');
    setCommandDescriptionLocalizationsJson('{}');
    setCommandContexts([0]);
    setCommandIntegrationTypes([0]);
    setCommandNsfw(false);
    setCommandHandler('1');
  };

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!mounted) return;
    let active = true;

    const restoreSession = async () => {
      const authState = useAuthStore.getState();
      try {
        const restored = await authService.restoreSession();
        if (!active) return;
        authState.loginSuccess(restored.user, restored.accessToken);
      } catch {
        authState.logout();
      } finally {
        if (active) setAuthChecked(true);
      }
    };

    void restoreSession();
    return () => { active = false; };
  }, [mounted]);

  useEffect(() => {
    if (!mounted || !authChecked) return;
    if (!user) {
      router.replace('/login?redirect=/developers');
      return;
    }
    let active = true;
    botService.list()
      .then((items) => {
        if (!active) return;
        setApplications(items);
        setSelectedId((current) => current ?? items[0]?.id ?? null);
      })
      .catch((requestError) => active && setError(errorMessage(requestError)))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [authChecked, mounted, router, user]);

  useEffect(() => {
    if (!selected) return;
    if (initializedApplicationId.current === selected.id) return;
    initializedApplicationId.current = selected.id;
    setEditName(selected.name);
    setEditDescription(selected.description ?? '');
    setEditBotPublic(selected.bot_public);
    setEditRequireCodeGrant(selected.bot_require_code_grant);
    const configuredInstallationTypes = Object.keys(selected.integration_types_config || {});
    setEditGuildInstall(configuredInstallationTypes.length === 0 || configuredInstallationTypes.includes('0'));
    setEditUserInstall(configuredInstallationTypes.includes('1'));
    setEditRedirectUris(selected.redirect_uris.join('\n'));
    setEditInteractionsEndpoint(selected.interactions_endpoint_url ?? '');
    setEditEventWebhooksEndpoint(selected.event_webhooks_url ?? '');
    setEditEventWebhooksEnabled(selected.event_webhooks_status === 1 && selected.event_webhooks_types.length > 0);
    setEditEventWebhookTypes(selected.event_webhooks_types);
    setEditTermsUrl(selected.terms_of_service_url ?? '');
    setEditPrivacyUrl(selected.privacy_policy_url ?? '');
    setEditFlags(selected.flags || 0);
    const storedPermissions = selected.install_params?.permissions;
    setEditInstallPermissions(normalizedPermissionDraft(storedPermissions));
    setActiveSection('bot');
    setInviteCopied(false);
    setCommandsError(null);
    resetCommandForm();
    setCreatingCommand(false);
    setDispatchError(null);
    setDispatchResponse(null);
    setDispatchToken('');
    setDispatchPayload(
      '{\n  "type": 2,\n  "guild_id": 0,\n  "channel_id": 0,\n  "data": {\n    "name": "ping"\n  },\n  "user": {\n    "id": ""\n  }\n}',
    );
  }, [selected]);

  useEffect(() => {
    if (!selected) {
      setCommands([]);
      return;
    }
    let active = true;
    setCommandsLoading(true);
    setCommandsError(null);
    botService
      .listCommands(selected.id, { includeDisabled: true })
      .then((items) => {
        if (!active) return;
        setCommands(items);
      })
      .catch((requestError) => {
        if (!active) return;
        setCommandsError(errorMessage(requestError));
        setCommands([]);
      })
      .finally(() => {
        if (active) setCommandsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [selected]);

  const createApplication = async () => {
    if (!createName.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const result = await botService.create({
        name: createName.trim(),
        description: createDescription.trim() || null,
      });
      setApplications((current) => [result.application, ...current]);
      setSelectedId(result.application.id);
      setCreateName('');
      setCreateDescription('');
      setCreateOpen(false);
      setOneTimeToken(result.bot_token);
      setOneTimeClientSecret(result.client_secret);
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setSaving(false);
    }
  };

  const saveApplication = async () => {
    if (!selected || !editName.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await botService.update(selected.id, {
        name: editName.trim(),
        description: editDescription.trim() || null,
        bot_public: editBotPublic,
        bot_require_code_grant: editRequireCodeGrant,
        redirect_uris: editRedirectUris.split(/\r?\n/).map((item) => item.trim()).filter(Boolean),
        interactions_endpoint_url: editInteractionsEndpoint.trim() || null,
        event_webhooks_url: editEventWebhooksEndpoint.trim() || null,
        event_webhooks_types: editEventWebhooksEnabled ? editEventWebhookTypes : [],
        terms_of_service_url: editTermsUrl.trim() || null,
        privacy_policy_url: editPrivacyUrl.trim() || null,
        flags: editFlags,
        install_params: {
          ...(selected.install_params ?? {}),
          scopes: ['bot', 'applications.commands'],
          permissions: editInstallPermissions,
        },
        integration_types_config: {
          ...(editGuildInstall ? {
            0: {
              ...((selected.integration_types_config?.['0'] as Record<string, unknown> | undefined) ?? {}),
              oauth2_install_params: {
                scopes: ['bot', 'applications.commands'],
                permissions: editInstallPermissions,
              },
            },
          } : {}),
          ...(editUserInstall ? {
            1: {
              ...((selected.integration_types_config?.['1'] as Record<string, unknown> | undefined) ?? {}),
              oauth2_install_params: {
                scopes: ['applications.commands'],
                permissions: '0',
              },
            },
          } : {}),
        },
      });
      setApplications((current) => current.map((item) => item.id === updated.id ? updated : item));
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setSaving(false);
    }
  };

  const resetToken = async () => {
    if (!selected || !window.confirm('Старый токен сразу перестанет работать. Создать новый?')) return;
    setSaving(true);
    setError(null);
    try {
      const result = await botService.resetToken(selected.id);
      setOneTimeToken(result.bot_token);
      setOneTimeClientSecret(null);
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setSaving(false);
    }
  };

  const copyInviteLink = async () => {
    if (!selected) return;
    setError(null);
    try {
      const inviteLink = await botService.getInviteLink(selected.id, editInstallPermissions);
      await navigator.clipboard.writeText(inviteLink);
      setInviteCopied(true);
      window.setTimeout(() => setInviteCopied(false), 1500);
    } catch (requestError) {
      setError(errorMessage(requestError));
    }
  };

  const replaceApplication = (updated: BotApplication) => {
    setApplications((current) => current.map((item) => item.id === updated.id ? updated : item));
  };

  const uploadBotMedia = async (kind: 'avatar' | 'banner', file: File) => {
    if (!selected) return;
    if (!file.type.startsWith('image/')) {
      setError('Выберите изображение PNG, GIF, JPG или WEBP.');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setError('Максимальный размер изображения — 10 МБ.');
      return;
    }
    setMediaBusy(kind);
    setError(null);
    try {
      replaceApplication(await botService.uploadMedia(selected.id, kind, file));
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setMediaBusy(null);
    }
  };

  const deleteBotMedia = async (kind: 'avatar' | 'banner') => {
    if (!selected) return;
    setMediaBusy(kind);
    setError(null);
    try {
      replaceApplication(await botService.deleteMedia(selected.id, kind));
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setMediaBusy(null);
    }
  };

  const disableApplication = async () => {
    if (!selected || !window.confirm('Отключить приложение и немедленно отозвать его токен?')) return;
    setSaving(true);
    setError(null);
    try {
      await botService.disable(selected.id);
      setApplications((current) => current.filter((item) => item.id !== selected.id));
      setSelectedId(applications.find((item) => item.id !== selected.id)?.id ?? null);
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setSaving(false);
    }
  };

  const copyToken = async () => {
    const values = [
      oneTimeToken ? `Bot Token: ${oneTimeToken}` : null,
      oneTimeClientSecret ? `Client Secret: ${oneTimeClientSecret}` : null,
    ].filter(Boolean).join('\n');
    if (!values) return;
    await navigator.clipboard.writeText(values);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  const startCreateCommand = () => {
    resetCommandForm();
    setCreatingCommand(true);
  };

  const startEditCommand = (command: BotCommand) => {
    setEditingCommandId(command.id);
    setCreatingCommand(false);
    setCommandServerId(command.server_id ? String(command.server_id) : '');
    setCommandName(command.name);
    setCommandDescription(command.description);
    setCommandType(String(command.type));
    const response = command.definition?.response as Record<string, unknown> | undefined;
    const responseData = response?.data as Record<string, unknown> | undefined;
    setCommandResponseContent(typeof responseData?.content === 'string' ? responseData.content : '');
    const permissions = command.default_member_permissions;
    setCommandDefaultMemberPermissions(permissions === null ? '' : String(permissions));
    setCommandDmPermission(command.dm_permission);
    setCommandAllowedUsers(command.allowed_user_ids.join(','));
    setCommandAllowedRoles(command.allowed_role_ids.join(','));
    setCommandOptionsJson(JSON.stringify((command.definition?.options as unknown[]) || [], null, 2));
    setCommandNameLocalizationsJson(JSON.stringify(command.name_localizations || {}, null, 2));
    setCommandDescriptionLocalizationsJson(JSON.stringify(command.description_localizations || {}, null, 2));
    setCommandContexts(command.contexts || [0]);
    setCommandIntegrationTypes(command.integration_types || [0]);
    setCommandNsfw(Boolean(command.nsfw));
    setCommandHandler(String((command.definition?.handler as number | undefined) || 1));
  };

  const submitCommand = async () => {
    if (!selected || !commandName.trim()) return;
    let options: unknown[];
    let nameLocalizations: Record<string, string>;
    let descriptionLocalizations: Record<string, string>;
    try {
      options = JSON.parse(commandOptionsJson || '[]') as unknown[];
      nameLocalizations = JSON.parse(commandNameLocalizationsJson || '{}') as Record<string, string>;
      descriptionLocalizations = JSON.parse(commandDescriptionLocalizationsJson || '{}') as Record<string, string>;
      if (!Array.isArray(options) || !nameLocalizations || Array.isArray(nameLocalizations) || !descriptionLocalizations || Array.isArray(descriptionLocalizations)) throw new Error();
    } catch {
      setCommandsError('Options должны быть JSON-массивом, а локализации — JSON-объектами.');
      return;
    }
    const resolvedCommandType = Number(commandType) || 1;
    const payload = {
      name: commandName,
      description: resolvedCommandType === 2 || resolvedCommandType === 3 ? '' : (commandDescription.trim() || commandName.trim()),
      type: resolvedCommandType,
      server_id: commandServerId ? Number(commandServerId) : null,
      definition: {
        options,
        ...(resolvedCommandType === 4 ? { handler: Number(commandHandler) || 1 } : {}),
        ...(commandResponseContent ? { response: { type: 4, data: { content: commandResponseContent, allowed_mentions: { parse: [] } } } } : {}),
      },
      default_member_permissions: commandDefaultMemberPermissions.trim()
        ? Number(commandDefaultMemberPermissions)
        : null,
      dm_permission: commandDmPermission,
      allowed_user_ids: normalizeIdList(commandAllowedUsers),
      allowed_role_ids: normalizeIdList(commandAllowedRoles),
      name_localizations: Object.keys(nameLocalizations).length ? nameLocalizations : null,
      description_localizations: Object.keys(descriptionLocalizations).length ? descriptionLocalizations : null,
      contexts: commandContexts,
      integration_types: commandIntegrationTypes,
      nsfw: commandNsfw,
    } as BotCommandPayload;
    setCreatingCommand(false);
    setSaving(true);
    setError(null);
    setCommandsError(null);
    try {
      if (editingCommandId === null) {
        const updated = await botService.createCommand(selected.id, payload);
        setCommands(updated);
      } else {
        const updated = await botService.updateCommand(selected.id, editingCommandId, payload);
        setCommands((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      }
      resetCommandForm();
    } catch (requestError) {
      setCommandsError(errorMessage(requestError));
    } finally {
      setSaving(false);
    }
  };

  const deleteCommand = async (command: BotCommand) => {
    if (!selected || !window.confirm(`Delete command /${command.name}?`)) return;
    setSaving(true);
    setCommandsError(null);
    try {
      await botService.deleteCommand(selected.id, command.id);
      setCommands((current) => current.filter((item) => item.id !== command.id));
      if (editingCommandId === command.id) {
        resetCommandForm();
      }
    } catch (requestError) {
      setCommandsError(errorMessage(requestError));
    } finally {
      setSaving(false);
    }
  };

  const syncCommands = async () => {
    if (!selected) return;
    setSaving(true);
    setCommandsError(null);
    try {
      await botService.syncCommands(selected.id, { serverId: commandServerId ? Number(commandServerId) : null });
      const updated = await botService.listCommands(selected.id, { includeDisabled: true, serverId: commandServerId ? Number(commandServerId) : null });
      setCommands(updated);
    } catch (requestError) {
      setCommandsError(errorMessage(requestError));
    } finally {
      setSaving(false);
    }
  };

  const resetClientSecret = async () => {
    if (!selected || !window.confirm('Старый client secret сразу перестанет работать. Создать новый?')) return;
    setSaving(true);
    setError(null);
    try {
      const result = await botService.resetClientSecret(selected.id);
      setOneTimeToken(null);
      setOneTimeClientSecret(result.client_secret);
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setSaving(false);
    }
  };

  const testDispatch = async () => {
    if (!selected) return;
    setDispatchBusy(true);
    setDispatchError(null);
    try {
      const parsed = JSON.parse(dispatchPayload);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('Payload must be a JSON object');
      }
      const payload = parsed as BotCommandDispatchPayload;
      const response = await botService.dispatchCommand(selected.id, dispatchToken.trim(), payload);
      setDispatchResponse(response);
    } catch (requestError) {
      setDispatchError(errorMessage(requestError));
    } finally {
      setDispatchBusy(false);
    }
  };

  const copyDispatchCurl = async () => {
    if (!selected || !dispatchToken.trim()) return;
    let payloadText = dispatchPayload;
    try {
      const parsed = JSON.parse(payloadText);
      payloadText = JSON.stringify(parsed);
    } catch (requestError) {
      setDispatchError(errorMessage(requestError));
      return;
    }
    const curl = [
      `curl -X POST ${window.location.origin}/api/v1/bot/apps/${selected.id}/commands/dispatch \\`,
      `  -H "Authorization: Bot ${dispatchToken.trim()}" \\`,
      '  -H "Content-Type: application/json" \\',
      `  -d '${payloadText.replace(/'/g, '\\\'')}'`,
    ].join('\n');
    try {
      await navigator.clipboard.writeText(curl);
      setDispatchCopied(true);
      window.setTimeout(() => setDispatchCopied(false), 1500);
    } catch (requestError) {
      setDispatchError(errorMessage(requestError));
    }
  };

  if (!mounted || !authChecked || !user) return null;

  return <DeveloperPortalView model={{
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
    syncCommands, resetClientSecret, testDispatch, copyDispatchCurl,
  }} />
}
