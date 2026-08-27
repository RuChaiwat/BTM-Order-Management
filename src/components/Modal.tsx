import type { ReactNode } from 'react'

interface ModalProps {
  title: string
  subtitle: string
  width?: number
  children: ReactNode
}

export function Modal({ title, subtitle, width = 520, children }: ModalProps) {
  return (
    <div className="modal-overlay">
      <div className="modal" style={{ width }}>
        <div style={{ padding: '22px 24px 0' }}>
          <div className="modal-title">{title}</div>
          <div className="modal-subtitle">{subtitle}</div>
        </div>
        {children}
      </div>
    </div>
  )
}

export function ModalFooter({ children }: { children: ReactNode }) {
  return <div className="modal-footer">{children}</div>
}
