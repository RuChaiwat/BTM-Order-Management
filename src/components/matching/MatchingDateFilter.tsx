'use client'

import { useRouter } from 'next/navigation'
import { DateInput } from '@/components/DateInput'

export function MatchingDateFilter({ orderDate }: { orderDate: string }) {
  const router = useRouter()
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>Order Date</span>
      <DateInput className="control" value={orderDate} onChange={(date) => router.push(`/matching?date=${date}`)} />
    </div>
  )
}
