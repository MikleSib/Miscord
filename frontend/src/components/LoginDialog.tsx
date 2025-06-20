'use client'

import { useState } from 'react'
import { useStore } from '@/lib/store'
import { Button } from '@/components/ui/button'

export function LoginDialog() {
  const [isLogin, setIsLogin] = useState(true)
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const { login, register } = useStore()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      if (isLogin) {
        await login(email, password)
      } else {
        await register(username, email, password)
      }
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Произошла ошибка')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="bg-card rounded-lg shadow-xl p-8">
          <h1 className="text-2xl font-bold text-center mb-2">
            {isLogin ? 'С возвращением!' : 'Создать аккаунт'}
          </h1>
          <p className="text-muted-foreground text-center mb-6">
            {isLogin ? 'Рады видеть вас снова!' : 'Присоединяйтесь к Miscord'}
          </p>

          <form onSubmit={handleSubmit} className="space-y-4">
            {!isLogin && (
              <div>
                <label className="block text-sm font-medium mb-2">
                  Имя пользователя
                </label>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="w-full px-4 py-2 bg-secondary rounded-md outline-none focus:ring-2 focus:ring-primary"
                  required={!isLogin}
                />
              </div>
            )}

            <div>
              <label className="block text-sm font-medium mb-2">
                Email
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-4 py-2 bg-secondary rounded-md outline-none focus:ring-2 focus:ring-primary"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">
                Пароль
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-4 py-2 bg-secondary rounded-md outline-none focus:ring-2 focus:ring-primary"
                required
              />
            </div>

            {error && (
              <div className="bg-destructive/20 text-destructive text-sm p-3 rounded-md">
                {error}
              </div>
            )}

            <Button
              type="submit"
              className="w-full"
              disabled={loading}
            >
              {loading ? 'Загрузка...' : (isLogin ? 'Войти' : 'Создать аккаунт')}
            </Button>
          </form>

          <div className="mt-6 text-center">
            <span className="text-sm text-muted-foreground">
              {isLogin ? 'Нет аккаунта?' : 'Уже есть аккаунт?'}
            </span>
            <button
              type="button"
              onClick={() => {
                setIsLogin(!isLogin)
                setError('')
              }}
              className="text-sm text-primary hover:underline ml-2"
            >
              {isLogin ? 'Зарегистрироваться' : 'Войти'}
            </button>
          </div>
        </div>

        <div className="mt-6 text-center">
          <p className="text-xs text-muted-foreground">
            Это демо-версия Miscord для тестирования
          </p>
        </div>
      </div>
    </div>
  )
}