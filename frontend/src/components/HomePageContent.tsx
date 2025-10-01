'use client'

import { useState, useEffect } from 'react'
import { Users, MessageSquare, Settings, Check, X } from 'lucide-react'
import { User } from '../types'
import friendService from '../services/friendService'
import websocketService from '../services/websocketService'
import { DirectMessageArea } from './DirectMessageArea'
import { UserAvatar } from './ui/user-avatar'

type Tab = 'online' | 'all' | 'pending' | 'blocked'

export function HomePageContent() {
  const [activeTab, setActiveTab] = useState<Tab>('all')
  const [friends, setFriends] = useState<User[]>([])
  const [pendingRequests, setPendingRequests] = useState<User[]>([])
  const [isAddFriendModalOpen, setIsAddFriendModalOpen] = useState(false)
  const [friendUsername, setFriendUsername] = useState('')
  const [addFriendError, setAddFriendError] = useState('')
  const [selectedFriend, setSelectedFriend] = useState<User | null>(null)

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [friendsData, pendingRequestsData] = await Promise.all([
          friendService.getFriends(),
          friendService.getPendingRequests(),
        ])
        setFriends(friendsData)
        setPendingRequests(pendingRequestsData)
      } catch (error) {
        console.error('Ошибка загрузки данных о друзьях:', error)
      }
    }
    fetchData()

    const handleNewFriendRequest = (event: { data: User }) => {
      setPendingRequests(prev => [event.data, ...prev]);
    };

    websocketService.on('new_friend_request', handleNewFriendRequest);
  }, [])

  const handleAddFriend = async () => {
    if (!friendUsername.trim()) return
    setAddFriendError('')
    try {
      await friendService.sendFriendRequest(friendUsername)
      setFriendUsername('')
      setIsAddFriendModalOpen(false)
      // TODO: Показать пользователю уведомление об успехе
    } catch (error: any) {
      console.error('Ошибка добавления в друзья:', error)
      setAddFriendError(error.response?.data?.detail || 'Не удалось отправить запрос')
    }
  }

  const handleAcceptRequest = async (requestId: number) => {
    try {
      const newFriend = await friendService.acceptFriendRequest(requestId)
      setFriends(prev => [...prev, newFriend])
      setPendingRequests(prev => prev.filter(req => req.request_id !== requestId))
    } catch (error) {
      console.error('Ошибка принятия запроса:', error)
    }
  }

  const handleRejectRequest = async (requestId: number) => {
    try {
      await friendService.rejectFriendRequest(requestId)
      setPendingRequests(prev => prev.filter(req => req.request_id !== requestId))
    } catch (error) {
      console.error('Ошибка отклонения запроса:', error)
    }
  }

  const renderContent = () => {
    switch (activeTab) {
      case 'online':
        const onlineFriends = friends.filter(friend => friend.is_online);
        return (
          <div>
            <h3 className="text-xs font-bold uppercase text-[#8e9297] mb-2">
              В сети — {onlineFriends.length}
            </h3>
            {onlineFriends.length > 0 ? (
              onlineFriends.map(friend => (
                <div key={friend.id} onClick={() => setSelectedFriend(friend)} className="flex items-center justify-between p-2 hover:bg-[#393a3f] rounded-md cursor-pointer">
                  <div className="flex items-center">
                    <UserAvatar user={friend} />
                    <div className="ml-3">
                      <p className="text-white">{friend.username}</p>
                      <p className="text-xs text-[#8e9297]">В сети</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button onClick={(e) => { e.stopPropagation(); setSelectedFriend(friend); }} className="p-1 text-[#8e9297] hover:text-white"><MessageSquare size={20} /></button>
                    {/* More actions button */}
                  </div>
                </div>
              ))
            ) : (
              <div className="text-center text-[#8e9297] mt-20">
                <p>Никого нет в сети.</p>
              </div>
            )}
          </div>
        )
      case 'all':
        return (
          <div>
            <h3 className="text-xs font-bold uppercase text-[#8e9297] mb-2">
              Все друзья — {friends.length}
            </h3>
            {friends.length > 0 ? (
              friends.map(friend => (
                <div key={friend.id} onClick={() => setSelectedFriend(friend)} className="flex items-center justify-between p-2 hover:bg-[#393a3f] rounded-md cursor-pointer">
                  <div className="flex items-center">
                    <UserAvatar user={friend} />
                    <div className="ml-3">
                      <p className="text-white">{friend.username}</p>
                      <p className="text-xs text-[#8e9297]">В сети</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button onClick={(e) => { e.stopPropagation(); setSelectedFriend(friend); }} className="p-1 text-[#8e9297] hover:text-white"><MessageSquare size={20} /></button>
                    {/* More actions button */}
                  </div>
                </div>
              ))
            ) : (
              <div className="text-center text-[#8e9297] mt-20">
                <p>Здесь пока никого нет. Может, стоит добавить друзей?</p>
              </div>
            )}
          </div>
        )
      case 'pending':
        return (
          <div>
            <h3 className="text-xs font-bold uppercase text-[#8e9297] mb-2">
              Входящие — {pendingRequests.length}
            </h3>
            {pendingRequests.length > 0 ? (
               pendingRequests.map(request => (
                <div key={request.id} className="flex items-center justify-between p-2 hover:bg-[#393a3f] rounded-md">
                  <div className="flex items-center">
                    <UserAvatar user={request} />
                    <div className="ml-3">
                      <p className="text-white">{request.username}</p>
                      <p className="text-xs text-[#8e9297]">Входящий запрос в друзья</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button onClick={() => handleAcceptRequest(request.request_id!)} className="w-9 h-9 flex items-center justify-center bg-gray-700 hover:bg-green-600 rounded-full text-white">
                      <Check size={20} />
                    </button>
                    <button onClick={() => handleRejectRequest(request.request_id!)} className="w-9 h-9 flex items-center justify-center bg-gray-700 hover:bg-red-600 rounded-full text-white">
                      <X size={20} />
                    </button>
                  </div>
                </div>
              ))
            ) : (
              <p className="text-center text-[#8e9297] mt-20">Нет ожидающих запросов в друзья.</p>
            )}
          </div>
        )
      default:
        return <p className="text-center text-[#8e9297] mt-20">Контент для "{activeTab}" еще не реализован.</p>
    }
  }

  return (
    <div className="flex flex-1 h-full">
      {/* Левая панель для личных сообщений */}
      <div className="w-60 bg-[#2c2d32] h-full flex flex-col p-2">
        <div className="px-3 py-2">
          <input
            type="text"
            placeholder="Найти или начать беседу"
            className="w-full bg-[#1e1f22] text-sm rounded px-2 py-1 text-white placeholder-[#8e9297] border-none focus:ring-0"
          />
        </div>
        <div className="flex-1 mt-2 space-y-1">
          <a
            href="#"
            className="flex items-center px-3 py-2 text-white bg-[#393a3f] rounded-md"
          >
            <Users className="w-5 h-5 mr-3" />
            <span className="font-medium">Друзья</span>
          </a>
          {/* ... other links */}
        </div>
      </div>

      {/* Основная область для контента */}
      <div className="flex-1 bg-[#313338] h-full flex flex-col">
        {/* Верхняя панель */}
        <div className="flex items-center h-12 px-4 border-b border-[#2c2d32] shadow-md">
          <div className="flex items-center">
            <Users className="w-6 h-6 text-[#8e9297] mr-2" />
            <h2 className="text-white font-semibold text-lg">Друзья</h2>
          </div>
          <div className="w-px h-6 bg-[#393a3f] mx-4"></div>
          <nav className="flex items-center space-x-4">
            <button onClick={() => setActiveTab('online')} className={`font-medium ${activeTab === 'online' ? 'text-white' : 'text-[#8e9297] hover:text-white'}`}>В сети</button>
            <button onClick={() => setActiveTab('all')} className={`font-medium ${activeTab === 'all' ? 'text-white' : 'text-[#8e9297] hover:text-white'}`}>Все</button>
            <div className="relative">
              <button onClick={() => setActiveTab('pending')} className={`font-medium ${activeTab === 'pending' ? 'text-white' : 'text-[#8e9297] hover:text-white'}`}>Ожидание</button>
              {pendingRequests.length > 0 && (
                <span className="absolute -top-1 -right-3 bg-red-600 text-white text-xs rounded-full h-4 w-4 flex items-center justify-center font-bold">
                  {pendingRequests.length}
                </span>
              )}
            </div>
            <button onClick={() => setActiveTab('blocked')} className={`font-medium ${activeTab === 'blocked' ? 'text-white' : 'text-[#8e9297] hover:text-white'}`}>Заблокированные</button>
            <button onClick={() => setIsAddFriendModalOpen(true)} className="bg-[#2d7d46] text-white px-3 py-1 rounded-md text-sm font-medium hover:bg-green-600">Добавить в друзья</button>
          </nav>
        </div>

        {/* Контент списка друзей */}
        {selectedFriend ? (
          <DirectMessageArea friend={selectedFriend} />
        ) : (
          <div className="flex-1 p-4 overflow-y-auto">
            {renderContent()}
          </div>
        )}
      </div>
    </div>
  )
}
        {/* Контент списка друзей */}
        <div className="flex-1 flex flex-col min-h-0">
          {selectedFriend ? (
            <DirectMessageArea friend={selectedFriend} />
          ) : (
            <div className="p-4 overflow-y-auto">
              {renderContent()}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

      {/* Модальное окно добавления в друзья */}
      {isAddFriendModalOpen && (
        <div className="absolute inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-[#313338] p-6 rounded-lg w-96">
            <h2 className="text-xl font-bold text-white mb-4">Добавить в друзья</h2>
            <p className="text-[#b5bac1] text-sm mb-4">
              Вы можете добавить друга по его имени пользователя. Не забудьте, что регистр имеет значение!
            </p>
            <input
              type="text"
              value={friendUsername}
              onChange={(e) => setFriendUsername(e.target.value)}
              placeholder="Введите имя пользователя"
              className="w-full bg-[#1e1f22] text-white rounded px-3 py-2 mb-4 border border-[#383a40] focus:ring-2 focus:ring-[#5865f2]"
            />
            {addFriendError && <p className="text-red-500 text-sm mb-4">{addFriendError}</p>}
            <div className="flex justify-end">
              <button onClick={() => setIsAddFriendModalOpen(false)} className="text-white mr-4">Отмена</button>
              <button onClick={handleAddFriend} className="bg-[#5865f2] text-white px-4 py-2 rounded">Отправить запрос</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
