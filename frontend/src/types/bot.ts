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
