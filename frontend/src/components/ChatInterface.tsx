'use client'

import { useEffect } from 'react'
import { useSelector } from 'react-redux'
import { RootState } from '@/store/store'
import ChannelSidebar from './ChannelSidebar'
import ChatArea from './ChatArea'
import UserPanel from './UserPanel'

export default function ChatInterface() {
  const { user } = useSelector((state: RootState) => state.auth)

  return (
    <div className="h-screen flex bg-gray-900">
      {/* Боковая панель с каналами */}
      <div className="w-64 bg-gray-800 flex flex-col">
        <ChannelSidebar />
      </div>

      {/* Основная область чата */}
      <div className="flex-1 flex flex-col">
        <ChatArea />
      </div>

      {/* Панель пользователя */}
      <div className="w-64 bg-gray-800">
        <UserPanel user={user} />
      </div>
    </div>
  )
} 