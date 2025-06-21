'use client'

import { useState, useRef, useEffect } from 'react'
import { Send, Hash } from 'lucide-react'
import { useStore } from '../lib/store'
import { useAuthStore } from '../store/store'
import { formatDate } from '../lib/utils'
import { Button } from './ui/button'

export function ChatArea() {
  const { currentChannel, messages, sendMessage, addMessage } = useStore()
  const { user } = useAuthStore()
  const [messageInput, setMessageInput] = useState('')
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const channelMessages = currentChannel ? messages[currentChannel.id] || [] : []

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [channelMessages])

  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault()
    if (messageInput.trim() && currentChannel && user && currentChannel.type === 'text') {
      // Отправляем сообщение через store
      sendMessage(messageInput)
      setMessageInput('')
    }
  }

  if (!currentChannel) {
    return (
      <div className="flex-1 bg-background flex items-center justify-center">
        <div className="text-muted-foreground text-center">
          <p className="text-2xl mb-2">Добро пожаловать!</p>
          <p>Выберите канал для начала общения</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 bg-background flex flex-col">
      {/* Channel Header */}
      <div className="h-12 px-4 flex items-center border-b border-border">
        <Hash className="w-5 h-5 text-muted-foreground mr-2" />
        <span className="font-semibold">{currentChannel.name}</span>
      </div>

      {/* Messages Area */}
      <div className="flex-1 overflow-y-auto scrollbar-thin">
        <div className="p-4 space-y-4">
          {channelMessages.length === 0 ? (
            <div className="text-center text-muted-foreground py-8">
              <p>Пока что здесь нет сообщений</p>
              <p className="text-sm">Начните общение в канале #{currentChannel.name}</p>
            </div>
          ) : (
            channelMessages.map((message) => (
              <div key={message.id} className="flex gap-3 hover:bg-accent/5 px-2 py-1 rounded">
                <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0">
                  {message.author.avatar ? (
                    <img src={message.author.avatar} alt="" className="w-full h-full rounded-full" />
                  ) : (
                    <span className="text-sm font-semibold">
                      {message.author.username[0].toUpperCase()}
                    </span>
                  )}
                </div>
                <div className="flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="font-semibold text-sm">
                      {message.author.username}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {formatDate(message.timestamp)}
                    </span>
                  </div>
                  <p className="text-sm mt-0.5">{message.content}</p>
                </div>
              </div>
            ))
          )}
          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Message Input */}
      {currentChannel.type === 'text' && (
        <form onSubmit={handleSendMessage} className="p-4">
          <div className="bg-secondary rounded-lg flex items-center px-4">
            <input
              type="text"
              value={messageInput}
              onChange={(e) => setMessageInput(e.target.value)}
              placeholder={`Написать в #${currentChannel.name}`}
              className="flex-1 bg-transparent py-3 outline-none text-sm"
            />
            <Button
              type="submit"
              size="icon"
              variant="ghost"
              className="h-8 w-8"
              disabled={!messageInput.trim()}
            >
              <Send className="w-4 h-4" />
            </Button>
          </div>
        </form>
      )}

      {/* Voice Channel Info */}
      {currentChannel.type === 'voice' && (
        <div className="p-4 text-center text-muted-foreground">
          <p>Голосовой канал: {currentChannel.name}</p>
          <p className="text-sm">Нажмите на канал для подключения к голосовому чату</p>
        </div>
      )}
    </div>
  )
}