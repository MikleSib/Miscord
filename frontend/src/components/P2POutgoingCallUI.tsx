import React from 'react';
import { User } from '../types';
import { UserAvatar } from './ui/user-avatar';
import { PhoneOff } from 'lucide-react';

interface P2POutgoingCallUIProps {
  callee: User;
  onCancel: () => void;
}

const P2POutgoingCallUI: React.FC<P2POutgoingCallUIProps> = ({ callee, onCancel }) => {
  return (
    <div className="fixed inset-0 bg-black bg-opacity-75 flex flex-col items-center justify-center z-50">
      <div className="relative">
        <UserAvatar user={callee} className="w-40 h-40 rounded-full border-4 border-gray-600" />
      </div>
      <h2 className="text-3xl font-bold text-white mt-6">{callee.username}</h2>
      <p className="text-lg text-gray-400 mt-2">Выполняется вызов...</p>
      <div className="absolute bottom-16">
        <button
          onClick={onCancel}
          className="bg-red-600 hover:bg-red-700 text-white rounded-full w-20 h-20 flex items-center justify-center transition-transform transform hover:scale-105"
        >
          <PhoneOff size={36} />
        </button>
      </div>
    </div>
  );
};

export default P2POutgoingCallUI;
