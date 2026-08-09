export type ScreenShareEventDetail = {
  user_id: number;
  username: string;
  display_name?: string;
  avatar_url?: string;
  is_sharing_screen: boolean;
};

export function dispatchScreenShareState(detail: ScreenShareEventDetail): void {
  if (typeof window === 'undefined') return;
  const type = detail.is_sharing_screen ? 'screen_share_start' : 'screen_share_stop';
  window.dispatchEvent(new CustomEvent(type, { detail }));
}
