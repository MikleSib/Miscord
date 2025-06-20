'use client'

import { Settings, LogOut, Mic, Headphones } from 'lucide-react'
import { useStore } from '@/lib/store'
import { Button } from '@/components/ui/button'

export function UserPanel() {
  const { user, logout } = useStore()

  if (!user) return null

  return (
    <div className="absolute bottom-0 left-[72px] w-60 h-[52px] bg-card border-t border-border px-2 flex items-center justify-between">
      <div className="flex items-center gap-2">
        <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center">
          {user.avatar ? (
            <img src={user.avatar} alt="" className="w-full h-full rounded-full" />
          ) : (
            <span className="text-xs font-semibold">
              {user.username[0].toUpperCase()}
            </span>
          )}
        </div>
        <div className="flex flex-col">
          <span className="text-sm font-semibold">{user.username}</span>
          <span className="text-xs text-muted-foreground">#{user.id.slice(0, 4)}</span>
        </div>
      </div>

      <div className="flex items-center gap-1">
        <Button variant="ghost" size="icon" className="h-8 w-8">
          <Mic className="w-4 h-4" />
        </Button>
        <Button variant="ghost" size="icon" className="h-8 w-8">
          <Headphones className="w-4 h-4" />
        </Button>
        <Button variant="ghost" size="icon" className="h-8 w-8">
          <Settings className="w-4 h-4" />
        </Button>
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={logout}>
          <LogOut className="w-4 h-4" />
        </Button>
      </div>
    </div>
  )
}