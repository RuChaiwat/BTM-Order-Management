import type { FormEvent, ReactNode } from 'react'

interface ModalProps {
  title: string
  subtitle: string
  width?: number
  children: ReactNode
  /** Wraps the modal in a <form> so Enter-in-a-text-field submits it -- native browser behaviour,
   * so it only fires when there's an enabled type="submit" button to submit to (ModalFooter's
   * primary action) and never for a <textarea> (Enter there just inserts a newline, as it should
   * for a multi-line Note field). Omit for a modal that's purely informational (no action to take). */
  onSubmit?: () => void
}

export function Modal({ title, subtitle, width = 520, children, onSubmit }: ModalProps) {
  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    onSubmit?.()
  }
  return (
    <div className="modal-overlay">
      <form className="modal" style={{ width }} onSubmit={handleSubmit}>
        <div style={{ padding: '22px 24px 0' }}>
          <div className="modal-title">{title}</div>
          <div className="modal-subtitle">{subtitle}</div>
        </div>
        {children}
      </form>
    </div>
  )
}

export function ModalFooter({ children }: { children: ReactNode }) {
  return <div className="modal-footer">{children}</div>
}
