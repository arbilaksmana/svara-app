"use client"

import * as React from "react"
import { cn } from "@/lib/utils"
import { CheckIcon } from "lucide-react"
import { Checkbox as CheckboxPrimitive } from "radix-ui"
import { Label } from "./label"

function Checkbox({
  className,
  ...props
}: React.ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        "peer size-4 shrink-0 rounded-[4px] border border-input shadow-xs transition-shadow outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground dark:bg-input/30 dark:aria-invalid:ring-destructive/40 dark:data-[state=checked]:bg-primary",
        className
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator
        data-slot="checkbox-indicator"
        className="grid place-content-center text-current transition-none"
      >
        <CheckIcon className="size-3.5" />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )
}

/**
 * Kotak centang + label 44px untuk formulir admin. Kontrak lama (id, label, checked,
 * onChange boolean, aria-*) dipertahankan; primitifnya Checkbox shadcn (Radix).
 */
function CheckboxField({
  id,
  label,
  checked,
  onChange,
  disabled,
  invalid,
  describedBy,
}: {
  id: string
  label: React.ReactNode
  checked: boolean
  onChange: (next: boolean) => void
  disabled?: boolean
  invalid?: boolean
  describedBy?: string
}) {
  return (
    <div className="flex min-h-11 items-center gap-3">
      <Checkbox
        id={id}
        checked={checked}
        disabled={disabled}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        onCheckedChange={(value) => onChange(value === true)}
      />
      <Label
        htmlFor={id}
        className={cn("cursor-pointer py-2.5 text-sm font-normal", disabled && "text-muted-foreground")}
      >
        {label}
      </Label>
    </div>
  )
}

export { Checkbox, CheckboxField }
