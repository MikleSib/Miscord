import React, { useRef, useCallback, useState } from 'react';

interface SliderProps {
  value: number[];
  onValueChange: (value: number[]) => void;
  min?: number;
  max?: number;
  step?: number;
  className?: string;
  disabled?: boolean;
  'aria-label'?: string;
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
}) => {
  const sliderRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  const getPercentage = useCallback((val: number) => {
    return ((val - min) / (max - min)) * 100;
  }, [min, max]);

  const getValueFromPercentage = useCallback((percentage: number) => {
    const rawValue = (percentage / 100) * (max - min) + min;
    const steppedValue = Math.round(rawValue / step) * step;
    return Math.max(min, Math.min(max, steppedValue));
  }, [min, max, step]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (disabled) return;
    
    setIsDragging(true);
    handleMove(e);
  }, [disabled]);

  const handleMove = useCallback((e: MouseEvent | React.MouseEvent) => {
    if (disabled) return;
    
    if (!sliderRef.current) return;

    const rect = sliderRef.current.getBoundingClientRect();
    const percentage = Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100));
    const newValue = getValueFromPercentage(percentage);
    
    onValueChange([newValue]);
  }, [disabled, getValueFromPercentage, onValueChange]);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (isDragging) {
      handleMove(e);
    }
  }, [isDragging, handleMove]);

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  React.useEffect(() => {
    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      
      return () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [isDragging, handleMouseMove, handleMouseUp]);

  const handleClick = useCallback((e: React.MouseEvent) => {
    if (disabled) return;
    handleMove(e);
  }, [disabled, handleMove]);

  const percentage = getPercentage(value[0]);

  return (
    <div
      ref={sliderRef}
      role="slider"
      aria-label={ariaLabel}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value[0]}
      className={`relative h-2 bg-gray-700 rounded-full cursor-pointer select-none ${className} ${
        disabled ? 'opacity-50 cursor-not-allowed' : ''
      }`}
      onMouseDown={handleMouseDown}
      onClick={handleClick}
    >
      {/* Track */}
      <div className="absolute inset-0 bg-gray-700 rounded-full" />
      
      {/* Active track */}
      <div
        className="absolute top-0 left-0 h-full bg-blue-500 rounded-full transition-all duration-100"
        style={{ width: `${percentage}%` }}
      />
      
      {/* Thumb */}
      <div
        className={`absolute top-1/2 w-4 h-4 bg-white rounded-full shadow-lg transform -translate-y-1/2 transition-all duration-100 ${
          disabled ? 'cursor-not-allowed' : 'cursor-grab hover:scale-110'
        } ${isDragging ? 'cursor-grabbing scale-110' : ''}`}
        style={{ left: `${percentage}%`, marginLeft: '-8px' }}
      />
    </div>
  );
};
