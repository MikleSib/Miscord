import React from 'react';
import { ChevronDown } from 'lucide-react';
import { Slider } from './ui/slider';
import { Switch } from './ui/switch';
import { meterLevelToDbfs } from './voiceSensitivityMeter';

interface DeviceSelectProps {
  icon: React.ReactNode;
  label: string;
  value: string;
  devices: MediaDeviceInfo[];
  onChange: (value: string) => void;
}

export const DeviceSelect: React.FC<DeviceSelectProps> = ({
  icon,
  label,
  value,
  devices,
  onChange,
}) => {
  const selectionAvailable = value === 'default'
    || devices.some((device) => device.deviceId === value);
  return (
    <label className="block">
      <span className="mb-2 block text-xs font-bold uppercase text-[#b5bac1]">
        {label}
      </span>
      <span className="relative flex h-10 items-center rounded-md bg-[#1e1f22]">
        <span className="pointer-events-none absolute left-3 text-[#b5bac1]">
          {icon}
        </span>
        <select
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="h-full w-full appearance-none bg-transparent pl-9 pr-9 text-sm text-[#dbdee1] outline-none"
        >
          <option value="default">По умолчанию</option>
          {!selectionAvailable && (
            <option value={value}>Сохранённое устройство недоступно</option>
          )}
          {devices
            .filter((device) => device.deviceId !== 'default')
            .map((device, index) => (
              <option key={device.deviceId} value={device.deviceId}>
                {device.label || `Устройство ${index + 1}`}
              </option>
            ))}
        </select>
        <ChevronDown
          size={16}
          className="pointer-events-none absolute right-3 text-[#b5bac1]"
        />
      </span>
    </label>
  );
};

interface LabeledSliderProps {
  label: string;
  value: number;
  min?: number;
  max?: number;
  onChange: (value: number) => void;
}

export const LabeledSlider: React.FC<LabeledSliderProps> = ({
  label,
  value,
  min = 0,
  max = 100,
  onChange,
}) => (
  <label className="block">
    <span className="mb-2 block text-xs font-bold uppercase text-[#b5bac1]">
      {label}
    </span>
    <Slider
      min={min}
      max={max}
      value={[value]}
      onValueChange={(values) => onChange(values[0] ?? value)}
    />
  </label>
);

interface SensitivitySliderProps {
  value: number;
  onChange: (value: number) => void;
  inputLevel?: number;
  monitoring?: boolean;
  gateOpen?: boolean;
}

export const SensitivitySlider: React.FC<SensitivitySliderProps> = ({
  value,
  onChange,
  inputLevel = 0,
  monitoring = false,
  gateOpen,
}) => {
  const normalized = Math.max(0, Math.min(100, value));
  const inputDbfs = meterLevelToDbfs(inputLevel);
  const inputPosition = inputDbfs + 100;
  const isPassing = gateOpen ?? inputDbfs >= normalized - 100;
  return (
    <label className="block py-1">
      <span className="mb-3 flex items-center justify-between gap-4 text-sm">
        <span className="font-semibold text-[#dbdee1]">Порог передачи</span>
        <span className="tabular-nums text-[#b5bac1]">{normalized - 100} dBFS</span>
      </span>
      <span className="group relative block h-6">
        <span
          aria-hidden="true"
          className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full"
          style={{
            background: `linear-gradient(to right, #f0b232 0 ${normalized}%, #23a55a ${normalized}% 100%)`,
          }}
        />
        {monitoring && (
          <>
            <span
              aria-hidden="true"
              className={`absolute left-0 top-1/2 h-1 -translate-y-1/2 rounded-full ${
                isPassing ? 'bg-[#57f287]' : 'bg-[#ffd166]'
              }`}
              style={{ width: `${inputPosition}%` }}
            />
            <span
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 z-10 h-3 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white"
              style={{ left: `${inputPosition}%` }}
            />
          </>
        )}
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={normalized}
          onChange={(event) => onChange(Number(event.currentTarget.value))}
          aria-label="Порог передачи микрофона"
          aria-valuetext={`${normalized - 100} децибел относительно полной шкалы`}
          className="absolute inset-0 z-10 h-full w-full cursor-pointer opacity-0"
        />
        <span
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow-[0_1px_4px_rgba(0,0,0,0.55)] transition-transform group-focus-within:scale-125"
          style={{ left: `${normalized}%` }}
        />
      </span>
      <span className="mt-2 block text-sm text-[#949ba4]">
        Звук тише порога не слышен другим участникам. Небольшая задержка закрытия сохраняет окончания слов.
      </span>
      {monitoring && (
        <span className="mt-2 flex items-center gap-2 text-sm tabular-nums text-[#b5bac1]">
          <span
            aria-hidden="true"
            className={`h-2 w-2 rounded-full ${
              isPassing ? 'bg-[#57f287]' : 'bg-[#f0b232]'
            }`}
          />
          Текущий голос: {Math.round(inputDbfs)} dBFS ·{' '}
          {isPassing ? 'передаётся' : 'ниже порога'}
        </span>
      )}
    </label>
  );
};

interface SettingSwitchProps {
  title: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

export const SettingSwitch: React.FC<SettingSwitchProps> = ({
  title,
  description,
  checked,
  onChange,
}) => (
  <div className="flex items-center justify-between gap-6">
    <div>
      <p className="font-semibold text-[#dbdee1]">{title}</p>
      <p className="text-sm text-[#949ba4]">{description}</p>
    </div>
    <Switch checked={checked} onCheckedChange={onChange} aria-label={title} />
  </div>
);

export const Divider = () => <div className="my-9 h-px bg-[#3f4147]" />;
