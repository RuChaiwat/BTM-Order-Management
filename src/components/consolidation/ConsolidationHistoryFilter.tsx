'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { DateInput } from '@/components/DateInput'
import type { ConsolidationHistorySearchField } from '@/lib/queries/consolidationHistory'

const FIELD_OPTIONS: { value: ConsolidationHistorySearchField; label: string }[] = [
  { value: 'released', label: 'Release Date' },
  { value: 'order_date', label: 'Order Date' },
  { value: 'batch_no', label: 'Batch No' },
]

export function ConsolidationHistoryFilter({ field, date, batchNo }: { field: ConsolidationHistorySearchField; date: string; batchNo: string }) {
  const router = useRouter()
  const [batchNoInput, setBatchNoInput] = useState(batchNo)

  function goTo(nextField: ConsolidationHistorySearchField, nextDate: string, nextBatchNo: string) {
    const params = new URLSearchParams({ field: nextField })
    if (nextField === 'batch_no') {
      if (nextBatchNo) params.set('q', nextBatchNo)
    } else {
      params.set('date', nextDate)
    }
    router.push(`/consolidation-history?${params.toString()}`)
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <select className="control" value={field} onChange={(e) => goTo(e.target.value as ConsolidationHistorySearchField, date, batchNoInput)}>
        {FIELD_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {field === 'batch_no' ? (
        <input
          className="control"
          placeholder="Search Batch No…"
          value={batchNoInput}
          onChange={(e) => setBatchNoInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && goTo(field, date, batchNoInput)}
          style={{ width: 200 }}
        />
      ) : (
        <DateInput className="control" value={date} onChange={(d) => goTo(field, d, batchNoInput)} />
      )}
    </div>
  )
}
