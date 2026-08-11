'use client'

import React, { useCallback, useMemo, useRef, useState } from 'react'

interface SliderProps {
  value: number[]
  onValueChange: (value: number[]) => void
  min?: number
  max?: number
  step?: number
  className?: string
  disabled?: boolean
  'aria-label'?: string
  'aria-valuetext'?: string
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function roundToStep(value: number, min: number, max: number, step: number) {
  const safeStep = step > 0 ? step : 1
  const steps = Math.round((value - min) / safeStep)
  const decimals = (String(safeStep).split('.')[1] || '').length
  return Number(clamp(min + steps * safeStep, min, max).toFixed(decimals))
}

export const Slider: React.FC<SliderProps> = ({
  value,
  onValueChange,
  min = 0,
  max = 100,
  step = 1,
  className = '',
  disabled = false,
  'aria-label': ariaLabel,
  'aria-valuetext': ariaValueText,
}) => {
  const sliderRef = useRef<HTMLDivElement>(null)
  const activePointerRef = useRef<number | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const currentValue = clamp(value[0] ?? min, min, max)
  const percentage = useMemo(
    () => (max === min ? 0 : ((currentValue - min) / (max - min)) * 100),
    [currentValue, max, min],
  )

  const commit = useCallback((next: number) => {
    if (disabled) return
    const normalized = roundToStep(next, min, max, step)
    if (normalized !== currentValue) onValueChange([normalized])
  }, [currentValue, disabled, max, min, onValueChange, step])

  const commitFromClientX = useCallback((clientX: number) => {
    const rect = sliderRef.current?.getBoundingClientRect()
    if (!rect || rect.width <= 0) return
    const ratio = clamp((clientX - rect.left) / rect.width, 0, 1)
    commit(min + ratio * (max - min))
  }, [commit, max, min])

  const handlePointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (disabled || event.button !== 0) return
    event.preventDefault()
    activePointerRef.current = event.pointerId
    event.currentTarget.setPointerCapture(event.pointerId)
    setIsDragging(true)
    commitFromClientX(event.clientX)
  }, [commitFromClientX, disabled])

  const handlePointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (disabled || activePointerRef.current !== event.pointerId) return
    commitFromClientX(event.clientX)
  }, [commitFromClientX, disabled])

  const finishPointer = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (activePointerRef.current !== event.pointerId) return
    activePointerRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    setIsDragging(false)
  }, [])

  const handleKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return
    const largeStep = Math.max(step, (max - min) / 10)
    let next: number | null = null
    if (event.key === 'ArrowRight' || event.key === 'ArrowUp') next = currentValue + step
    if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') next = currentValue - step
    if (event.key === 'PageUp') next = currentValue + largeStep
    if (event.key === 'PageDown') next = currentValue - largeStep
    if (event.key === 'Home') next = min
    if (event.key === 'End') next = max
    if (next === null) return
    event.preventDefault()
    commit(next)
  }, [commit, currentValue, disabled, max, min, step])

  return (
    <div
      ref={sliderRef}
      role="slider"
      tabIndex={disabled ? -1 : 0}
      aria-label={ariaLabel}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={currentValue}
      aria-valuetext={ariaValueText}
      aria-disabled={disabled || undefined}
      className={`group relative flex h-11 touch-none select-none items-center outline-none ${
        disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'
      } ${className}`}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={finishPointer}
      onPointerCancel={finishPointer}
      onKeyDown={handleKeyDown}
    >
      <div className="relative h-2 w-full overflow-visible rounded-full bg-border-control">
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-primary"
          style={{ width: `${percentage}%` }}
        />
        <span
          aria-hidden="true"
          className={`absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow-[0_1px_4px_rgba(0,0,0,0.45)] transition-transform duration-150 group-focus-visible:ring-4 group-focus-visible:ring-primary/35 ${
            isDragging ? 'scale-110' : 'group-hover:scale-105'
          }`}
          style={{ left: `${percentage}%` }}
        />
      </div>
    </div>
  )
}
