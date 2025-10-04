import React from 'react';
import { User } from '@/types';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';

interface P2PCallUIProps {
  caller: User;
  callee: User;
  onAccept: () => void;
  onDecline: () => void;
}

const P2PCallUI: React.FC<P2PCallUIProps> = ({ caller, callee, onAccept, onDecline }) => {
  return (
    <div className="fixed inset-0 bg-gray-800 bg-opacity-75 flex items-center justify-center z-50">
      <div className="bg-gray-900 rounded-lg p-8 max-w-sm w-full text-center">
        <h2 className="text-2xl font-bold text-white mb-4">Входящий звонок...</h2>
        <div className="flex justify-center items-center space-x-4 mb-6">
          <Avatar className="w-24 h-24 border-4 border-gray-700">
            <AvatarImage src={caller.avatar_url} alt={caller.username} />
            <AvatarFallback>{caller.username[0]}</AvatarFallback>
          </Avatar>
          <Avatar className="w-24 h-24 border-4 border-gray-700">
            <AvatarImage src={callee.avatar_url} alt={callee.username} />
            <AvatarFallback>{callee.username[0]}</AvatarFallback>
          </Avatar>
        </div>
        <p className="text-lg text-gray-300 mb-6">
          <span className="font-semibold">{caller.username}</span> звонит вам
        </p>
        <div className="flex justify-center space-x-4">
          <button
            onClick={onAccept}
            className="bg-green-500 hover:bg-green-600 text-white font-bold py-2 px-4 rounded-full"
          >
            Принять
          </button>
          <button
            onClick={onDecline}
            className="bg-red-500 hover:bg-red-600 text-white font-bold py-2 px-4 rounded-full"
          >
            Отклонить
          </button>
        </div>
      </div>
    </div>
  );
};

export default P2PCallUI;
