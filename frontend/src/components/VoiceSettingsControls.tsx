import React from 'react';
import { ChevronDown } from 'lucide-react';
import { Slider } from './ui/slider';
import { Switch } from './ui/switch';

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
}) => (
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
    <Switch checked={checked} onCheckedChange={onChange} />
  </div>
);

export const Divider = () => <div className="my-9 h-px bg-[#3f4147]" />;
