/**
 * ToastContainer - Displays toast notifications
 */

import React from 'react';
import { Toast } from '../hooks/useToast';

interface ToastContainerProps {
  toasts: Toast[];
  onRemove: (id: string) => void;
}

const ToastContainer: React.FC<ToastContainerProps> = ({ toasts, onRemove }) => {
  if (toasts.length === 0) return null;

  const getToastColor = (type: string) => {
    switch (type) {
      case 'success':
        return 'bg-green-500 text-white';
      case 'error':
        return 'bg-red-500 text-white';
      case 'info':
        return 'bg-blue-500 text-white';
      default:
        return 'bg-slate-700 text-white';
    }
  };

  const getIcon = (type: string) => {
    switch (type) {
      case 'success':
        return 'check_circle';
      case 'error':
        return 'error';
      case 'info':
        return 'info';
      default:
        return 'notifications';
    }
  };

  return (
    <div className="fixed top-4 right-4 z-50 space-y-2">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`flex items-center gap-3 px-4 py-3 rounded-xl shadow-lg ${getToastColor(toast.type)} min-w-[300px] max-w-md animate-slide-in`}
        >
          <span className="material-icons">{getIcon(toast.type)}</span>
          <p className="flex-1 text-sm font-medium">{toast.message}</p>
          <button
            onClick={() => onRemove(toast.id)}
            className="shrink-0 hover:bg-white/20 rounded p-1 transition"
          >
            <span className="material-icons text-sm">close</span>
          </button>
        </div>
      ))}
    </div>
  );
};

export default ToastContainer;
