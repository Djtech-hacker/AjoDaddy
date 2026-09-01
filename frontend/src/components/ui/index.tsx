// ============================================================
// UI PRIMITIVES — Reusable base components
// ============================================================

import { forwardRef, ReactNode } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { clsx } from 'clsx'

// ── Button ────────────────────────────────────────────────────
interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?:  'primary' | 'secondary' | 'danger' | 'ghost' | 'lime'
  size?:     'sm' | 'md' | 'lg'
  loading?:  boolean
  fullWidth?: boolean
  children:  ReactNode
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'primary', size = 'md', loading, fullWidth, children, className, disabled, ...props }, ref) => {
    const base = 'inline-flex items-center justify-center gap-2 font-semibold rounded-xl transition-all duration-150 active:scale-[0.97] disabled:opacity-50 disabled:cursor-not-allowed'

    const variants = {
      primary:   'bg-ink text-warm hover:bg-pitch hover:shadow-dark-sm',
      secondary: 'bg-white border border-black/[0.09] text-dim hover:border-ink/30 hover:text-ink hover:shadow-card',
      danger:    'bg-red-50 border border-red-100 text-red-600 hover:bg-red-600 hover:text-white',
      ghost:     'text-dim hover:bg-sand hover:text-ink',
      lime:      'bg-lime text-ink hover:bg-lime/90 font-bold',
    }

    const sizes = {
      sm: 'h-8  px-3.5 text-[12px]',
      md: 'h-10 px-5   text-[13px]',
      lg: 'h-12 px-7   text-[14px]',
    }

    return (
      <button
        ref={ref}
        disabled={disabled || loading}
        className={clsx(base, variants[variant], sizes[size], fullWidth && 'w-full', className)}
        {...props}
      >
        {loading && <Spinner size="sm" />}
        {children}
      </button>
    )
  },
)
Button.displayName = 'Button'

// ── Input ─────────────────────────────────────────────────────
interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?:   string
  error?:   string
  hint?:    string
  leftIcon?: ReactNode
  rightIcon?: ReactNode
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, hint, leftIcon, rightIcon, className, ...props }, ref) => (
    <div className="w-full">
      {label && (
        <label className="block text-[12px] font-semibold text-dim mb-1.5">{label}</label>
      )}
      <div className="relative">
        {leftIcon && (
          <div className="absolute left-3.5 top-1/2 -translate-y-1/2 text-mist">{leftIcon}</div>
        )}
        <input
          ref={ref}
          className={clsx(
            'w-full h-11 border rounded-xl px-4 text-[13px] font-medium text-ink bg-white outline-none placeholder:text-mist transition-all duration-150',
            error
              ? 'border-red-300 focus:border-red-400 focus:ring-2 focus:ring-red-100'
              : 'border-black/[0.1] focus:border-brand focus:ring-2 focus:ring-brand/10',
            leftIcon  && 'pl-10',
            rightIcon && 'pr-10',
            className,
          )}
          {...props}
        />
        {rightIcon && (
          <div className="absolute right-3.5 top-1/2 -translate-y-1/2 text-mist">{rightIcon}</div>
        )}
      </div>
      {error && <p className="mt-1 text-[11px] text-red-500 font-medium">{error}</p>}
      {hint && !error && <p className="mt-1 text-[11px] text-mist">{hint}</p>}
    </div>
  ),
)
Input.displayName = 'Input'

// ── Select ────────────────────────────────────────────────────
interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?:   string
  error?:   string
  options:  { value: string; label: string }[]
  placeholder?: string
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ label, error, options, placeholder, className, ...props }, ref) => (
    <div className="w-full">
      {label && <label className="block text-[12px] font-semibold text-dim mb-1.5">{label}</label>}
      <select
        ref={ref}
        className={clsx(
          'w-full h-11 border rounded-xl px-4 text-[13px] font-medium text-ink bg-white outline-none appearance-none cursor-pointer transition-all duration-150',
          error
            ? 'border-red-300 focus:border-red-400'
            : 'border-black/[0.1] focus:border-brand focus:ring-2 focus:ring-brand/10',
          className,
        )}
        {...props}
      >
        {placeholder && <option value="">{placeholder}</option>}
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      {error && <p className="mt-1 text-[11px] text-red-500 font-medium">{error}</p>}
    </div>
  ),
)
Select.displayName = 'Select'

// ── Spinner ───────────────────────────────────────────────────
export function Spinner({ size = 'md', light }: { size?: 'sm' | 'md' | 'lg'; light?: boolean }) {
  const sizes = { sm: 'w-3.5 h-3.5', md: 'w-5 h-5', lg: 'w-7 h-7' }
  return (
    <svg
      className={clsx('animate-spin', sizes[size], light ? 'text-white' : 'text-brand')}
      viewBox="0 0 24 24" fill="none"
    >
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="31.4" strokeDashoffset="10" strokeLinecap="round" />
    </svg>
  )
}

// ── Badge ─────────────────────────────────────────────────────
type BadgeVariant = 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'brand'

