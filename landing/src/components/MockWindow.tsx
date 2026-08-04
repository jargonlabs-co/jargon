import type { ReactNode } from 'react'
import { TitlebarMark } from './BrandMark'

interface Props {
  children: ReactNode
  className?: string
  wide?: boolean
}

export function MockWindow({ children, className = '', wide }: Props) {
  return (
    <div className={`mock-window ${wide ? 'wide' : ''} ${className}`}>
      <div className="mock-titlebar">
        <div className="mock-traffic">
          <span />
          <span />
          <span />
        </div>
        <TitlebarMark />
      </div>
      <div className="mock-body">{children}</div>
    </div>
  )
}
