"use client"

import { useState, useCallback } from "react"
import { useToast } from "@/hooks/use-toast"
import {
  Toast,
  ToastClose,
  ToastDescription,
  ToastProvider,
  ToastTitle,
  ToastViewport,
} from "@/components/ui/toast"
import { Copy, Check } from "lucide-react"

export function Toaster() {
  const { toasts } = useToast()
  const [copiedId, setCopiedId] = useState<string | null>(null)

  const handleCopy = useCallback(async (id: string, title?: string, description?: React.ReactNode) => {
    const textParts: string[] = []
    if (title) textParts.push(title)
    if (description) {
      // Handle both string and ReactNode descriptions
      const descText = typeof description === 'string'
        ? description
        : String(description)
      textParts.push(descText)
    }
    const text = textParts.join('\n')

    try {
      await navigator.clipboard.writeText(text)
      setCopiedId(id)
      setTimeout(() => setCopiedId(null), 2000)
    } catch (err) {
      console.error('Failed to copy:', err)
    }
  }, [])

  return (
    <ToastProvider>
      {toasts.map(function ({ id, title, description, action, variant, ...props }) {
        const isDestructive = variant === 'destructive'
        const isCopied = copiedId === id

        return (
          <Toast key={id} variant={variant} {...props}>
            <div className="grid gap-1 flex-1">
              {title && <ToastTitle>{title}</ToastTitle>}
              {description && (
                <ToastDescription>{description}</ToastDescription>
              )}
            </div>
            {isDestructive && (
              <button
                onClick={() => handleCopy(id, title, description)}
                className="shrink-0 p-1.5 rounded-md hover:bg-destructive-foreground/10 transition-colors"
                title={isCopied ? "Copied!" : "Copy error to clipboard"}
              >
                {isCopied ? (
                  <Check className="h-4 w-4 text-green-300" />
                ) : (
                  <Copy className="h-4 w-4 text-destructive-foreground/70 hover:text-destructive-foreground" />
                )}
              </button>
            )}
            {action}
            <ToastClose />
          </Toast>
        )
      })}
      <ToastViewport />
    </ToastProvider>
  )
}
