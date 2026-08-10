import type { Channel, Server } from '../types'
import websocketService from '../services/websocketService'
import { useAuthStore } from '../store/store'
import { registerDmNotificationListener } from '../store/dmNotificationStore'
import { registerMentionNotificationListener } from '../store/mentionNotificationStore'
import { registerChannelUnreadListener } from '../store/channelUnreadStore'
import { applyMemberJoined, applyMemberLeft } from './memberSync'
import { useVoiceStore } from '../store/slices/voiceSlice'
import { bindCommunityRealtime } from '../services/communityRealtime'
import type { AppState } from './appStoreTypes'
import { mapServerChannel } from './serverChannelMapping'

let notificationHandlersBound = false
let reconnectRefetchBound = false

function isInSameVoiceChannel(voiceChannelId: unknown): boolean {
  const streamerChannelId = Number(voiceChannelId)
  return Number.isFinite(streamerChannelId)
    && useVoiceStore.getState().currentVoiceChannelId === streamerChannelId
}

export function initializeAppRealtime(token: string, get: () => AppState): void {

registerDmNotificationListener();
registerMentionNotificationListener();
registerChannelUnreadListener();
websocketService.connect(token);
bindCommunityRealtime(() => { void get().loadServers() });

// После разрыва связи догружаем актуальное состояние (нет RESUME)
if (!reconnectRefetchBound) {
  reconnectRefetchBound = true;
  let wasDisconnected = false;
  websocketService.onConnectionStatusChange((status) => {
    if (!status.isConnected) {
      wasDisconnected = true;
      return;
    }
    if (!wasDisconnected) return;
    wasDisconnected = false;

    void get().loadServers();
    const channel = get().currentChannel;
    if (channel?.type === 'text') {
      void import('../store/chatStore').then(({ useChatStore }) => {
        void useChatStore.getState().loadMessageHistory(channel.id);
      });
    }
  });
}

if (notificationHandlersBound) {
  return;
}
notificationHandlersBound = true;

// Приглашение на сервер (server_invite) + legacy channel_invitation
websocketService.onChannelInvitation((raw) => {
  const data = (raw as any)?.data || raw;
  const inviter = data.inviter_name || data.invited_by || 'Кто-то';
  const targetName = data.channel_name || data.server_name || 'сервер';
  console.log('Получено приглашение:', data);

  if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
    new Notification('Приглашение на сервер', {
      body: `${inviter} пригласил вас на ${targetName}`,
      icon: '/favicon.ico',
    });
  }

  // Перезагружаем список серверов (после принятия инвайта список обновится и так)
  get().loadServers();
});

// Обработка создания нового сервера
websocketService.onServerCreated((data) => {
  console.log('Создан новый сервер:', data);

  // Показываем уведомление
  if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
    if (data.created_by) {
      new Notification(`Новый сервер`, {
        body: `${data.created_by.username} создал сервер "${data.server.name}"`,
        icon: '/favicon.ico'
      });
    } else if (data.invited_by) {
      new Notification(`Приглашение на сервер`, {
        body: `Вас пригласили на сервер "${data.server.name}"`,
        icon: '/favicon.ico'
      });
    }
  }

  // Добавляем новый сервер в список
  const textChannels = (data.server.text_channels || []).map((channel: any) =>
    mapServerChannel(data.server.id, channel, 'text'),
  );
  const voiceChannels = (data.server.voice_channels || []).map((channel: any) =>
    mapServerChannel(data.server.id, channel, 'voice'),
  );
  const newServer: Server = {
    id: data.server.id,
    name: data.server.name,
    description: data.server.description,
    icon: data.server.icon,
    banner: data.server.banner ?? null,
    is_public: Boolean(data.server.is_public),
    owner_id: data.server.owner_id,
    channels: [...textChannels, ...voiceChannels],
  };
  get().addServer(newServer);
  const stateAfterAdd = get();
  if (!stateAfterAdd.currentServer || stateAfterAdd.currentServer.id === data.server.id) {
    void get().loadServerDetails(data.server.id);
  }
});

// Обработка обновления сервера
websocketService.onServerUpdated((raw) => {
  const data = (raw as any).data || raw;
  console.log('Сервер обновлен:', data);

  get().updateServer(data.server_id, {
    name: data.name,
    description: data.description,
    icon: data.icon,
    banner: data.banner ?? null,
    is_public: Boolean(data.is_public),
  });

  const currentUser = get().user;
  if (currentUser && data.updated_by && data.updated_by.id !== currentUser.id) {
    if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
      new Notification(`Сервер обновлен`, {
        body: `${data.updated_by.username} обновил настройки сервера "${data.name}"`,
        icon: '/favicon.ico'
      });
    }
  }
});

