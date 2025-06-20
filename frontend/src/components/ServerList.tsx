'use client'

import { Plus, Home } from 'lucide-react'
import { useStore } from '@/lib/store'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'

export function ServerList() {
  const { servers, currentServer, selectServer } = useStore()

  return (
    <div className="w-[72px] bg-card flex flex-col items-center py-3 gap-2 border-r border-border">
      {/* Home Button */}
      <Button
        variant="ghost"
        size="icon"
        className={cn(
          "w-12 h-12 rounded-full transition-all",
          !currentServer && "bg-primary text-primary-foreground"
        )}
        onClick={() => selectServer('')}
      >
        <Home className="w-5 h-5" />
      </Button>

      <div className="w-8 h-[2px] bg-border rounded-full" />

      {/* Server Icons */}
      <div className="flex flex-col gap-2">
        {servers.map((server) => (
          <Button
            key={server.id}
            variant="ghost"
            size="icon"
            className={cn(
              "w-12 h-12 rounded-full transition-all hover:rounded-2xl",
              currentServer?.id === server.id && "bg-primary text-primary-foreground rounded-2xl"
            )}
            onClick={() => selectServer(server.id)}
          >
            {server.icon ? (
              <img src={server.icon} alt={server.name} className="w-full h-full rounded-full" />
            ) : (
              <span className="text-xs font-semibold">
                {server.name.substring(0, 2).toUpperCase()}
              </span>
            )}
          </Button>
        ))}
      </div>

      <div className="w-8 h-[2px] bg-border rounded-full" />

      {/* Add Server Button */}
      <Button
        variant="ghost"
        size="icon"
        className="w-12 h-12 rounded-full transition-all hover:rounded-2xl hover:bg-primary hover:text-primary-foreground"
      >
        <Plus className="w-5 h-5" />
      </Button>
    </div>
  )
}