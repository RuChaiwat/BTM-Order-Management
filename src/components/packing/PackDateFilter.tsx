'use client'

import { useRouter } from 'next/navigation'
import { DateInput } from '@/components/DateInput'

/** Date filter for the Packing report pages: one date (`date`) or a range (`from`/`to`), pushed
 * back as search params on `basePath`. */
export function PackDateFilter({ basePath, date, from, to }: { basePath: string; date?: string; from?: string; to?: string }) {
  const router = useRouter()
  if (date !== undefined) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>Date</span>
        <DateInput className="control" value={date} onChange={(d) => router.push(`${basePath}?date=${d}`)} />
      </div>
    )
  }
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>From</span>
      <DateInput className="control" value={from ?? ''} onChange={(d) => router.push(`${basePath}?from=${d}&to=${to ?? d}`)} />
      <span style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>To</span>
      <DateInput className="control" value={to ?? ''} onChange={(d) => router.push(`${basePath}?from=${from ?? d}&to=${d}`)} />
    </div>
  )
}
