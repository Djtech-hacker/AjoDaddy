import React from 'react';

interface ToastProps {
  message?: string;
  type?: 'success' | 'error' | 'warning' | 'info';
}

const Toast: React.FC<ToastProps> = ({ message, type = 'info' }) => {
  if (!message) return null;
  const colors: Record<string, string> = {
    success: 'bg-emerald-600',
    error:   'bg-red-600',
    warning: 'bg-amber-600',
    info:    'bg-gray-800',
  };
  return (
    <div className={`fixed bottom-4 right-4 ${colors[type]} text-white px-4 py-2 rounded shadow-lg`}>
      {message}
    </div>
  );
};

export default Toast;