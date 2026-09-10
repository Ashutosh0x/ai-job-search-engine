// @/components/toast-provider.tsx
"use client"

import type React from "react"
import { createContext, useContext, useState, useCallback, useRef, useEffect } from "react" // Added useRef and useEffect
import { X, CheckCircle, AlertCircle, Info, AlertTriangle } from "lucide-react"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"

export interface Toast {
  id: string
  title?: string
  description?: string
  type?: "success" | "error" | "warning" | "info"
  duration?: number
  avatar?: {
    src?: string
    fallback: string
    name?: string
  }
}

interface ToastContextType {
  toasts: Toast[]
  addToast: (toast: Omit<Toast, "id">) => void
  removeToast: (id: string) => void
}

const ToastContext = createContext<ToastContextType | undefined>(undefined)

export function useToast() {
  const context = useContext(ToastContext)
  if (!context) {
    throw new Error("useToast must be used within a ToastProvider")
  }
  return context
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const nextId = useRef(0); // Using useRef to generate unique IDs reliably

  const addToast = useCallback((toast: Omit<Toast, "id">) => {
    // Generate a truly unique ID using a ref counter
    const id = `toast-${nextId.current++}-${Date.now()}`;
    const newToast = { ...toast, id };

    setToasts((prev) => [...prev, newToast]);

    const duration = newToast.duration || 4000;
    setTimeout(() => {
      // Use the functional update form of setToasts to ensure we get the latest state
      // and prevent issues if toasts are added/removed rapidly
      setToasts(prevToasts => prevToasts.filter((t) => t.id !== id));
    }, duration);
  }, []); // Empty dependency array because nextId.current is a ref and doesn't trigger re-renders

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id))
  }, [])


  return (
    <ToastContext.Provider value={{ toasts, addToast, removeToast }}>
      {children}
      <ToastContainer toasts={toasts} removeToast={removeToast} />
    </ToastContext.Provider>
  )
}

function ToastContainer({ toasts, removeToast }: { toasts: Toast[]; removeToast: (id: string) => void }) {
  return (
    <div className="fixed top-6 right-6 z-[100] flex flex-col gap-3 max-w-sm w-full">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onRemove={removeToast} />
      ))}
    </div>
  )
}

function ToastItem({ toast, onRemove }: { toast: Toast; onRemove: (id: string) => void }) {
  const getStyles = () => {
    switch (toast.type) {
      case "success":
        return {
          background: "bg-green-50 dark:bg-green-950/20",
          border: "border-green-100 dark:border-green-900/30",
          icon: <CheckCircle className="w-5 h-5 text-green-600 dark:text-green-400" />,
        }
      case "error":
        return {
          background: "bg-red-50 dark:bg-red-950/20",
          border: "border-red-100 dark:border-red-900/30",
          icon: <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-400" />,
        }
      case "warning":
        return {
          background: "bg-yellow-50 dark:bg-yellow-950/20",
          border: "border-yellow-100 dark:border-yellow-900/30",
          icon: <AlertTriangle className="w-5 h-5 text-yellow-600 dark:text-yellow-400" />,
        }
      case "info":
      default:
        return {
          background: "bg-blue-50 dark:bg-blue-950/20",
          border: "border-blue-100 dark:border-blue-900/30",
          icon: <Info className="w-5 h-5 text-blue-600 dark:text-blue-400" />,
        }
    }
  }

  const styles = getStyles()

  return (
    <div
      className={`
        ${styles.background} ${styles.border}
        border rounded-xl p-4 shadow-sm
        transform transition-all duration-300 ease-out
        animate-in slide-in-from-right-full
        relative group
      `}
    >
      <div className="flex items-start gap-3">
        {/* Avatar or Icon */}
        <div className="flex-shrink-0 mt-0.5">
          {toast.avatar ? (
            <div className="relative">
              <Avatar className="h-8 w-8 border-2 border-white dark:border-gray-700 shadow-sm">
                {toast.avatar.src && (
                  <AvatarImage src={toast.avatar.src || "/placeholder.svg"} alt={toast.avatar.name || "User"} />
                )}
                <AvatarFallback className="text-xs font-medium bg-gradient-to-br from-purple-500 to-pink-500 text-white">
                  {toast.avatar.fallback}
                </AvatarFallback>
              </Avatar>
              {/* Status indicator for success toasts */}
              {toast.type === "success" && (
                <div className="absolute -bottom-1 -right-1 w-4 h-4 bg-green-500 rounded-full border-2 border-white dark:border-gray-800 flex items-center justify-center">
                  <CheckCircle className="w-2.5 h-2.5 text-white" />
                </div>
              )}
            </div>
          ) : (
            styles.icon
          )}
        </div>

        <div className="flex-1 min-w-0">
          {toast.title && (
            <h4 className="text-sm font-medium text-gray-900 dark:text-white mb-1 leading-tight">{toast.title}</h4>
          )}
          {toast.description && (
            <p className="text-sm text-gray-600 dark:text-gray-300 leading-relaxed">{toast.description}</p>
          )}
        </div>

        <button
          onClick={() => onRemove(toast.id)}
          className="flex-shrink-0 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors opacity-0 group-hover:opacity-100 ml-2"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  )
}