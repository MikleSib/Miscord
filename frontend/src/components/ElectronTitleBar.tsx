import React from 'react';
import { Minimize2, Maximize2, X } from 'lucide-react';
import { Tooltip } from './ui/tooltip';

const ElectronTitleBar: React.FC = () => {
  // Проверяем, запущено ли приложение в Electron
  const isElectron = typeof window !== 'undefined' && window.electronAPI;

  if (!isElectron) {
    return null;
  }

  const handleMinimize = () => {
    window.electronAPI?.minimizeWindow?.();
  };

  const handleMaximize = () => {
    window.electronAPI?.maximizeWindow?.();
  };

  const handleClose = () => {
    window.electronAPI?.closeWindow?.();
  };

  return (
    <div className="electron-title-bar">
      <div className="title-bar-content">
        <div className="title-bar-drag-region">
          <span className="app-title">Miscord</span>
        </div>
        <div className="title-bar-controls">
          <Tooltip content="Свернуть">
            <button className="title-bar-button minimize-button" onClick={handleMinimize} aria-label="Свернуть">
              <Minimize2 size={12} />
            </button>
          </Tooltip>
          <Tooltip content="Развернуть">
            <button className="title-bar-button maximize-button" onClick={handleMaximize} aria-label="Развернуть">
              <Maximize2 size={12} />
            </button>
          </Tooltip>
          <Tooltip content="Закрыть">
            <button className="title-bar-button close-button" onClick={handleClose} aria-label="Закрыть">
              <X size={12} />
            </button>
          </Tooltip>
        </div>
      </div>
    </div>
  );
};

export default ElectronTitleBar;
