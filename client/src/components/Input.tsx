import { forwardRef, type InputHTMLAttributes, type ReactNode, useId } from 'react'
import { cn } from '@/lib/utils'

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string
  error?: string
  icon?: ReactNode
}

const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, icon, className, ...props }, ref) => {
    const generatedId = useId()
    const inputId = props.id ?? generatedId
    const errorMessageId = error ? `${inputId}-error` : undefined
    const accessibilityProps = {
      ...(errorMessageId && { 'aria-describedby': errorMessageId }),
      ...(error && { 'aria-invalid': 'true' as const })
    }
    return (
      <div className="space-y-2">
        {label && (
          <label className="block text-sm font-medium text-gray-700" htmlFor={inputId}>
            {label}
            {props.required && <span className="text-red-500 ml-1">*</span>}
          </label>
        )}
        <div className="relative">
          {icon && (
            <div className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
              {icon}
            </div>
          )}
          <input
            ref={ref}
            id={inputId}
            className={cn(
              "w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-lg",
              "focus:outline-none focus:ring-2 focus:ring-hockia-primary focus:border-transparent",
              "transition-all duration-200",
              "placeholder:text-gray-400",
              icon && "pl-10",
              error && "border-red-500 focus:ring-red-500",
              className
            )}
            {...props}
            {...accessibilityProps}
          />
        </div>
        {error && (
          <p className="text-sm text-red-500" id={errorMessageId}>{error}</p>
        )}
      </div>
    )
  }
)

Input.displayName = 'Input'

export default Input
