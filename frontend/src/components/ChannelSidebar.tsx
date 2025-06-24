'use client'

import { useState, useEffect } from 'react'
import { Hash, Volume2, ChevronDown, Settings, Plus, Mic, MicOff, Headphones, PhoneOff, VolumeX, Monitor, MonitorOff, UserX, UserCheck, Shield, Volume1, LogOut, UserPlus, Copy, X, Trash2 } from 'lucide-react'
import { useStore } from '../lib/store'
import { useVoiceStore } from '../store/slices/voiceSlice'
import { useAuthStore } from '../store/store'
import { useRouter } from 'next/navigation'
import { cn } from '../lib/utils'
import { Button } from './ui/button'
import voiceService from '../services/voiceService'
import {
  Dialog,
  DialogContent,
  DialogTitle,
  TextField,
  Box,
  Avatar,
  Typography,
  Menu,
  MenuItem,
  ListItemIcon,
  ListItemText,
  Divider,
  Slider,
  Paper,
  IconButton,
} from '@mui/material'
import channelService from '../services/channelService'
import { UserAvatar } from './ui/user-avatar'
import { ServerSettingsModal } from './ServerSettingsModal'

// Компонент для аватарки с анимацией при разговоре
interface SpeakingAvatarProps {
  user: {
    username?: string;
    display_name?: string;
    avatar_url?: string | null;
  };
  isSpeaking: boolean;
  isScreenSharing?: boolean;
  size?: number;
}

function SpeakingAvatar({ user, isSpeaking, isScreenSharing, size = 20 }: SpeakingAvatarProps) {
  return (
    <Box
      sx={{
        position: 'relative',
        display: 'inline-block',
      }}
    >
      {/* Анимированная обводка для разговора */}
      {isSpeaking && !isScreenSharing && (
        <Box
          sx={{
            position: 'absolute',
            top: -2,
            left: -2,
            width: size + 4,
            height: size + 4,
            borderRadius: '50%',
            background: 'linear-gradient(45deg, #00ff88, #00cc6a)',
            animation: 'speaking-pulse 1.5s ease-in-out infinite',
            '@keyframes speaking-pulse': {
              '0%': {
                transform: 'scale(1)',
                opacity: 0.8,
              },
              '50%': {
                transform: 'scale(1.1)',
                opacity: 1,
              },
              '100%': {
                transform: 'scale(1)',
                opacity: 0.8,
              },
            },
          }}
        />
      )}

      {/* Рамка для демонстрации экрана */}
      {isScreenSharing && (
        <Box
          sx={{
            position: 'absolute',
            top: -3,
            left: -3,
            width: size + 6,
            height: size + 6,
            borderRadius: '50%',
            border: '2px solid #22c55e',
            background: 'linear-gradient(45deg, #22c55e, #16a34a)',
            animation: 'screen-share-pulse 2s ease-in-out infinite',
            '@keyframes screen-share-pulse': {
              '0%': {
                transform: 'scale(1)',
                opacity: 0.9,
              },
              '50%': {
                transform: 'scale(1.05)',
                opacity: 1,
              },
              '100%': {
                transform: 'scale(1)',
                opacity: 0.9,
              },
            },
          }}
        />
      )}
      
      {/* Основная аватарка */}
      <UserAvatar
        user={user}
        size={size}
        sx={{ 
          backgroundColor: isScreenSharing ? '#22c55e' : (isSpeaking ? '#00ff88' : (!user.avatar_url ? '#5865f2' : 'transparent')),
          color: 'white',
          fontWeight: 600,
          zIndex: 1,
          position: 'relative',
          border: isScreenSharing ? '2px solid #16a34a' : (isSpeaking ? '1px solid #00ff88' : '1px solid transparent'),
          transition: 'all 0.2s ease-in-out',
        }}
      />
    </Box>
  );
}

