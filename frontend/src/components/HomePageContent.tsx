'use client'

import { useState, useEffect, useMemo } from 'react'
import { Users, MessageSquare, Settings, Check, X, Phone } from 'lucide-react'
import { User, FriendRequest } from '../types'
import friendService from '../services/friendService'
import websocketService from '../services/websocketService'
import { DirectMessageArea } from './DirectMessageArea'
import { UserAvatar } from './ui/user-avatar'
import { VoiceOverlay } from './VoiceOverlay'
import p2pVoiceService from '../services/p2pVoiceService'
import P2PCallUI from './P2PCallUI'
import P2POutgoingCallUI from './P2POutgoingCallUI'
import soundService from '../services/soundService'
import authService from '../services/authService'

type Tab = 'online' | 'all' | 'pending' | 'blocked'

export function HomePageContent() {
  const [activeTab, setActiveTab] = useState<Tab>('all')
  const [friends, setFriends] = useState<User[]>([])
  const [pendingRequests, setPendingRequests] = useState<any[]>([])
  const [isAddFriendModalOpen, setIsAddFriendModalOpen] = useState(false)
  const [friendUsername, setFriendUsername] = useState('')
  const [addFriendError, setAddFriendError] = useState('')
  const [selectedFriend, setSelectedFriend] = useState<User | null>(null)
  
  const [currentCall, setCurrentCall] = useState<any>(null);
  const [isIncomingCall, setIsIncomingCall] = useState(false);
  const [isOutgoingCall, setIsOutgoingCall] = useState(false);
  const [caller, setCaller] = useState<User | null>(null);
  const [callee, setCallee] = useState<User | null>(null);
  const [currentUser, setCurrentUser] = useState<User | null>(null);

  const sortedFriends = useMemo(() => {
    return [...friends].sort((a, b) => {
      if (a.is_online && !b.is_online) return -1;
      if (!a.is_online && b.is_online) return 1;
      return a.username.localeCompare(b.username);
    });
  }, [friends]);

  useEffect(() => {
    const getcurrentUser = async () => {
      const user = await authService.getCurrentUser()
      setCurrentUser(user)
    }

    getcurrentUser()
  }, [])
  
  useEffect(() => {
    const handleIncomingCall = (callerId: number) => {
      if (!currentUser) return;
      const caller = friends.find(f => f.id === callerId);
      if (caller) {
        setCaller(caller);
        setCallee(currentUser);
        setIsIncomingCall(true);
        soundService.playRingingSound();
      }
    };

    const handleOutgoingCall = (calleeId: number) => {
      if (!currentUser) return;
      const callee = friends.find(f => f.id === calleeId);
      if (callee) {
        setCallee(callee);
        setCaller(currentUser);
        setIsOutgoingCall(true);
        soundService.playCallingSound();
      }
    };

    const handleCallAccepted = () => {
      setIsIncomingCall(false);
      setIsOutgoingCall(false);
      soundService.stopRingingSound();
      soundService.stopCallingSound();
    };

    const handleCallEnded = () => {
      setCurrentCall(null);
      setIsIncomingCall(false);
      setIsOutgoingCall(false);
      setCaller(null);
      setCallee(null);
      soundService.stopRingingSound();
      soundService.stopCallingSound();
    };

    p2pVoiceService.on('incoming_call', handleIncomingCall);
    p2pVoiceService.on('outgoing_call', handleOutgoingCall);
    p2pVoiceService.on('call_accepted', handleCallAccepted);
    p2pVoiceService.on('call_ended', handleCallEnded);

    return () => {
      p2pVoiceService.off('incoming_call', handleIncomingCall);
      p2pVoiceService.off('outgoing_call', handleOutgoingCall);
      p2pVoiceService.off('call_accepted', handleCallAccepted);
      p2pVoiceService.off('call_ended', handleCallEnded);
    };
  }, [currentUser, friends]);

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

    const handleNewFriendRequest = (newRequest: User) => {
      setPendingRequests(prev => [newRequest, ...prev]);
    };

    const handleFriendRequestAccepted = ({ user, request_id }: { user: User, request_id: number }) => {
      setFriends(prev => {
        // Avoid adding duplicate if already present from optimistic update
        if (prev.some(friend => friend.id === user.id)) {
          return prev;
        }
        return [...prev, user];
      });
      setPendingRequests(prev => prev.filter(req => req.request_id !== request_id));
    };

    const handleFriendRequestRejected = ({ request_id }: { request_id: number }) => {
      setPendingRequests(prev => prev.filter(req => req.request_id !== request_id));
    };

    const handleFriendRemoved = ({ friend_id }: { friend_id: number }) => {
      setFriends(prev => prev.filter(f => f.id !== friend_id));
    };

    websocketService.on('new_friend_request', handleNewFriendRequest);
    websocketService.on('friend_request_accepted', handleFriendRequestAccepted);
    websocketService.on('friend_request_rejected', handleFriendRequestRejected);
    websocketService.on('friend_removed', handleFriendRemoved);
    
    return () => {
      websocketService.off('new_friend_request', handleNewFriendRequest);
      websocketService.off('friend_request_accepted', handleFriendRequestAccepted);
      websocketService.off('friend_request_rejected', handleFriendRequestRejected);
      websocketService.off('friend_removed', handleFriendRemoved);
    }
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
    const requestToAccept = pendingRequests.find(req => req.request_id === requestId);
    if (!requestToAccept) return;

    try {
      await friendService.acceptFriendRequest(requestId);
      // Optimistic update
      setFriends(prevFriends => [...prevFriends, requestToAccept as User]);
      setPendingRequests(prev => prev.filter(req => req.request_id !== requestId));
    } catch (error) {
      console.error('Ошибка принятия запроса:', error);
    }
  };

  const handleRejectRequest = async (requestId: number) => {
    try {
      await friendService.rejectFriendRequest(requestId);
      setPendingRequests(prev => prev.filter(req => req.request_id !== requestId));
    } catch (error) {
      console.error('Ошибка отклонения запроса:', error);
    }
  };

  const handleCallUser = async (user: User) => {
    if (!currentUser) return;
    try {
      await p2pVoiceService.startCall(user.id);
    } catch (error) {
      console.error('Ошибка инициации звонка:', error);
    }
  };

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
                    <button 
                      onClick={(e) => { 
                        e.stopPropagation(); 
                        setSelectedFriend(friend); 
                      }} 
                      className="p-1 text-[#8e9297] hover:text-white"
                    >
                      <MessageSquare size={20} />
                    </button>
                    <button 
                      onClick={(e) => { 
                        e.stopPropagation(); 
                        handleCallUser(friend); 
                      }} 
                      className="p-1 text-[#8e9297] hover:text-white"
                    >
                      <Phone size={20} />
                    </button>
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
              Все друзья — {sortedFriends.length}
            </h3>
            {sortedFriends.length > 0 ? (
              sortedFriends.map(friend => (
                <div key={friend.id} onClick={() => setSelectedFriend(friend)} className="flex items-center justify-between p-2 hover:bg-[#393a3f] rounded-md cursor-pointer">
                  <div className="flex items-center">
                    <UserAvatar user={friend} />
                    <div className="ml-3">
                      <p className="text-white">{friend.username}</p>
                      <p className={`text-xs ${friend.is_online ? 'text-green-400' : 'text-[#8e9297]'}`}>
                        {friend.is_online ? 'В сети' : 'Не в сети'}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button 
                      onClick={(e) => { 
                        e.stopPropagation(); 
                        setSelectedFriend(friend); 
                      }} 
                      className="p-1 text-[#8e9297] hover:text-white"
                    >
                      <MessageSquare size={20} />
                    </button>
                    <button 
                      onClick={(e) => { 
                        e.stopPropagation(); 
                        handleCallUser(friend); 
                      }} 
                      className="p-1 text-[#8e9297] hover:text-white"
                    >
                      <Phone size={20} />
                    </button>
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
               pendingRequests.filter(Boolean).map(request => (
                <div key={request.request_id} className="flex items-center justify-between p-2 hover:bg-[#393a3f] rounded-md">
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
      {isIncomingCall && caller && currentUser && (
        <P2PCallUI
          caller={caller}
          callee={currentUser}
          onAccept={() => {
            soundService.stopRingingSound();
            setIsIncomingCall(false);
            p2pVoiceService.acceptCall();
          }}
          onDecline={() => {
            soundService.stopRingingSound();
            setIsIncomingCall(false);
            p2pVoiceService.stopCall();
          }}
        />
      )}

      {isOutgoingCall && callee && (
        <P2POutgoingCallUI
          callee={callee}
          onCancel={() => {
            soundService.stopCallingSound();
            setIsOutgoingCall(false);
            p2pVoiceService.stopCall();
          }}
        />
      )}

      {/* Friends List and Controls Sidebar */}
      <div className="w-64 bg-[#2c2d32] h-full flex flex-col">
        {/* Top bar for friends page */}
        <div className="flex items-center h-12 px-4 border-b border-[#212226] shadow-md flex-shrink-0">
          <div className="flex items-center">
            <Users className="w-6 h-6 text-[#8e9297] mr-2" />
            <h2 className="text-white font-semibold">Друзья</h2>
          </div>
        </div>
        <nav className="flex items-center p-2 space-x-2">
          <button onClick={() => setActiveTab('all')} className={`px-2 py-1 text-sm font-medium rounded ${activeTab === 'all' ? 'bg-[#404249] text-white' : 'text-[#8e9297] hover:bg-[#35373c] hover:text-white'}`}>Все</button>
          <div className="relative">
            <button onClick={() => setActiveTab('pending')} className={`px-2 py-1 text-sm font-medium rounded ${activeTab === 'pending' ? 'bg-[#404249] text-white' : 'text-[#8e9297] hover:bg-[#35373c] hover:text-white'}`}>Ожидание</button>
            {pendingRequests.length > 0 && (
              <span className="absolute -top-1 -right-1 bg-red-600 text-white text-xs rounded-full h-4 w-4 flex items-center justify-center font-bold">
                {pendingRequests.length}
              </span>
            )}
          </div>
         
          <button onClick={() => setIsAddFriendModalOpen(true)} className="px-2 py-1 text-sm font-medium rounded bg-[#2d7d46] text-white hover:bg-green-600">Добавить</button>
        </nav>
        <div className="p-2 overflow-y-auto">
          {renderContent()}
        </div>
      </div>

      {/* Main content area */}
      <div className="flex-1 bg-[#313338] h-screen flex flex-col">
        {selectedFriend ? (
          <DirectMessageArea friend={selectedFriend} />
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-center text-gray-400">
             <h3 className="text-xl font-bold text-white mb-4">Выберите друга</h3>
             <p>Выберите друга из списка слева, чтобы начать переписку.</p>
          </div>
        )}
      </div>

      {/* Add Friend Modal */}
      {isAddFriendModalOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
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