// Обработка удаления сервера
websocketService.onServerDeleted((data) => {
  const eventData = (data as any).data || data;
  const serverId = eventData.server_id;

  if (serverId) {
    get().removeServer(serverId);

    const currentUser = get().user;
    if (currentUser && eventData.deleted_by && eventData.deleted_by.id !== currentUser.id) {
      if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
        new Notification('Сервер удален', {
          body: `${eventData.deleted_by.username} удалил сервер "${eventData.server_name}"`,
          icon: '/favicon.ico',
        });
      }
    }
  } else {
    console.error('Не удалось извлечь server_id из события server_deleted:', data);
  }
});

// Кик / бан — убрать сервер у текущего пользователя
websocketService.onServerRemoved((raw) => {
  const eventData = (raw as any)?.data || raw;
  const serverId = eventData.server_id;
  if (!serverId) return;

  get().removeServer(serverId);

  if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
    const kindLabel = eventData.kind === 'ban' ? 'заблокировали на' : 'исключили с';
    const by = eventData.by ? ` (${eventData.by})` : '';
    new Notification('Вы больше не на сервере', {
      body: `Вас ${kindLabel} сервера "${eventData.server_name || serverId}"${by}`,
      icon: '/favicon.ico',
    });
  }
});

// Обработка создания текстового канала
websocketService.onTextChannelCreated((data) => {
  console.log('Создан новый текстовый канал:', data);

  // Показываем уведомление
  if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
    new Notification(`Новый текстовый канал`, {
      body: `${data.created_by.username} создал канал #${data.text_channel.name}`,
      icon: '/favicon.ico'
    });
  }

  // Добавляем новый канал в соответствующий сервер
  const newChannel: Channel = {
    id: data.text_channel.id,
    name: data.text_channel.name,
    type: 'text',
    serverId: data.channel_id
  };
  get().addChannel(data.channel_id, newChannel);
});

// Обработка создания голосового канала
websocketService.onVoiceChannelCreated((data) => {
  console.log('Создан новый голосовой канал:', data);

  // Показываем уведомление
  if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
    new Notification(`Новый голосовой канал`, {
      body: `${data.created_by.username} создал голосовой канал ${data.voice_channel.name}`,
      icon: '/favicon.ico'
    });
  }

  // Добавляем новый канал в соответствующий сервер
  const newChannel: Channel = {
    id: data.voice_channel.id,
    name: data.voice_channel.name,
    type: 'voice',
    serverId: data.channel_id
  };
  get().addChannel(data.channel_id, newChannel);
});

// Присоединение участника к серверу — сразу в правый список
websocketService.onUserJoinedChannel((data) => {
  console.log('Пользователь присоединился к серверу:', data);
  applyMemberJoined({
    channel_id: data.channel_id,
    user_id: data.user_id,
    username: data.username,
    display_name: data.display_name,
    avatar_url: data.avatar_url,
    user: data.user
      ? {
          ...data.user,
          display_name: data.user.display_name ?? undefined,
          avatar_url: data.user.avatar_url ?? undefined,
        }
      : undefined,
  });
});

// Выход участника из сервера
websocketService.onUserLeftChannel((data) => {
  console.log('Пользователь покинул сервер:', data);
  applyMemberLeft(data);
});

// Обновление / удаление текстовых и голосовых каналов
websocketService.onTextChannelUpdated((raw) => {
  const data = (raw as any)?.data || raw;
  const channelId = data.text_channel_id;
  if (!channelId) return;

  const serverId =
    get().servers.find((server) =>
      server.channels.some((c) => c.id === channelId && c.type === 'text')
    )?.id ?? get().currentServer?.id;

  if (!serverId) return;

  get().updateChannel(serverId, channelId, 'text', {
    name: data.name,
    position: data.position,
    slow_mode_seconds: data.slow_mode_seconds,
  });
});

websocketService.onVoiceChannelUpdated((raw) => {
  const data = (raw as any)?.data || raw;
  const channelId = data.voice_channel_id;
  if (!channelId) return;

  const serverId =
    get().servers.find((server) =>
      server.channels.some((c) => c.id === channelId && c.type === 'voice')
    )?.id ?? get().currentServer?.id;

  if (!serverId) return;

  get().updateChannel(serverId, channelId, 'voice', {
    name: data.name,
    position: data.position,
    max_users: data.max_users,
    bitrate: data.bitrate,
    video_quality: data.video_quality,
  });
});

// Перестановка каналов и смена категории приходят одним пакетом
websocketService.on('channel_positions_updated', (raw: any) => {
  const data = raw?.data || raw;
  const serverId = data?.server_id;
  const channels = Array.isArray(data?.channels) ? data.channels : [];
  if (!serverId || channels.length === 0) return;

  for (const item of channels) {
    if (!item?.id || (item.type !== 'text' && item.type !== 'voice')) continue;
    get().updateChannel(serverId, item.id, item.type, {
      position: item.position,
      category_id: item.category_id ?? null,
    });
  }
});

