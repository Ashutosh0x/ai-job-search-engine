"use client"

import { useEffect } from "react"
import { useToast } from "./toast-provider"

interface WelcomeToastProps {
  userName?: string
  userEmail: string
  isNewUser?: boolean
}

export function WelcomeToast({ userName, userEmail, isNewUser = false }: WelcomeToastProps) {
  const { addToast } = useToast()

  useEffect(() => {
    const displayName = userName || userEmail.split("@")[0]
    const fallback = userName ? userName.charAt(0).toUpperCase() : userEmail.charAt(0).toUpperCase()

    // Add a slight delay for better UX
    const timer = setTimeout(() => {
      addToast({
        type: "success",
        title: isNewUser ? `Welcome to JobSpark AI, ${displayName}!` : `Welcome back, ${displayName}!`,
        description: isNewUser
          ? "Your account has been created successfully. Let's find your dream job together!"
          : "Great to see you again. Ready to continue your job search?",
        duration: 6000,
        avatar: {
          fallback,
          name: displayName,
        },
      })
    }, 500)

    return () => clearTimeout(timer)
  }, [userName, userEmail, isNewUser, addToast])

  return null
}

// Hook for easy toast usage
export function useWelcomeToast() {
  const { addToast } = useToast()

  const showWelcomeToast = (userName?: string, userEmail?: string, isNewUser = false, avatarSrc?: string) => {
    if (!userEmail) return

    const displayName = userName || userEmail.split("@")[0]
    const fallback = userName ? userName.charAt(0).toUpperCase() : userEmail.charAt(0).toUpperCase()

    addToast({
      type: "success",
      title: isNewUser ? `Welcome to JobSpark AI, ${displayName}!` : `Welcome back, ${displayName}!`,
      description: isNewUser
        ? "Your account has been created successfully. Let's find your dream job together!"
        : "Great to see you again. Ready to continue your job search?",
      duration: 6000,
      avatar: {
        src: avatarSrc,
        fallback,
        name: displayName,
      },
    })
  }

  const showSuccessToast = (
    title: string,
    description?: string,
    avatar?: { src?: string; fallback: string; name?: string },
  ) => {
    addToast({
      type: "success",
      title,
      description,
      duration: 4000,
      avatar,
    })
  }

  const showErrorToast = (
    title: string,
    description?: string,
    avatar?: { src?: string; fallback: string; name?: string },
  ) => {
    addToast({
      type: "error",
      title,
      description,
      duration: 5000,
      avatar,
    })
  }

  const showInfoToast = (
    title: string,
    description?: string,
    avatar?: { src?: string; fallback: string; name?: string },
  ) => {
    addToast({
      type: "info",
      title,
      description,
      duration: 4000,
      avatar,
    })
  }

  const showWarningToast = (
    title: string,
    description?: string,
    avatar?: { src?: string; fallback: string; name?: string },
  ) => {
    addToast({
      type: "warning",
      title,
      description,
      duration: 4000,
      avatar,
    })
  }

  return { showWelcomeToast, showSuccessToast, showErrorToast, showInfoToast, showWarningToast }
}
