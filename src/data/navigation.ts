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
      { id: 5, en: 'Consolidation Pick Report', th: 'รายงานหยิบรวม', path: '/consolidation-pick-report' },
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
      { id: 11, en: 'Pending Actions Monitor', th: 'รายการที่ต้องดำเนินการ', path: '/backlog' },
      { id: 20, en: 'Print & Reprint', th: 'พิมพ์ / พิมพ์ซ้ำเอกสาร', path: '/print-reprint' },
    ],
  },
  {
    label: 'Packing Control',
    items: [
      { id: 21, en: 'Packing Dashboard', th: 'แดชบอร์ดงานแพ็ก', path: '/packing-dashboard' },
      { id: 22, en: 'Live Packing Monitor', th: 'ติดตามการแพ็กแบบเรียลไทม์', path: '/pack-monitor' },
      { id: 23, en: 'Admin Pack Verify', th: 'ยืนยันการแพ็ก (แอดมิน)', path: '/pack-verification' },
      { id: 24, en: 'Pack Issue Investigation', th: 'ตรวจสอบปัญหาจากการแพ็ก', path: '/pack-issues' },
      { id: 25, en: 'Packing Productivity', th: 'ประสิทธิผลงานแพ็กรายวัน', path: '/packing-productivity' },
      { id: 26, en: 'Pack Issue Dashboard', th: 'แดชบอร์ดปัญหาการแพ็ก', path: '/pack-issue-dashboard' },
      { id: 27, en: 'Pack Settings', th: 'ตั้งค่างานแพ็ก (Station / ปัญหา)', path: '/pack-settings' },
    ],
  },
  {
    label: 'Analytics',
    items: [
      { id: 12, en: 'Productivity & SLA', th: 'ประสิทธิผล / คุณภาพการให้บริการ', path: '/productivity' },
      { id: 19, en: 'Product Issue List', th: 'รายการสินค้ามีปัญหา', path: '/short-pick-monitor' },
    ],
  },
  {
    label: 'Administration',
    items: [
      { id: 13, en: 'User Management', th: 'จัดการผู้ใช้งาน', path: '/workers' },
      { id: 17, en: 'Picker & Packer Management', th: 'จัดการพนักงานหยิบ / แพ็กสินค้า', path: '/pickers' },
      { id: 14, en: 'Location Master', th: 'ข้อมูลตำแหน่งจัดเก็บ', path: '/locations' },
      { id: 15, en: 'Configuration', th: 'ตั้งค่าระบบ', path: '/admin' },
      { id: 18, en: 'Audit Trail', th: 'ประวัติการตรวจสอบ', path: '/audit-trail' },
    ],
  },
]
