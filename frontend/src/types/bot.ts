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
  status: 'active' | 'disabled';
  created_at: string;
  updated_at: string;
  bot: BotIdentity;
}

export interface BotApplicationCreated {
  application: BotApplication;
  bot_token: string;
}

export interface BotTokenReset {
  bot_token: string;
  rotation_id: number;
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
