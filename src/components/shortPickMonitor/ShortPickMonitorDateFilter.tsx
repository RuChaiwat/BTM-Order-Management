'use client'

import { useRouter } from 'next/navigation'
import { DateInput } from '@/components/DateInput'

export function ShortPickMonitorDateFilter({ date }: { date: string }) {
  const router = useRouter()
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>Date</span>
      <DateInput className="control" value={date} onChange={(d) => router.push(`/short-pick-monitor?date=${d}`)} />
    </div>
  )
}
