'use client'

import { useState, useEffect, useRef } from 'react'
import { useSelector, useDispatch } from 'react-redux'
import { RootState, AppDispatch } from '@/store/store'
import { addMessage } from '@/store/slices/chatSlice'
import { PaperAirplaneIcon } from '@heroicons/react/24/outline'

export default function ChatArea() {
  const [newMessage, setNewMessage] = useState('')
  const messagesEndRef = useRef<HTMLDivElement>(null)
  
  const dispatch = useDispatch<AppDispatch>()
  const { messages } = useSelector((state: RootState) => state.chat)
  const { currentChannel } = useSelector((state: RootState) => state.channel)
  const { user } = useSelector((state: RootState) => state.auth)

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  useEffect(() => {
    scrollToBottom()
  }, [messages])

  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault()
    if (!newMessage.trim() || !currentChannel) return

    const message = {
      id: Date.now(),
      content: newMessage,
      user_id: user?.id || 0,
      channel_id: currentChannel.id,
      created_at: new Date().toISOString(),
      user: {
        username: user?.username || 'Unknown'
      }
    }

    dispatch(addMessage(message))
    setNewMessage('')
  }

  return (
    <div className="flex flex-col h-full">
      {/* Заголовок канала */}
      <div className="p-4 border-b border-gray-700 bg-gray-800">
        <h3 className="text-white font-semibold">
          {currentChannel ? `# ${currentChannel.name}` : 'Выберите канал'}
        </h3>
      </div>

      {/* Область сообщений */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((message) => (
          <div key={message.id} className="flex items-start space-x-3">
            <div className="w-8 h-8 bg-discord-600 rounded-full flex items-center justify-center text-white text-sm font-semibold">
              {message.user.username.charAt(0).toUpperCase()}
            </div>
            <div className="flex-1">
              <div className="flex items-center space-x-2">
                <span className="text-white font-semibold">{message.user.username}</span>
                <span className="text-gray-400 text-sm">
                  {new Date(message.created_at).toLocaleTimeString()}
                </span>
              </div>
              <p className="text-gray-300 mt-1">{message.content}</p>
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Форма отправки сообщения */}
      <div className="p-4 border-t border-gray-700">
        <form onSubmit={handleSendMessage} className="flex space-x-2">
          <input
            type="text"
            value={newMessage}
            onChange={(e) => setNewMessage(e.target.value)}
            placeholder="Написать сообщение..."
            className="flex-1 bg-gray-700 text-white rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-discord-500"
            disabled={!currentChannel}
          />
          <button
            type="submit"
            disabled={!newMessage.trim() || !currentChannel}
            className="bg-discord-600 text-white p-2 rounded-lg hover:bg-discord-700 focus:outline-none focus:ring-2 focus:ring-discord-500 disabled:opacity-50"
          >
            <PaperAirplaneIcon className="w-5 h-5" />
          </button>
        </form>
      </div>
    </div>
  )
} 