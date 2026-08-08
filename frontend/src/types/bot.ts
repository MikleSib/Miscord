export interface BotIdentity {
  id: number;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  is_bot: boolean;
}

export interface BotApplication {
  id: number;
  client_id: string;
  name: string;
  description: string | null;
  avatar_url: string | null;
  public_key: string;
  bot_public: boolean;
  bot_require_code_grant: boolean;
  terms_of_service_url: string | null;
  privacy_policy_url: string | null;
  redirect_uris: string[];
  interactions_endpoint_url: string | null;
  event_webhooks_url: string | null;
  event_webhooks_status: number;
  event_webhooks_types: string[];
  tags: string[];
  install_params: Record<string, unknown> | null;
  integration_types_config: Record<string, unknown>;
  custom_install_url: string | null;
  flags: number;
  status: 'active' | 'disabled';
  created_at: string;
  updated_at: string;
  bot: BotIdentity;
}

export interface BotApplicationCreated {
  application: BotApplication;
  bot_token: string;
  client_secret: string;
}

export interface BotTokenReset {
  bot_token: string;
  rotation_id: number;
}

export interface BotClientSecretReset {
  client_secret: string;
  rotation_id: number;
}

export interface DiscordApplicationCommand {
  id: string;
  application_id: string;
  guild_id?: string;
  type: number;
  name: string;
  name_localizations?: Record<string, string> | null;
  description: string;
  description_localizations?: Record<string, string> | null;
  options?: DiscordApplicationCommandOption[];
  default_member_permissions?: string | null;
  dm_permission?: boolean;
  contexts?: number[];
  integration_types?: number[];
  nsfw?: boolean;
  version: string;
}

export interface DiscordApplicationCommandOption {
  type: number;
  name: string;
  description: string;
  required?: boolean;
  choices?: Array<{ name: string; value: string | number }>;
  options?: DiscordApplicationCommandOption[];
  min_value?: number;
  max_value?: number;
  min_length?: number;
  max_length?: number;
  autocomplete?: boolean;
  channel_types?: number[];
}

export interface ChannelApplicationCommands {
  applications: Array<{ id: string; name: string; icon: string | null; description: string }>;
  commands: DiscordApplicationCommand[];
}

export interface ClientInteractionResult {
  id: string;
  application_id?: string;
  token?: string;
  status: 'responded' | 'pending' | 'offline' | 'failed';
  delivered_sessions: number;
}

export interface BotAuthorizationServer {
  id: number;
  name: string;
  icon: string | null;
  already_installed: boolean;
  can_grant: boolean;
}

export interface BotAuthorizationPreview {
  application: BotApplication;
  scopes: string[];
  permissions: number;
  permission_names: string[];
  servers: BotAuthorizationServer[];
}

export interface InstalledBot {
  application: BotApplication;
  permissions: number;
  permission_names: string[];
  scopes: string[];
  installed_at: string;
  installed_by_id: number;
}

export interface BotCommand {
  id: number;
  application_id: number;
  server_id: number | null;
  name: string;
  description: string;
  type: number;
  definition: Record<string, unknown>;
  default_member_permissions: number | null;
  dm_permission: boolean;
  allowed_user_ids: number[];
  allowed_role_ids: number[];
  version: number;
  is_enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface BotCommandPayload {
  name: string;
  description: string;
  type?: number;
  definition?: Record<string, unknown>;
  server_id?: number | null;
  default_member_permissions?: number | null;
  dm_permission?: boolean;
  allowed_user_ids?: number[];
  allowed_role_ids?: number[];
}

export interface BotCommandReplacePayload {
  name: string;
  description: string;
  type: number;
  definition?: Record<string, unknown>;
  server_id?: number | null;
  default_member_permissions?: number | null;
  dm_permission?: boolean;
  allowed_user_ids?: number[];
  allowed_role_ids?: number[];
}

export interface BotCommandUpdatePayload {
  name?: string;
  description?: string | null;
  type?: number | null;
  definition?: Record<string, unknown> | null;
  server_id?: number | null;
  default_member_permissions?: number | null;
  dm_permission?: boolean | null;
  allowed_user_ids?: number[] | null;
  allowed_role_ids?: number[] | null;
  is_enabled?: boolean;
}

export interface BotCommandSyncResult {
  application_id: number;
  server_id: number | null;
  synced_commands: number;
  commands: BotCommand[];
}

export interface BotCommandDispatchPayload {
  type?: number;
  id?: string | null;
  token?: string | null;
  guild_id?: number | null;
  channel_id?: number | null;
  data: Record<string, unknown>;
  member?: Record<string, unknown> | null;
  user?: Record<string, unknown> | null;
}

export interface BotCommandDispatchResponse {
  type: number;
  data?: Record<string, unknown> | null;
  interaction_id: string;
  interaction_token: string;
  application_id: number;
  command_id: number | null;
  guild_id: number | null;
  channel_id: number | null;
}
