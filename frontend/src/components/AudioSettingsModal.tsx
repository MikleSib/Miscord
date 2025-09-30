import React from 'react';
import { VoiceSettingsModal } from './VoiceSettingsModal';

interface AudioSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const AudioSettingsModal: React.FC<AudioSettingsModalProps> = ({ isOpen, onClose }) => {
  return <VoiceSettingsModal isOpen={isOpen} onClose={onClose} />;
};