'use client'

import { useState, useEffect } from 'react'
import { ServerList } from '@/components/ServerList'
import { ChannelSidebar } from '@/components/ChannelSidebar'
import { ChatArea } from '@/components/ChatArea'
import { UserPanel } from '@/components/UserPanel'
import { LoginDialog } from '@/components/LoginDialog'
import { useStore } from '@/lib/store'

export default function Home() {
  const [mounted, setMounted] = useState(false)
  const { user, isAuthenticated } = useStore()

  useEffect(() => {
    setMounted(true)
  }, [])

  if (!mounted) {
    return null
  }

  if (!isAuthenticated) {
    return <LoginDialog />
  }

  return (
    <div className="flex h-screen">
      {/* Server List */}
      <ServerList />
      
      {/* Channel Sidebar */}
      <ChannelSidebar />
      
      {/* Main Chat Area */}
      <ChatArea />
      
      {/* User Panel */}
      <UserPanel />
    </div>
  )
}