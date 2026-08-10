import { useState } from 'react'
import type { BotApplication, BotCommand, BotCommandDispatchResponse } from '../../types/bot'
import { Permissions } from '../../lib/permissions'

export function useDeveloperPortalState() {
  const [mounted, setMounted] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);
  const [applications, setApplications] = useState<BotApplication[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState('');
  const [createDescription, setCreateDescription] = useState('');
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [oneTimeToken, setOneTimeToken] = useState<string | null>(null);
  const [oneTimeClientSecret, setOneTimeClientSecret] = useState<string | null>(null);
  const [editBotPublic, setEditBotPublic] = useState(true);
  const [editRequireCodeGrant, setEditRequireCodeGrant] = useState(false);
  const [editGuildInstall, setEditGuildInstall] = useState(true);
  const [editUserInstall, setEditUserInstall] = useState(false);
  const [editRedirectUris, setEditRedirectUris] = useState('');
  const [editInteractionsEndpoint, setEditInteractionsEndpoint] = useState('');
  const [editEventWebhooksEndpoint, setEditEventWebhooksEndpoint] = useState('');
  const [editEventWebhooksEnabled, setEditEventWebhooksEnabled] = useState(false);
  const [editEventWebhookTypes, setEditEventWebhookTypes] = useState<string[]>([]);
  const [editTermsUrl, setEditTermsUrl] = useState('');
  const [editPrivacyUrl, setEditPrivacyUrl] = useState('');
  const [editFlags, setEditFlags] = useState(0);
  const [editInstallPermissions, setEditInstallPermissions] = useState(
    String(Permissions.VIEW_CHANNELS + Permissions.SEND_MESSAGES),
  );
  const [activeSection, setActiveSection] = useState<'bot' | 'advanced'>('bot');
  const [mediaBusy, setMediaBusy] = useState<'avatar' | 'banner' | null>(null);
  const [inviteCopied, setInviteCopied] = useState(false);
  const [copied, setCopied] = useState(false);
  const [dispatchToken, setDispatchToken] = useState('');
  const [dispatchPayload, setDispatchPayload] = useState(
    '{\n  "type": 2,\n  "guild_id": 0,\n  "channel_id": 0,\n  "data": {\n    "name": "ping"\n  },\n  "user": {\n    "id": ""\n  }\n}',
  );
  const [dispatchResponse, setDispatchResponse] = useState<BotCommandDispatchResponse | null>(null);
  const [dispatchBusy, setDispatchBusy] = useState(false);
  const [dispatchError, setDispatchError] = useState<string | null>(null);
  const [dispatchCopied, setDispatchCopied] = useState(false);
  const [commands, setCommands] = useState<BotCommand[]>([]);
  const [commandsLoading, setCommandsLoading] = useState(false);
  const [commandsError, setCommandsError] = useState<string | null>(null);
  const [creatingCommand, setCreatingCommand] = useState(false);
  const [editingCommandId, setEditingCommandId] = useState<number | null>(null);
  const [commandServerId, setCommandServerId] = useState('');
  const [commandName, setCommandName] = useState('');
  const [commandDescription, setCommandDescription] = useState('');
  const [commandType, setCommandType] = useState('1');
  const [commandResponseContent, setCommandResponseContent] = useState('');
  const [commandDefaultMemberPermissions, setCommandDefaultMemberPermissions] = useState('');
  const [commandDmPermission, setCommandDmPermission] = useState(true);
  const [commandAllowedUsers, setCommandAllowedUsers] = useState('');
  const [commandAllowedRoles, setCommandAllowedRoles] = useState('');
  const [commandOptionsJson, setCommandOptionsJson] = useState('[]');
  const [commandNameLocalizationsJson, setCommandNameLocalizationsJson] = useState('{}');
  const [commandDescriptionLocalizationsJson, setCommandDescriptionLocalizationsJson] = useState('{}');
  const [commandContexts, setCommandContexts] = useState<number[]>([0]);
  const [commandIntegrationTypes, setCommandIntegrationTypes] = useState<number[]>([0]);
  const [commandNsfw, setCommandNsfw] = useState(false);
  const [commandHandler, setCommandHandler] = useState('1');
  return {
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
  }
}
