"use client"

import {
  CircleCheckIcon,
  InfoIcon,
  Loader2Icon,
  OctagonXIcon,
  TriangleAlertIcon,
} from "lucide-react"
import { Toaster as Sonner, type ToasterProps } from "sonner"

/** Aplikasi hanya punya satu tema; next-themes tidak dipasang. */
const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      theme="light"
      richColors
      className="toaster group"
      icons={{
        success: <CircleCheckIcon className="size-4" />,
        info: <InfoIcon className="size-4" />,
        warning: <TriangleAlertIcon className="size-4" />,
        error: <OctagonXIcon className="size-4" />,
        loading: <Loader2Icon className="size-4 animate-spin" />,
      }}
      style={
        {
          "--normal-bg": "var(--color-n0)",
          "--normal-text": "var(--color-ink)",
          "--normal-border": "var(--color-n200)",
          "--success-bg": "var(--color-success-soft)",
          "--success-border": "var(--color-success-soft)",
          "--success-text": "var(--color-success)",
          "--info-bg": "var(--color-action-soft)",
          "--info-border": "var(--color-action-subtle)",
          "--info-text": "var(--color-action)",
          "--warning-bg": "var(--color-warning-soft)",
          "--warning-border": "var(--color-warning-soft)",
          "--warning-text": "var(--color-warning-text)",
          "--error-bg": "var(--color-danger-soft)",
          "--error-border": "var(--color-danger-soft)",
          "--error-text": "var(--color-danger)",
          "--border-radius": "var(--radius-md)",
        } as React.CSSProperties
      }
      {...props}
    />
  )
}

export { Toaster }