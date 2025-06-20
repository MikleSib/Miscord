'use client'

import { useState, useEffect } from 'react'
import { ServerList } from '../components/ServerList'
import { ChannelSidebar } from '../components/ChannelSidebar'
import { ChatArea } from '../components/ChatArea'
import { UserPanel } from '../components/UserPanel'
import { LoginDialog } from '../components/LoginDialog'
import { useStore } from '../lib/store'
import { useAuthStore } from '../store/store'
import authService from '../services/authService'
import { CircularProgress, Box } from '@mui/material'

export default function Home() {
  const { user, setUser } = useStore()
  const { token, setToken, logout } = useAuthStore()
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const checkUser = async () => {
      const storedToken = authService.getToken()
      if (storedToken) {
        setToken(storedToken)
        try {
          const currentUser = await authService.getCurrentUser()
          setUser(currentUser)
        } catch (error) {
          logout()
        }
      }
      setLoading(false)
    }

    checkUser()
  }, [setToken, setUser, logout])

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" height="100vh">
        <CircularProgress />
      </Box>
    )
  }

  if (!user) {
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