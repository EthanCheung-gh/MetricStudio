import { Spinner } from '@heroui/react'

interface LoadingSpinnerProps {
  message?: string
  className?: string
}

export function LoadingSpinner({ message = 'Loading...', className = '' }: LoadingSpinnerProps) {
  return (
    <div className={`flex h-full w-full flex-col items-center justify-center gap-2 ${className}`}>
      <Spinner size="sm" />
      <p className="text-xs text-muted">{message}</p>
    </div>
  )
}
