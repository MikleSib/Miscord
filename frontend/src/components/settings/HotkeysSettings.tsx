'use client'

import { useEffect, useMemo } from 'react'
import { AlertCircle, Info, Keyboard, Plus, Trash2 } from 'lucide-react'
import { HOTKEY_ACTIONS, getConflictingHotkeyIds, type HotkeyAction } from '../../lib/hotkeys'
import { MAX_HOTKEYS, useHotkeyStore } from '../../store/hotkeyStore'
import { Button } from '../ui/button'
import { Switch } from '../ui/switch'
import { HotkeyRecorder } from './HotkeyRecorder'

export function HotkeysSettings() {
  const bindings = useHotkeyStore((state) => state.bindings)
  const addBinding = useHotkeyStore((state) => state.addBinding)
  const removeBinding = useHotkeyStore((state) => state.removeBinding)
  const setAction = useHotkeyStore((state) => state.setAction)
  const setCombination = useHotkeyStore((state) => state.setCombination)
  const setEnabled = useHotkeyStore((state) => state.setEnabled)
  const setSuspended = useHotkeyStore((state) => state.setSuspended)
  const conflicts = useMemo(() => getConflictingHotkeyIds(bindings), [bindings])

  useEffect(() => {
    setSuspended(true)
    return () => setSuspended(false)
  }, [setSuspended])

  return (
    <section className="mx-auto w-full max-w-4xl pb-10">
      <div className="flex flex-col gap-4 border-b border-border pb-6 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-2xl font-semibold text-foreground">Пользовательские горячие клавиши</h2>
          <p className="mt-2 max-w-2xl text-sm leading-5 text-muted-foreground">
            Назначьте сочетания для частых действий. Они работают, пока вкладка Miscord активна.
          </p>
        </div>
        <Button onClick={addBinding} disabled={bindings.length >= MAX_HOTKEYS} className="shrink-0">
          <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
          Добавить горячую клавишу
        </Button>
      </div>

      <div className="mt-5 flex items-start gap-3 rounded-lg border border-blue-400/70 bg-blue-400/10 px-4 py-3 text-sm text-blue-100">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-blue-300" aria-hidden="true" />
        <p>Пока открыт этот раздел, горячие клавиши отключены.</p>
      </div>

      {bindings.length === 0 ? (
        <div className="mt-6 flex min-h-56 flex-col items-center justify-center rounded-xl border border-dashed border-border px-6 text-center">
          <Keyboard className="h-10 w-10 text-muted-foreground" aria-hidden="true" />
          <h3 className="mt-4 text-base font-semibold text-foreground">Горячих клавиш пока нет</h3>
          <p className="mt-1 max-w-md text-sm text-muted-foreground">
            Добавьте первое сочетание — например, для микрофона или демонстрации экрана.
          </p>
        </div>
      ) : (
        <div className="mt-6 divide-y divide-border border-y border-border">
          {bindings.map((binding) => {
            const definition = HOTKEY_ACTIONS.find((action) => action.id === binding.action)
            const conflict = conflicts.has(binding.id)
            return (
              <div key={binding.id} className="grid gap-4 py-5 md:grid-cols-[minmax(220px,1fr)_minmax(240px,1fr)_auto] md:items-start">
                <label className="block min-w-0">
                  <span className="mb-2 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">Действие</span>
                  <select
                    value={binding.action}
                    onChange={(event) => setAction(binding.id, event.target.value as HotkeyAction)}
                    className="min-h-11 w-full rounded-lg border border-border-control bg-background px-3 text-sm text-foreground outline-none focus:ring-2 focus:ring-primary/50"
                  >
                    {HOTKEY_ACTIONS.map((action) => <option key={action.id} value={action.id}>{action.label}</option>)}
                  </select>
                  <span className="mt-2 block text-xs leading-4 text-muted-foreground">{definition?.description}</span>
                </label>

                <div className="min-w-0">
                  <span className="mb-2 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">Горячая клавиша</span>
                  <HotkeyRecorder value={binding.combination} onChange={(value) => setCombination(binding.id, value)} />
                  {conflict && (
                    <p className="mt-2 flex items-center gap-1.5 text-xs text-red-400">
                      <AlertCircle className="h-3.5 w-3.5" aria-hidden="true" />
                      Это сочетание уже используется и не будет выполнено.
                    </p>
                  )}
                </div>

                <div className="flex min-h-11 items-center justify-end gap-1 md:mt-6">
                  <button
                    type="button"
                    onClick={() => removeBinding(binding.id)}
                    aria-label={`Удалить горячую клавишу «${definition?.label ?? ''}»`}
                    className="flex h-11 w-11 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive/50"
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </button>
                  <Switch
                    variant="brand"
                    checked={binding.enabled}
                    disabled={!binding.combination}
                    onCheckedChange={(enabled) => setEnabled(binding.id, enabled)}
                    aria-label={`Включить горячую клавишу «${definition?.label ?? ''}»`}
                  />
                </div>
              </div>
            )
          })}
        </div>
      )}

      {bindings.length >= MAX_HOTKEYS && (
        <p className="mt-4 text-sm text-muted-foreground">Достигнут лимит: {MAX_HOTKEYS} горячих клавиш.</p>
      )}
    </section>
  )
}
