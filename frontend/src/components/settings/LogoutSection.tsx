'use client'

import { useState } from 'react'
import { LogOut } from 'lucide-react'

import { Button } from '../ui/button'

interface LogoutSectionProps {
  onLogout: () => void
}

export function LogoutSection({ onLogout }: LogoutSectionProps) {
  const [confirming, setConfirming] = useState(false)

  return (
    <section aria-labelledby="logout-section-title" className="mt-10 border-t border-border pt-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h3 id="logout-section-title" className="text-sm font-semibold text-foreground">
            Выход из аккаунта
          </h3>
          <p className="mt-1 max-w-md text-sm leading-5 text-muted-foreground">
            Сессия на этом устройстве завершится. Для следующего входа понадобится пароль.
          </p>
        </div>

        {confirming ? (
          <div
            role="group"
            aria-label="Подтверждение выхода из аккаунта"
            className="flex w-full flex-col-reverse gap-2 sm:w-auto sm:flex-row"
          >
            <Button type="button" variant="ghost" onClick={() => setConfirming(false)}>
              Отмена
            </Button>
            <Button type="button" variant="destructive" onClick={onLogout} autoFocus>
              Да, выйти
            </Button>
          </div>
        ) : (
          <Button
            type="button"
            variant="outline"
            onClick={() => setConfirming(true)}
            className="w-full border-destructive/50 text-destructive hover:bg-destructive/10 hover:text-destructive sm:w-auto"
          >
            <LogOut className="mr-2 h-4 w-4" aria-hidden="true" />
            Выйти
          </Button>
        )}
      </div>
    </section>
  )
}
