'use client'

import { useState, useEffect, useRef } from 'react'
import { Message, User } from '../types'
import directMessageService from '../services/directMessageService'
import websocketService from '../services/websocketService'
import { useAuthStore } from '../store/store'
import p2pVoiceService from '../services/p2pVoiceService'
import { Phone, PhoneOff } from 'lucide-react'

interface DirectMessageAreaProps {
  friend: User
}

export function DirectMessageArea({ friend }: DirectMessageAreaProps) {
  const [messages, setMessages] = useState<Message[]>([])
  const [newMessage, setNewMessage] = useState('')
  const { user } = useAuthStore()
  const messagesEndRef = useRef<null | HTMLDivElement>(null)

  useEffect(() => {
    const fetchMessages = async () => {
      try {
        const messageHistory = await directMessageService.getMessages(friend.id)
        setMessages(messageHistory)
      } catch (error) {
        console.error('Ошибка загрузки личных сообщений:', error)
      }
    }
    fetchMessages()
  }, [friend.id])

  useEffect(() => {
    // Подписка на WebSocket для получения новых сообщений
    // TODO: реализовать
    const handleNewMessage = (event: any) => {
        const message = event.detail;
        if (message.sender_id === friend.id || message.recipient_id === friend.id) {
            setMessages(prev => [...prev, message]);
        }
    };

    window.addEventListener('new_dm', handleNewMessage);
    return () => window.removeEventListener('new_dm', handleNewMessage);
  }, [friend.id])

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newMessage.trim() || !user) return

    websocketService.send({
      type: 'dm_message',
      recipient_id: friend.id,
      content: newMessage,
    });
    setNewMessage('')
  }

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }

  useEffect(scrollToBottom, [messages]);

  return (
    <div className="flex-1 flex flex-col bg-[#313338]">
      {/* Top bar */}
      <div className="flex items-center justify-between h-12 px-4 border-b border-[#2c2d32] shadow-md">
        <div className="flex items-center">
          <div className="w-8 h-8 rounded-full bg-gray-600 mr-3" />
          <h2 className="text-white font-semibold">{friend.username}</h2>
        </div>
        <div>
          <button onClick={() => p2pVoiceService.startCall(friend.id)} className="p-2 text-gray-400 hover:text-white">
            <Phone />
          </button>
          <button onClick={() => p2pVoiceService.stopCall()} className="p-2 text-gray-400 hover:text-white">
            <PhoneOff />
          </button>
        </div>
      </div>

      {/* Video streams */}
      <div className="flex">
        <video
          ref={(ref) => {
            if (ref && p2pVoiceService.localStream) {
              ref.srcObject = p2pVoiceService.localStream;
            }
          }}
          autoPlay
          muted
          className="w-1/2"
        />
        <video
          ref={(ref) => {
            if (ref && p2pVoiceService.remoteStream) {
              ref.srcObject = p2pVoiceService.remoteStream;
            }
          }}
          autoPlay
          className="w-1/2"
        />
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map(msg => (
          <div key={msg.id} className={`flex items-start gap-3 ${msg.sender_id === user?.id ? 'justify-end' : ''}`}>
             {/* Avatar, username, content */}
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="p-4">
        <form onSubmit={handleSendMessage} className="bg-[#40444b] rounded-lg px-4 py-2 flex items-center">
          <input
            type="text"
            value={newMessage}
            onChange={(e) => setNewMessage(e.target.value)}
            placeholder={`Написать @${friend.username}`}
            className="flex-1 bg-transparent text-white placeholder-gray-400 focus:outline-none"
          />
          <button type="submit" className="text-gray-400 hover:text-white">
            {/* Send icon */}
          </button>
        </form>
      </div>
    </div>
  )
}