websocketService.onTextChannelDeleted((raw) => {
  const data = (raw as any)?.data || raw;
  const channelId = data.text_channel_id;
  const serverId = data.server_id;
  if (!channelId || !serverId) return;
  get().removeChannel(serverId, channelId, 'text');
});

websocketService.onVoiceChannelDeleted((raw) => {
  const data = (raw as any)?.data || raw;
  const channelId = data.voice_channel_id;
  const serverId = data.server_id;
  if (!channelId || !serverId) return;
  get().removeChannel(serverId, channelId, 'voice');
});

// Обработка присоединения к голосовому каналу
websocketService.onVoiceChannelJoin((data) => {
  console.log('Пользователь присоединился к голосовому каналу:', data);

  // Воспроизводим звук подключения только если это не мы сами И мы находимся в том же канале
  const currentUser = useAuthStore.getState().user;
  // Получаем ID текущего голосового канала из голосового store
  import('../store/slices/voiceSlice').then(({ useVoiceStore }) => {
    const currentVoiceChannelId = useVoiceStore.getState().currentVoiceChannelId;
    if (currentUser && data.user_id !== currentUser.id && currentVoiceChannelId === data.voice_channel_id) {
      import('../services/soundService').then(({ default: soundService }) => {
        soundService.playJoinSound();
      });
    }
  });

  // Показываем уведомление
  if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
    new Notification(`Голосовой канал`, {
      body: `${data.username} присоединился к каналу "${data.voice_channel_name}"`,
      icon: '/favicon.ico'
    });
  }

  // Генерируем глобальное событие для обновления UI
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('voice_channel_join', { detail: data }));
  }
});

// Обработка выхода из голосового канала
websocketService.onVoiceChannelLeave((data) => {
  console.log('Пользователь покинул голосовой канал:', data);

  // Воспроизводим звук отключения только если это не мы сами И мы находимся в том же канале
  const currentUser = useAuthStore.getState().user;
  // Получаем ID текущего голосового канала из голосового store
  import('../store/slices/voiceSlice').then(({ useVoiceStore }) => {
    const currentVoiceChannelId = useVoiceStore.getState().currentVoiceChannelId;
    if (currentUser && data.user_id !== currentUser.id && currentVoiceChannelId === data.voice_channel_id) {
      import('../services/soundService').then(({ default: soundService }) => {
        soundService.playLeaveSound();
      });
    }
  });

  // Показываем уведомление
  if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
    new Notification(`Голосовой канал`, {
      body: `${data.username} покинул голосовой канал`,
      icon: '/favicon.ico'
    });
  }

  // Генерируем глобальное событие для обновления UI
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('voice_channel_leave', { detail: data }));
  }
});

// Обработка начала демонстрации экрана
websocketService.onScreenShareStarted((data) => {
  const currentUserId = useAuthStore.getState().user?.id;
  const streamerId = Number(data.user_id);
  const isSelf = currentUserId != null && streamerId === currentUserId;
  const isSameVoiceChannel = isInSameVoiceChannel((data as any).voice_channel_id);

  if (
    !isSelf &&
    isSameVoiceChannel &&
    typeof window !== 'undefined' &&
    'Notification' in window &&
    Notification.permission === 'granted'
  ) {
    new Notification(`Демонстрация экрана`, {
      body: `${data.username} начал демонстрацию экрана`,
      icon: '/favicon.ico'
    }).onclick = () => {
      if (typeof window !== 'undefined') {
        window.focus();
      }
    };
  }

  // Событие нужно всем — по нему сайдбар рисует значок «В эфире»
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('screen_share_start', { detail: data }));
  }
});

// Обработка остановки демонстрации экрана
websocketService.onScreenShareStopped((data) => {
  if (
    isInSameVoiceChannel((data as any).voice_channel_id) &&
    typeof window !== 'undefined' &&
    'Notification' in window &&
    Notification.permission === 'granted'
  ) {
    new Notification(`Демонстрация экрана`, {
      body: `${data.username} остановил демонстрацию экрана`,
      icon: '/favicon.ico'
    });
  }

  // Генерируем глобальное событие для обновления UI
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('screen_share_stop', { detail: data }));
  }
});

// Обработка изменения статуса пользователя
websocketService.onUserStatusChanged((data) => {


  // Генерируем глобальное событие для обновления UI
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('user_status_changed', { detail: data }));
  }
});

// Смена аватара / имени — сразу у всех онлайн
websocketService.onUserProfileUpdated((payload) => {
  const data = (payload as any)?.data || payload;
  if (!data?.user_id || typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('user_profile_updated', { detail: data }));
});
}

export function disconnectAppRealtime(): void {
  notificationHandlersBound = false
  reconnectRefetchBound = false
  websocketService.fullDisconnect()
}
