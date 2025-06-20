'use client'

import { useDispatch } from 'react-redux'
import { AppDispatch } from '@/store/store'
import { logout } from '@/store/slices/authSlice'
import { ArrowRightOnRectangleIcon } from '@heroicons/react/24/outline'

interface User {
  id: number
  username: string
  email: string
}

interface UserPanelProps {
  user: User | null
}

export default function UserPanel({ user }: UserPanelProps) {
  const dispatch = useDispatch<AppDispatch>()

  const handleLogout = () => {
    dispatch(logout())
  }

  return (
    <div className="h-full flex flex-col">
      {/* Заголовок */}
      <div className="p-4 border-b border-gray-700">
        <h3 className="text-white font-semibold">Пользователи онлайн</h3>
      </div>

      {/* Список пользователей */}
      <div className="flex-1 overflow-y-auto p-2">
        <div className="space-y-2">
          {user && (
            <div className="flex items-center space-x-2 p-2 rounded bg-gray-700">
              <div className="w-8 h-8 bg-discord-600 rounded-full flex items-center justify-center text-white text-sm font-semibold">
                {user.username.charAt(0).toUpperCase()}
              </div>
              <div className="flex-1">
                <p className="text-white text-sm font-medium">{user.username}</p>
                <p className="text-gray-400 text-xs">В сети</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Панель текущего пользователя */}
      <div className="p-4 border-t border-gray-700">
        {user && (
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <div className="w-8 h-8 bg-discord-600 rounded-full flex items-center justify-center text-white text-sm font-semibold">
                {user.username.charAt(0).toUpperCase()}
              </div>
              <div>
                <p className="text-white text-sm font-medium">{user.username}</p>
                <p className="text-gray-400 text-xs">{user.email}</p>
              </div>
            </div>
            <button
              onClick={handleLogout}
              className="text-gray-400 hover:text-white transition-colors"
              title="Выйти"
            >
              <ArrowRightOnRectangleIcon className="w-5 h-5" />
            </button>
          </div>
        )}
      </div>
    </div>
  )
} 