export function Badge({ children, variant = 'neutral', dot }: {
  children: ReactNode; variant?: BadgeVariant; dot?: boolean
}) {
  const variants: Record<BadgeVariant, string> = {
    success: 'text-emerald-700 bg-emerald-50 border-emerald-100',
    warning: 'text-amber-600  bg-amber-50  border-amber-100',
    danger:  'text-red-600   bg-red-50    border-red-100',
    info:    'text-blue-600  bg-blue-50   border-blue-100',
    neutral: 'text-dim       bg-sand      border-stone',
    brand:   'text-brand     bg-brand-pale border-brand/20',
  }
  return (
    <span className={clsx(
      'inline-flex items-center gap-1 text-[10px] font-bold px-2.5 py-0.5 rounded-full border',
      variants[variant],
    )}>
      {dot && <span className="w-1.5 h-1.5 rounded-full bg-current" />}
      {children}
    </span>
  )
}

// ── Skeleton ──────────────────────────────────────────────────
export function Skeleton({ className }: { className?: string }) {
  return <div className={clsx('bg-sand rounded-lg animate-pulse', className)} />
}

export function SkeletonCard() {
  return (
    <div className="bg-white rounded-2xl border border-black/[0.06] p-5 space-y-3">
      <Skeleton className="h-4 w-1/3" />
      <Skeleton className="h-8 w-1/2" />
      <Skeleton className="h-3 w-2/3" />
    </div>
  )
}

// ── Toast ─────────────────────────────────────────────────────
export default function Toast({
  message,
  type = 'success',
}: {
  message: string
  type?: 'success' | 'error' | 'warning' | 'info'
}) {
  const styles = {
    success: 'bg-void text-white border-white/10',
    error:   'bg-red-50 text-red-700 border-red-100',
    warning: 'bg-amber-50 text-amber-700 border-amber-100',
    info:    'bg-blue-50 text-blue-700 border-blue-100',
  }
  const icons = { success: '✓', error: '✕', warning: '!', info: 'i' }

  return (
    <motion.div
      className={clsx(
        'fixed bottom-6 right-6 z-[200] flex items-center gap-3 px-4 py-3.5 rounded-2xl border shadow-card-md max-w-sm',
        styles[type],
      )}
      initial={{ opacity: 0, y: 12, scale: 0.95 }}
      animate={{ opacity: 1, y: 0,  scale: 1    }}
      exit={{    opacity: 0, y: 12, scale: 0.95 }}
      transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
    >
      <span className="w-5 h-5 rounded-full border-[1.5px] border-current flex items-center justify-center text-[10px] font-bold flex-shrink-0">
        {icons[type]}
      </span>
      <p className="text-[13px] font-medium flex-1 leading-tight">{message}</p>
    </motion.div>
  )
}

// ── Modal ─────────────────────────────────────────────────────
interface ModalProps {
  open:      boolean
  onClose:   () => void
  title:     string
  children:  ReactNode
  footer?:   ReactNode
  size?:     'sm' | 'md' | 'lg'
}

export function Modal({ open, onClose, title, children, footer, size = 'md' }: ModalProps) {
  const widths = { sm: 'max-w-sm', md: 'max-w-md', lg: 'max-w-xl' }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
        >
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
          <motion.div
            className={clsx('relative w-full bg-white rounded-2xl shadow-card-md max-h-[90vh] flex flex-col', widths[size])}
            initial={{ opacity: 0, scale: 0.95, y: 12 }}
            animate={{ opacity: 1, scale: 1,    y: 0  }}
            exit={{    opacity: 0, scale: 0.95, y: 12 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
          >
            <div className="flex items-center justify-between px-6 py-4 border-b border-black/[0.05] flex-shrink-0">
              <h3 className="text-[15px] font-bold text-ink tracking-tight">{title}</h3>
              <button onClick={onClose} className="w-7 h-7 rounded-lg hover:bg-sand transition-colors flex items-center justify-center text-mist hover:text-ink">
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                  <path d="M1 1L9 9M9 1L1 9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
                </svg>
              </button>
            </div>
            <div className="px-6 py-5 overflow-y-auto flex-1">{children}</div>
            {footer && (
              <div className="px-6 py-4 border-t border-black/[0.05] bg-warm flex justify-end gap-3 flex-shrink-0">
                {footer}
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

// ── Empty state ───────────────────────────────────────────────
export function EmptyState({ icon, title, description, action }: {
  icon?: string; title: string; description?: string; action?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
      {icon && <div className="text-4xl mb-4 opacity-40">{icon}</div>}
      <h3 className="text-[15px] font-bold text-ink mb-1.5">{title}</h3>
      {description && <p className="text-[13px] text-dim max-w-xs leading-relaxed">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}

// ── Avatar ────────────────────────────────────────────────────
export function Avatar({
  src, name, size = 'md', className,
}: { src?: string | null; name: string; size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl'; className?: string }) {
  const initials = name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)
  const sizes = { xs: 'w-6 h-6 text-[8px]', sm: 'w-8 h-8 text-[10px]', md: 'w-10 h-10 text-[12px]', lg: 'w-12 h-12 text-[14px]', xl: 'w-16 h-16 text-[18px]' }

  if (src) {
    return <img src={src} alt={name} className={clsx('rounded-full object-cover', sizes[size], className)} />
  }
  return (
    <div className={clsx('rounded-full bg-brand-pale flex items-center justify-center font-bold text-brand flex-shrink-0', sizes[size], className)}>
      {initials}
    </div>
  )
}