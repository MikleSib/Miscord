import React from 'react';
import { Minimize2, Maximize2, X } from 'lucide-react';

const ElectronTitleBar: React.FC = () => {
  // Проверяем, запущено ли приложение в Electron
  const isElectron = typeof window !== 'undefined' && window.electronAPI;

  if (!isElectron) {
    return null;
  }

  const handleMinimize = () => {
    window.electronAPI?.minimizeWindow();
  };

  const handleMaximize = () => {
    window.electronAPI?.maximizeWindow();
  };

  const handleClose = () => {
    window.electronAPI?.closeWindow();
  };

  return (
    <div className="electron-title-bar">
      <div className="title-bar-content">
        <div className="title-bar-drag-region">
          <span className="app-title">Miscord</span>
        </div>
        <div className="title-bar-controls">
          <button
            className="title-bar-button minimize-button"
            onClick={handleMinimize}
            title="Свернуть"
          >
            <Minimize2 size={12} />
          </button>
          <button
            className="title-bar-button maximize-button"
            onClick={handleMaximize}
            title="Развернуть"
          >
            <Maximize2 size={12} />
          </button>
          <button
            className="title-bar-button close-button"
            onClick={handleClose}
            title="Закрыть"
          >
            <X size={12} />
          </button>
        </div>
      </div>
    </div>
  );
};

export default ElectronTitleBar;
