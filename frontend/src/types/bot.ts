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
