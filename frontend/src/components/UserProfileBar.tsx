import { Mic, MicOff, Headphones, VolumeX, Settings } from 'lucide-react';
import { UserAvatar } from './ui/user-avatar';
import { useAuthStore } from '../store/store';
import { useVoiceStore } from '../store/slices/voiceSlice';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

export function UserProfileBar() {
  const { user } = useAuthStore();
  const { isMuted, isDeafened, toggleMute, toggleDeafen } = useVoiceStore();
  const router = useRouter();
  const [showCopiedTooltip, setShowCopiedTooltip] = useState(false);

  const handleMuteToggle = () => {
    console.log('🎙️ Переключение микрофона, текущее состояние:', isMuted);
    toggleMute();
  };

  const handleDeafenToggle = () => {
    console.log('🎧 Переключение наушников, текущее состояние:', isDeafened);
    toggleDeafen();
  };

  const handleSettings = () => {
    router.push('/settings');
  };

  const handleCopyUsername = async () => {
    if (user?.username) {
      try {
        await navigator.clipboard.writeText(user.username);
        setShowCopiedTooltip(true);
        setTimeout(() => setShowCopiedTooltip(false), 2000);
      } catch (err) {
        console.error('Ошибка копирования:', err);
      }
    }
  };

  return (
    <div className="flex h-16 bg-[#36373e] transition-colors duration-200 rounded-lg w-[315px]">
      {/* Левая часть - под серверами (68px) */}
      <div className="w-[68px] flex items-center justify-center bg-transparent">
        <UserAvatar
          user={user || undefined}
          size={40}
          className="border-2 border-[#313338] transition-colors"
        />
      </div>
      
      {/* Правая часть - под каналами */}
      <div className="flex-1 flex items-center justify-center bg-transparent">
        <div className="flex-1 min-w-0 ml-1 p-2 rounded hover:bg-[#45464e] transition-colors duration-200 cursor-pointer group relative" onClick={handleCopyUsername}>
          <div className="font-medium text-[13px] text-white leading-5">
            {user?.display_name || user?.username}
          </div>
          <div
            className="text-xs text-[#b5bac1] font-mono transition-all duration-200 opacity-0 group-hover:opacity-100 group-hover:translate-y-0 translate-y-2"
          >
            {user?.username}
          </div>
          
          {/* Тултип "Скопировано!" */}
          {showCopiedTooltip && (
            <div className="absolute -top-10 left-1/2 transform -translate-x-1/2 bg-[#1e1f22] text-white text-xs px-3 py-2 rounded-md whitespace-nowrap z-50 animate-fade-in shadow-lg border border-[#393a3f]">
              Скопировано!
              <div className="absolute top-full left-1/2 transform -translate-x-1/2 w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-[#1e1f22]"></div>
            </div>
          )}
        </div>
        <div className="flex gap-2 ml-2 mr-3">
          <button 
            onClick={handleMuteToggle}
            className={`w-8 h-8 flex items-center justify-center rounded transition-colors ${
              isMuted 
                ? 'bg-red-500 text-white hover:bg-red-600' 
                : 'text-[#b5bac1] hover:bg-[#35373c] hover:text-white'
            }`}
            title={isMuted ? 'Включить микрофон' : 'Выключить микрофон'}
          >
            {isMuted ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
          </button>
          <button 
            onClick={handleDeafenToggle}
            className={`w-8 h-8 flex items-center justify-center rounded transition-colors ${
              isDeafened 
                ? 'bg-red-500 text-white hover:bg-red-600' 
                : 'text-[#b5bac1] hover:bg-[#35373c] hover:text-white'
            }`}
            title={isDeafened ? 'Включить звук' : 'Выключить звук'}
          >
            {isDeafened ? <VolumeX className="w-4 h-4" /> : <Headphones className="w-4 h-4" />}
          </button>
          <button 
            onClick={handleSettings}
            className="w-8 h-8 flex items-center justify-center rounded hover:bg-[#35373c] transition-colors text-[#b5bac1] hover:text-white"
            title="Настройки пользователя"
          >
            <Settings className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
} 