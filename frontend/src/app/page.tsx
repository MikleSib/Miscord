'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation';
import { ServerList } from '../components/ServerList'
import { ChannelSidebar } from '../components/ChannelSidebar'
import { ChatArea } from '../components/ChatArea'
import { UserPanel } from '../components/UserPanel'
import { useAuthStore } from '../store/store'
import { useStore } from '../lib/store'
import { Box, CircularProgress } from '@mui/material'

export default function Home() {
  const { isAuthenticated, isLoading } = useAuthStore()
  const { loadChannels } = useStore()
  const router = useRouter();

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.push('/login');
    }
  }, [isAuthenticated, isLoading, router]);

  useEffect(() => {
    if (isAuthenticated) {
      loadChannels();
    }
  }, [isAuthenticated, loadChannels]);
  
  if (isLoading || !isAuthenticated) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" height="100vh">
        <CircularProgress />
      </Box>
    )
  }
  
  return (
    <div className="flex h-screen">
      <ServerList />
      <ChannelSidebar />
      <div className="flex flex-col flex-1">
        <ChatArea />
        <UserPanel />
      </div>
    </div>
  )
}