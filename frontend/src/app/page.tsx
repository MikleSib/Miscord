'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation';
import { ServerList } from '../components/ServerList'
import { ChannelSidebar } from '../components/ChannelSidebar'
import { ChatArea } from '../components/ChatArea'
import { UserPanel } from '../components/UserPanel'
import { VoiceOverlay } from '../components/VoiceOverlay'
import { useAuthStore } from '../store/store'
import { useStore } from '../lib/store'
import { Box, CircularProgress } from '@mui/material'

export default function Home() {
  const { isAuthenticated, isLoading } = useAuthStore()
  const { loadChannels } = useStore()
  const router = useRouter();
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  useEffect(() => {
    if (isMounted && !isLoading && !isAuthenticated) {
      router.push('/login');
    }
  }, [isAuthenticated, isLoading, router, isMounted]);

  useEffect(() => {
    if (isAuthenticated) {
      loadChannels();
    }
  }, [isAuthenticated, loadChannels]);

  if (!isMounted || isLoading || !isAuthenticated) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" height="100vh">
        <CircularProgress />
      </Box>
    )
  }
  
  return (
    <div className="flex h-screen relative">
      <ServerList />
      <ChannelSidebar />
      <div className="flex flex-col flex-1">
        <ChatArea />
        <UserPanel />
      </div>
      <VoiceOverlay />
    </div>
  )
}