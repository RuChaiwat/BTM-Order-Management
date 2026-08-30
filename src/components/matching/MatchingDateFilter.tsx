'use client'

import { useRouter } from 'next/navigation'

export function MatchingDateFilter({ orderDate }: { orderDate: string }) {
  const router = useRouter()
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>Order Date</span>
      <input type="date" className="control" value={orderDate} onChange={(e) => router.push(`/matching?date=${e.target.value}`)} />
    </div>
  )
}
