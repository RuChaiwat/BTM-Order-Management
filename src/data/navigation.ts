export interface NavItem {
  id: number
  en: string
  th: string
  badge?: string
  /** route path — undefined means this screen hasn't been built yet */
  path?: string
}

export interface NavGroup {
  label: string
  items: NavItem[]
}

export const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Overview',
    items: [{ id: 1, en: 'Operations Dashboard', th: 'แดชบอร์ดปฏิบัติการ', path: '/dashboard' }],
  },
  {
    label: 'Order Core',
    items: [{ id: 2, en: 'Order Pool / Import Status', th: 'พูลออเดอร์ / สถานะนำเข้า', path: '/orders' }],
  },
  {
    label: 'Consolidation',
    items: [
      { id: 3, en: 'Matching Dashboard', th: 'แดชบอร์ดการจับคู่', path: '/matching' },
      { id: 4, en: 'Matching Analysis & Batch Review', th: 'วิเคราะห์การจับคู่ / ตรวจแบตช์', path: '/matching-analysis' },
      { id: 5, en: 'Consolidation Pick Report', th: 'รายงานหยิบรวม', path: '/consolidation-history' },
      { id: 6, en: 'Consolidation History', th: 'ประวัติการรวมออเดอร์', path: '/consolidation-history' },
    ],
  },
  {
    label: 'Picking Control',
    items: [
      { id: 7, en: 'Work Assignment', th: 'มอบหมายงาน', path: '/assignment' },
      { id: 8, en: 'Pick Completion', th: 'บันทึกผลการหยิบ (หน้างาน)', path: '/pick-completion' },
      { id: 16, en: 'Admin Verification', th: 'ตรวจสอบยืนยันโดยแอดมิน', path: '/verification' },
      { id: 9, en: 'Zone Dashboard', th: 'แดชบอร์ดโซน', path: '/zone-dashboard' },
      { id: 10, en: 'Control Tower', th: 'ศูนย์ควบคุม', path: '/control-tower' },
      { id: 11, en: 'Backlog Monitor', th: 'งานคงค้าง', path: '/backlog' },
    ],
  },
  {
    label: 'Analytics',
    items: [{ id: 12, en: 'Productivity / SLA / Short Pick', th: 'ผลิตภาพ / SLA / หยิบขาด', path: '/productivity' }],
  },
  {
    label: 'Administration',
    items: [
      { id: 13, en: 'User Management', th: 'จัดการผู้ใช้งาน', path: '/workers' },
      { id: 14, en: 'Location Master', th: 'ข้อมูลตำแหน่งจัดเก็บ', path: '/locations' },
      { id: 15, en: 'Configuration / Audit', th: 'ตั้งค่า / ตรวจสอบ', path: '/admin' },
    ],
  },
]