export function ChannelSidebar() {
  const { currentServer, currentChannel, selectChannel, addChannel, loadServers } = useStore()
  const { 
    connectToVoiceChannel, 
    currentVoiceChannelId, 
    participants, 
    disconnectFromVoiceChannel, 
    isMuted, 
    isDeafened,
    isConnected,
    toggleMute,
    toggleDeafen,
    speakingUsers
  } = useVoiceStore()
  const { user, logout } = useAuthStore()
  const router = useRouter()
  
  // Базовые состояния
  const [isCreateTextModalOpen, setIsCreateTextModalOpen] = useState(false)
  const [isCreateVoiceModalOpen, setIsCreateVoiceModalOpen] = useState(false)
  const [newChannelName, setNewChannelName] = useState('')
  const [isCreating, setIsCreating] = useState(false)
  const [voiceChannelMembers, setVoiceChannelMembers] = useState<Record<number, any[]>>({})
  
  // Состояние для настроек канала
  const [isChannelSettingsOpen, setIsChannelSettingsOpen] = useState(false);
  const [selectedChannel, setSelectedChannel] = useState<any>(null);
  const [channelName, setChannelName] = useState('');
  const [channelUserLimit, setChannelUserLimit] = useState<number | null>(null);
  const [slowModeSeconds, setSlowModeSeconds] = useState<number>(0);
  const [isUpdatingChannel, setIsUpdatingChannel] = useState(false);

  // Остальные состояния...
  const [contextMenu, setContextMenu] = useState<{
    mouseX: number;
    mouseY: number;
    participant: any;
  } | null>(null);

  const [participantVolumes, setParticipantVolumes] = useState<Record<number, number>>({});
  const [screenSharingUsers, setScreenSharingUsers] = useState<Set<number>>(new Set());
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [activeSharingUsers, setActiveSharingUsers] = useState<{ userId: number; username: string }[]>([]);
  const [serverContextMenu, setServerContextMenu] = useState<{ mouseX: number; mouseY: number } | null>(null);
  const [isInviteModalOpen, setIsInviteModalOpen] = useState(false);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [inviteUsername, setInviteUsername] = useState('');
  const [inviteError, setInviteError] = useState('');
  const [isInviting, setIsInviting] = useState(false);

  if (!currentServer) {
    return (
      <div className="w-64 flex flex-col items-center justify-center" style={{ backgroundColor: '#2c2d32' }}>
        <div className="text-sm text-muted-foreground">Выберите сервер</div>
      </div>
    )
  }

  const textChannels = currentServer.channels.filter(c => c.type === 'text')
  const voiceChannels = currentServer.channels.filter(c => c.type === 'voice')

  // Отладочная информация
  console.log('🔧 Отладка настроек каналов:', {
    userID: user?.id,
    serverOwnerID: currentServer?.owner_id,
    isOwner: currentServer?.owner_id === user?.id,
    serverName: currentServer?.name
  });

  return (
    <>
      <div className="w-64 flex flex-col h-screen" style={{ backgroundColor: '#2c2d32' }}>
        {/* Server Header */}
        <div className="h-12 border-b border-border flex items-center px-4 shadow-sm">
          <h2 
            className="font-semibold truncate cursor-pointer hover:text-foreground transition-colors"
            onClick={() => console.log('Server header clicked')}
            onContextMenu={(e) => {
              e.preventDefault();
              console.log('Server context menu');
            }}
          >
            {currentServer.name}
          </h2>
          <ChevronDown className="ml-auto h-4 w-4" />
        </div>

        <div className="flex-1 overflow-y-auto">
          {/* Text Channels */}
          <div className="pt-4">
            <div className="px-2 mb-1">
              <div className="flex items-center justify-between text-xs font-semibold text-muted-foreground uppercase">
                <span>Текстовые каналы</span>
                <Plus 
                  className="w-4 h-4 cursor-pointer hover:text-foreground" 
                  onClick={() => setIsCreateTextModalOpen(true)}
                />
              </div>
            </div>
            <div className="px-2 space-y-0.5">
              {textChannels.map((channel) => {
                const isOwner = currentServer?.owner_id === user?.id;
                console.log(`🔧 Текстовый канал "${channel.name}":`, {
                  channelId: channel.id,
                  isOwner,
                  userID: user?.id,
                  serverOwnerID: currentServer?.owner_id,
                  shouldShowSettings: isOwner
                });
                
                return (
                  <div
                    key={channel.id}
                    className="relative group"
                    onMouseEnter={() => {
                      console.log(`🐭 НАВЕДЕНИЕ на текстовый канал "${channel.name}":`, {
                        channelId: channel.id,
                        isOwner,
                        userID: user?.id,
                        serverOwnerID: currentServer?.owner_id,
                        shouldShowButton: isOwner
                      });
                    }}
                    onMouseLeave={() => {
                      console.log(`🐭 УХОД с текстового канала "${channel.name}"`);
                    }}
                  >
                    <Button
                      variant="ghost"
                      size="sm"
                      className={cn(
                        "w-full justify-start gap-1.5 h-8 px-2 text-muted-foreground hover:text-foreground hover:bg-accent/50",
                        currentChannel?.id === channel.id && "bg-accent text-foreground border-l-4 border-l-blue-500"
                      )}
                      onClick={() => selectChannel(channel.id)}
                    >
                      <Hash className={cn(
                        "w-4 h-4",
                        currentChannel?.id === channel.id ? "text-foreground" : "text-muted-foreground"
                      )} />
                      <span className={cn(
                        currentChannel?.id === channel.id ? "text-foreground font-medium" : ""
                      )}>{channel.name}</span>
                    </Button>
                    
                    {/* Кнопка настроек канала (только для владельца сервера) */}
                    {isOwner && (
                      <button
                        className="absolute right-2 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity duration-200 p-1 hover:bg-[#4f545c] rounded z-20"
                        onClick={(e) => {
                          console.log(`🔧 Клик по настройкам канала "${channel.name}"`);
                          e.stopPropagation();
                          setSelectedChannel(channel);
                          setChannelName(channel.name);
                          setChannelUserLimit(channel.max_users || null);
                          setSlowModeSeconds((channel as any).slow_mode_seconds || 0);
                          setIsChannelSettingsOpen(true);
                        }}
                        title="Настройки канала"
                      >
                        <Settings className="w-4 h-4 text-[#b5bac1]" />
                      </button>
                    )}
                  </div>
                );
              })}
              {textChannels.length === 0 && (
                <div className="px-2 py-2 text-xs text-muted-foreground">
                  Нет текстовых каналов
                </div>
              )}
            </div>
          </div>

          {/* Voice Channels */}
          <div className="pt-4">
            <div className="px-2 mb-1">
              <div className="flex items-center justify-between text-xs font-semibold text-muted-foreground uppercase">
                <span>Голосовые каналы</span>
                <Plus 
                  className="w-4 h-4 cursor-pointer hover:text-foreground" 
                  onClick={() => setIsCreateVoiceModalOpen(true)}
                />
              </div>
            </div>
            <div className="px-2 space-y-0.5">
              {voiceChannels.map((channel) => {
                const isOwner = currentServer?.owner_id === user?.id;
                console.log(`🔧 Голосовой канал "${channel.name}":`, {
                  channelId: channel.id,
                  isOwner,
                  userID: user?.id,
                  serverOwnerID: currentServer?.owner_id,
                  shouldShowSettings: isOwner
                });
                
                return (
                  <div key={channel.id}>
                    <div 
                      className="relative group"
                      onMouseEnter={() => {
                        console.log(`🐭 НАВЕДЕНИЕ на голосовой канал "${channel.name}":`, {
                          channelId: channel.id,
                          isOwner,
                          userID: user?.id,
                          serverOwnerID: currentServer?.owner_id,
                          shouldShowButton: isOwner
                        });
                      }}
                      onMouseLeave={() => {
                        console.log(`🐭 УХОД с голосового канала "${channel.name}"`);
                      }}
                    >
                      <Button
                        variant="ghost"
                        size="sm"
                        className={cn(
                          "w-full justify-start gap-1.5 h-8 px-2",
                          currentChannel?.id === channel.id && "bg-accent",
                          currentVoiceChannelId === channel.id && "bg-green-600/20 border border-green-500/50"
                        )}
                        onClick={() => selectChannel(channel.id)}
                      >
                        <Volume2 className={cn(
                          "w-4 h-4",
                          currentVoiceChannelId === channel.id && "text-green-400"
                        )} />
                        <span className={cn(
                          currentVoiceChannelId === channel.id && "text-green-400"
                        )}>
                          {channel.name}
                        </span>
                        {currentVoiceChannelId === channel.id && (
                          <div className="ml-auto w-2 h-2 bg-green-400 rounded-full animate-pulse" />
                        )}
                      </Button>
                      
                      {/* Кнопка настроек канала (только для владельца сервера) */}
                      {isOwner && (
                        <button
                          className="absolute right-2 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity duration-200 p-1 hover:bg-[#4f545c] rounded z-10"
                          onClick={(e) => {
                            console.log(`🔧 Клик по настройкам голосового канала "${channel.name}"`);
                            e.stopPropagation();
                            setSelectedChannel(channel);
                            setChannelName(channel.name);
                            setChannelUserLimit(channel.max_users || null);
                            setSlowModeSeconds((channel as any).slow_mode_seconds || 0);
                            setIsChannelSettingsOpen(true);
                          }}
                          title="Настройки канала"
                        >
                          <Settings className="w-4 h-4 text-[#b5bac1]" />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
              {voiceChannels.length === 0 && (
                <div className="px-2 py-2 text-xs text-muted-foreground">
                  Нет голосовых каналов
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Channel Settings Modal */}
      <Dialog 
        open={isChannelSettingsOpen} 
        onClose={() => setIsChannelSettingsOpen(false)}
        maxWidth="md"
        fullWidth
        PaperProps={{
          sx: {
            backgroundColor: '#313338',
            color: 'white',
            borderRadius: '8px',
            minWidth: '600px',
            minHeight: '500px'
          }
        }}
      >
        <DialogContent sx={{ padding: 0 }}>
          <div className="flex h-[500px]">
            {/* Sidebar */}
            <div className="w-60 bg-[#2b2d31] border-r border-[#393a3f] flex flex-col">
              <div className="p-4 border-b border-[#393a3f]">
                <h2 className="text-lg font-semibold text-white">
                  {selectedChannel?.type === 'voice' ? '🔊' : '#'} {selectedChannel?.name}
                </h2>
              </div>
              
              <div className="flex-1 p-2">
                <div className="space-y-1">
                  <div className="px-3 py-2 bg-[#5865f2] text-white rounded text-sm font-medium">
                    Обзор
                  </div>
                </div>
              </div>

              {/* Delete Channel Button */}
              <div className="p-2 border-t border-[#393a3f]">
                <button
                  onClick={async () => {
                    if (!selectedChannel) return;
                    
                    setIsUpdatingChannel(true);
                    try {
                      if (selectedChannel.type === 'text') {
                        await channelService.deleteTextChannel(selectedChannel.id);
                      } else if (selectedChannel.type === 'voice') {
                        await channelService.deleteVoiceChannel(selectedChannel.id);
                      }
                      
                      setIsChannelSettingsOpen(false);
                      // Перезагружаем детали сервера для обновления списка каналов
                      if (currentServer) {
                        const { loadServerDetails } = useStore.getState();
                        await loadServerDetails(currentServer.id);
                      }
                    } catch (error: any) {
                      console.error('Ошибка удаления канала:', error);
                      alert(error.response?.data?.detail || 'Ошибка удаления канала');
                    } finally {
                      setIsUpdatingChannel(false);
                    }
                  }}
                  disabled={isUpdatingChannel}
                  className="w-full text-left px-3 py-2 rounded text-sm text-red-400 hover:bg-red-500/10 transition flex items-center gap-2"
                >
                  <Trash2 className="w-4 h-4" />
                  Удалить канал
                </button>
              </div>
            </div>

            {/* Main Content */}
            <div className="flex-1 flex flex-col">
              {/* Header */}
              <div className="p-6 border-b border-[#393a3f] flex justify-between items-center">
                <h1 className="text-xl font-semibold text-white">Обзор</h1>
                <IconButton
                  onClick={() => setIsChannelSettingsOpen(false)}
                  sx={{ color: '#b5bac1' }}
                >
                  <X size={24} />
                </IconButton>
              </div>

              {/* Content */}
              <div className="flex-1 p-6 overflow-y-auto">
                <div className="max-w-2xl space-y-6">
                  {/* Channel Name */}
                  <div>
                    <label className="block text-sm font-medium text-[#b5bac1] mb-2">
                      Название канала
                    </label>
                    <TextField
                      value={channelName}
                      onChange={(e) => setChannelName(e.target.value)}
                      fullWidth
                      placeholder="Введите название канала..."
                      sx={{
                        '& .MuiOutlinedInput-root': {
                          backgroundColor: '#1e1f22',
                          color: 'white',
                          fontSize: '16px',
                          '& fieldset': {
                            borderColor: '#383a40',
                          },
                          '&:hover fieldset': {
                            borderColor: '#5865f2',
                          },
                          '&.Mui-focused fieldset': {
                            borderColor: '#5865f2',
                          },
                        },
                        '& .MuiInputBase-input': {
                          padding: '12px 16px',
                        },
                      }}
                    />
                  </div>

                  {/* User Limit (только для голосовых каналов) */}
                  {selectedChannel?.type === 'voice' && (
                    <div>
                      <label className="block text-sm font-medium text-[#b5bac1] mb-2">
                        Лимит пользователей
                      </label>
                      <div className="flex items-center gap-3">
                        <input
                          type="radio"
                          id="unlimited"
                          name="userLimit"
                          checked={channelUserLimit === null}
                          onChange={() => setChannelUserLimit(null)}
                          className="text-[#5865f2]"
                        />
                        <label htmlFor="unlimited" className="text-white text-sm">
                          Без ограничений
                        </label>
                      </div>
                      
                      <div className="flex items-center gap-3 mt-3">
                        <input
                          type="radio"
                          id="limited"
                          name="userLimit"
                          checked={channelUserLimit !== null}
                          onChange={() => setChannelUserLimit(channelUserLimit || 10)}
                          className="text-[#5865f2]"
                        />
                        <label htmlFor="limited" className="text-white text-sm">
                          Ограничить до
                        </label>
                        <TextField
                          type="number"
                          value={channelUserLimit || ''}
                          onChange={(e) => {
                            const value = parseInt(e.target.value);
                            if (!isNaN(value) && value >= 1 && value <= 99) {
                              setChannelUserLimit(value);
                            }
                          }}
                          disabled={channelUserLimit === null}
                          placeholder="10"
                          sx={{
                            width: '80px',
                            '& .MuiOutlinedInput-root': {
                              backgroundColor: '#1e1f22',
                              color: 'white',
                              fontSize: '14px',
                              '& fieldset': {
                                borderColor: '#383a40',
                              },
                              '&:hover fieldset': {
                                borderColor: '#5865f2',
                              },
                              '&.Mui-focused fieldset': {
                                borderColor: '#5865f2',
                              },
                              '&.Mui-disabled': {
                                opacity: 0.5,
                              },
                            },
                            '& .MuiInputBase-input': {
                              padding: '8px 12px',
                            },
                          }}
                        />
                        <span className="text-white text-sm">пользователей</span>
                      </div>
                      
                      <p className="text-[#b5bac1] text-xs mt-2">
                        Лимит от 1 до 99 пользователей. При превышении лимита новые пользователи не смогут подключиться.
                      </p>
                    </div>
                  )}

                  {/* Channel Info */}
                  <div className="bg-[#2b2d31] p-4 rounded-lg">
                    <h3 className="font-medium text-white mb-2">Информация о канале</h3>
                    <div className="space-y-1 text-sm text-[#b5bac1]">
                      <p>ID канала: {selectedChannel?.id}</p>
                      <p>Тип: {selectedChannel?.type === 'voice' ? 'Голосовой канал' : 'Текстовый канал'}</p>
                      <p>Дата создания: {new Date().toLocaleDateString()}</p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Footer */}
              <div className="p-6 border-t border-[#393a3f] flex justify-end gap-3">
                <Button 
                  variant="outline" 
                  onClick={() => setIsChannelSettingsOpen(false)} 
                  disabled={isUpdatingChannel}
                  className="bg-transparent border-[#4e5058] text-white hover:bg-[#4e5058] hover:border-[#4e5058] px-6"
                >
                  Отмена
                </Button>
                <Button 
                  onClick={async () => {
                    if (!selectedChannel || !channelName.trim()) return;
                    
                    setIsUpdatingChannel(true);
                    try {
                      if (selectedChannel.type === 'text') {
                        await channelService.updateTextChannel(selectedChannel.id, {
                          name: channelName
                        });
                      } else if (selectedChannel.type === 'voice') {
                        await channelService.updateVoiceChannel(selectedChannel.id, {
                          name: channelName,
                          max_users: channelUserLimit || undefined
                        });
                      }
                      
                      setIsChannelSettingsOpen(false);
                      // Перезагружаем детали сервера для обновления списка каналов
                      if (currentServer) {
                        const { loadServerDetails } = useStore.getState();
                        await loadServerDetails(currentServer.id);
                      }
                    } catch (error: any) {
                      console.error('Ошибка обновления канала:', error);
                    } finally {
                      setIsUpdatingChannel(false);
                    }
                  }} 
                  disabled={isUpdatingChannel || !channelName.trim()}
                  className="bg-[#5865f2] hover:bg-[#4752c4] text-white px-6"
                >
                  {isUpdatingChannel ? 'Сохранение...' : 'Сохранить изменения'}
                </Button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
} 