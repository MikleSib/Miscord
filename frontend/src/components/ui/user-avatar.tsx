import React from 'react';
import { Avatar } from '@mui/material';

interface UserAvatarProps {
  user?: {
    username?: string;
    display_name?: string;
    avatar_url?: string | null;
  };
  size?: number;
  className?: string;
  sx?: any;
}

export const UserAvatar: React.FC<UserAvatarProps> = ({ 
  user, 
  size = 40, 
  className = "",
  sx = {}
}) => {
  const displayName = user?.display_name || user?.username || "?";
  const avatarUrl = user?.avatar_url;

  return (
    <Avatar
      src={avatarUrl || undefined}
      className={className}
      sx={{
        width: size,
        height: size,
        fontSize: `${size * 0.4}px`,
        fontWeight: 600,
        backgroundColor: avatarUrl ? 'transparent' : 'rgb(88, 101, 242)',
        ...sx
      }}
    >
      {!avatarUrl && displayName[0]?.toUpperCase()}
    </Avatar>
  );
}; 