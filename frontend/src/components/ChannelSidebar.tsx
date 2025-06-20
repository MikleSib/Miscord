'use client'

import { useSelector, useDispatch } from 'react-redux'
import { RootState, AppDispatch } from '@/store/store'
import { setCurrentChannel } from '@/store/slices/channelSlice'
import { ChatBubbleLeftIcon, SpeakerWaveIcon } from '@heroicons/react/24/outline'

export default function ChannelSidebar() {
  const dispatch = useDispatch<AppDispatch>()
  const { channels, currentChannel } = useSelector((state: RootState) => state.channel)

  const handleChannelClick = (channel: any) => {
    dispatch(setCurrentChannel(channel))
  }

  return (
    <div className="flex flex-col h-full">
      {/* Заголовок сервера */}
      <div className="p-4 border-b border-gray-700">
        <h2 className="text-white font-semibold">Miscord Server</h2>
      </div>

      {/* Список каналов */}
      <div className="flex-1 overflow-y-auto p-2">
        <div className="space-y-1">
          {channels.map((channel) => (
            <button
              key={channel.id}
              onClick={() => handleChannelClick(channel)}
              className={`w-full flex items-center px-2 py-1 rounded text-sm transition-colors ${
                currentChannel?.id === channel.id
                  ? 'bg-discord-600 text-white'
                  : 'text-gray-300 hover:bg-gray-700 hover:text-white'
              }`}
            >
              {channel.type === 'text' ? (
                <ChatBubbleLeftIcon className="w-4 h-4 mr-2" />
              ) : (
                <SpeakerWaveIcon className="w-4 h-4 mr-2" />
              )}
              {channel.name}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
} 