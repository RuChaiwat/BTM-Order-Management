// Static mock data for the Beautrium OMS UI prototype (frontend-only, no backend).

export const flowSteps = [
  { label: 'Import Orders', count: '1,248', bg: '#EFF6FF', fg: '#1D4ED8' },
  { label: 'Pre-screen', count: '1,102', bg: '#F0FDF4', fg: '#15803D' },
  { label: 'Matching', count: '842', bg: '#F5F3FF', fg: '#6D28D9' },
  { label: 'Batch Split', count: '62', bg: '#FFFBEB', fg: '#B45309' },
  { label: 'Pick Report', count: '48', bg: '#FEF2F2', fg: '#B91C1C' },
  { label: 'Assignment', count: '22', bg: '#F3F4F6', fg: '#374151' },
]

export const dashboardKpis = [
  { label: 'TOTAL ORDERS', labelTh: 'ออเดอร์ทั้งหมด', value: '1,920', sub: 'New 1,800 · Backlog 120' },
  { label: 'TOTAL PIECES (PLAN)', labelTh: 'จำนวนชิ้นตามแผน', value: '119,560', sub: 'Avg 62 pcs/order' },
  { label: 'PIECES PICKED', labelTh: 'หยิบแล้ว (จริง)', value: '72,480', valueColor: '#16A34A', sub: '60.6% of plan', subColor: '#16A34A' },
  { label: 'PICKER COMPLETED', labelTh: 'ผู้หยิบปิดงานแล้ว', value: '642', sub: '100% 598 · Short 44' },
  { label: 'TOTAL BACKLOG', labelTh: 'งานคงค้าง', value: '185', valueColor: '#F59E0B', sub: 'Picking 135 · Verify 50' },
  { label: 'ACTIVE PICKERS', labelTh: 'ผู้หยิบที่ทำงานอยู่', value: '78', sub: '4,320 pcs/hr avg' },
]

export const zoneStatus = [
  { zone: 'Zone A', orders: 620, statusText: 'On track · 82.3% SLA', accent: '#16A34A', statusColor: '#16A34A' },
  { zone: 'Zone B', orders: 510, statusText: 'On track · 90.1% SLA', accent: '#16A34A', statusColor: '#16A34A' },
  { zone: 'Zone C', orders: 430, statusText: 'On track · 94.2% SLA', accent: '#16A34A', statusColor: '#16A34A' },
  { zone: 'Zone D', orders: 280, statusText: 'At risk · +1h 00m', accent: '#F59E0B', statusColor: '#B45309' },
  { zone: 'Zone E', orders: 80, statusText: 'On track · 91.7% SLA', accent: '#16A34A', statusColor: '#16A34A' },
]

export const orderStatusBreakdown = [
  { label: 'Unassigned', count: 120, pct: '6.3%', width: 6.3, color: '#9CA3AF' },
  { label: 'In Progress', count: 78, pct: '4.1%', width: 4.1, color: '#2563EB' },
  { label: 'Picker Completed', count: 642, pct: '33.4%', width: 33.4, color: '#16A34A' },
  { label: 'Waiting Verify', count: 50, pct: '2.6%', width: 2.6, color: '#F59E0B' },
  { label: 'Final Closed', count: 1030, pct: '53.6%', width: 53.6, color: '#A7F3D0' },
]

export const pickerProductivity = [
  { code: 'P002', name: 'Anucha', value: 2215, width: 100, color: '#16A34A' },
  { code: 'P006', name: 'Ploy', value: 2040, width: 92, color: '#16A34A' },
  { code: 'P014', name: 'Nid', value: 1800, width: 81, color: '#16A34A' },
  { code: 'P008', name: 'Wichai', value: 1350, width: 61, color: '#F59E0B' },
  { code: 'P017', name: 'Somchai', value: 900, width: 41, color: '#DC2626' },
  { code: 'P010', name: 'Techin', value: 687, width: 31, color: '#DC2626' },
]

export const actionRequired = [
  { icon: '!', iconBg: '#DC2626', title: 'Critical orders in Zone A', titleTh: 'เกิน threshold วิกฤต', count: 11, countColor: '#DC2626', border: '#FECACA', bg: '#FEF2F2' },
  { icon: '⌛', iconBg: '#F59E0B', title: 'Overdue orders', titleTh: 'เกิน 1 ชั่วโมง', count: 38, countColor: '#B45309', border: '#FED7AA', bg: '#FFFBEB' },
  { icon: '◇', iconBg: '#7C3AED', title: 'Batch split needed', titleTh: 'ต้องแยกแบตช์', count: 12, countColor: '#1F2937', border: '#E5E7EB', bg: '#fff' },
  { icon: '✓', iconBg: '#2563EB', title: 'Waiting admin verification', titleTh: 'รอตรวจสอบ', count: 50, countColor: '#1F2937', border: '#E5E7EB', bg: '#fff' },
  { icon: '✕', iconBg: '#6B7280', title: 'Invalid Bin Code in error queue', titleTh: 'Location Master ยังไม่พร้อม', count: 7, countColor: '#1F2937', border: '#E5E7EB', bg: '#fff' },
]

// ---------- Control Tower ----------

export const controlTowerPrimaryKpis = [
  { label: 'TOTAL ORDERS', value: '1,920', sub: 'New 1,800 · Backlog 120' },
  { label: 'TOTAL BACKLOG', value: '185', valueColor: '#F59E0B', sub: 'Picking 135 · Verify 50' },
  { label: 'TOTAL PIECES (PLAN)', value: '119,560', sub: 'unique order count' },
  { label: 'PIECES PICKED', value: '72,480', valueColor: '#16A34A', sub: '60.6% of plan', subColor: '#16A34A' },
  { label: 'PICKER IN PROGRESS', value: '78', sub: 'orders' },
  { label: 'PICKER COMPLETED', value: '642', sub: '100% 598 · short 44' },
]

export const controlTowerSecondaryKpis = [
  { label: 'WARNING ORDERS', value: '56', valueColor: '#B45309', sub: '2.9% of orders', accent: '#F59E0B', labelColor: '#B45309' },
  { label: 'OVERDUE ORDERS', value: '38', valueColor: '#C2410C', sub: '2.0% of orders', accent: '#EA580C', labelColor: '#C2410C' },
  { label: 'CRITICAL ORDERS', value: '11', valueColor: '#DC2626', sub: '0.6% of orders', accent: '#DC2626', labelColor: '#DC2626' },
  { label: 'PICKING SLA', value: '86.5%', valueColor: '#2563EB', sub: 'target ≥ 90%' },
  { label: 'AVG CYCLE / ORDER', value: '00:43', sub: 'target ≤ 60 min' },
  { label: 'PIECES PER HOUR', value: '4,320', sub: '78 active pickers' },
]

export const zoneOverview = [
  { zone: 'A', orders: 620, backlog: '72 / 18', inProgress: 25, completed: 220, sla: '82.3%', est: 'DELAY +2h 10m', estColor: '#B91C1C', estBg: '#FEF2F2' },
  { zone: 'B', orders: 510, backlog: '40 / 12', inProgress: 18, completed: 198, sla: '90.1%', est: 'ON TRACK +25m', estColor: '#15803D', estBg: '#F0FDF4' },
  { zone: 'C', orders: 430, backlog: '15 / 8', inProgress: 14, completed: 175, sla: '94.2%', est: 'ON TRACK −1h 05m', estColor: '#15803D', estBg: '#F0FDF4' },
  { zone: 'D', orders: 280, backlog: '8 / 6', inProgress: 10, completed: 122, sla: '88.4%', est: 'AT RISK +1h 00m', estColor: '#B45309', estBg: '#FFFBEB' },
  { zone: 'E', orders: 80, backlog: '0 / 6', inProgress: 5, completed: 45, sla: '91.7%', est: 'ON TRACK −35m', estColor: '#15803D', estBg: '#F0FDF4' },
]

export const topOverdueOrders = [
  { orderNo: 'ORD260827-0456', zones: 'A, C', picker: 'P010 Techin', assigned: '07:45', elapsed: '02:45', status: 'Critical', statusColor: '#B91C1C', statusBg: '#FEF2F2' },
  { orderNo: 'ORD260827-0450', zones: 'A', picker: 'P005 Maneerat', assigned: '08:00', elapsed: '02:30', status: 'Critical', statusColor: '#B91C1C', statusBg: '#FEF2F2' },
  { orderNo: 'ORD260827-0433', zones: 'A, B, D', picker: 'P002 Anucha', assigned: '07:50', elapsed: '02:20', status: 'Overdue', statusColor: '#B45309', statusBg: '#FFFBEB' },
  { orderNo: 'ORD260827-0412', zones: 'D', picker: 'P017 Somchai', assigned: '08:10', elapsed: '02:05', status: 'Overdue', statusColor: '#B45309', statusBg: '#FFFBEB' },
]

export const zonePerformance = [
  { zone: 'Zone A', value: 3250, height: 66, color: '#DC2626' },
  { zone: 'Zone B', value: 4860, height: 98, color: '#16A34A' },
  { zone: 'Zone C', value: 4980, height: 101, color: '#16A34A' },
  { zone: 'Zone D', value: 3780, height: 77, color: '#F59E0B' },
  { zone: 'Zone E', value: 4520, height: 92, color: '#16A34A' },
]

export const alerts = [
  { color: '#DC2626', text: '11 Critical orders in Zone A', sub: 'ต้องแก้ไขทันที', time: '10:28' },
  { color: '#DC2626', text: '38 Overdue orders (เกิน 1 ชั่วโมง)', time: '10:26' },
  { color: '#F59E0B', text: 'Zone A trending to miss cut-off (delay 2h 10m)', time: '10:20' },
  { color: '#F59E0B', text: 'Picker P010 has one order over 2 hours', time: '10:18' },
  { color: '#2563EB', text: 'Verification backlog 50 orders · รอนานกว่า 30 นาที', time: '10:15' },
  { color: '#7C3AED', text: 'Weekly productivity export to Google Sheets succeeded', time: '06:00' },
]

// ---------- Work Assignment ----------

export interface UnassignedOrder {
  orderNo: string
  store: string
  date: string
  zones: string
  sku: number
  pcs: number
  source: string
  sourceTone: 'purple' | 'neutral' | 'warning'
  /** planned pieces contributed to each zone — sums to `pcs`, drives the Assignment Summary "Zones touched" chips */
  zoneBreakdown: Record<string, number>
}

export const unassignedOrders: UnassignedOrder[] = [
  { orderNo: 'ORD260827-0512', store: 'ST-104', date: '26 Aug', zones: 'A, C', sku: 14, pcs: 96, source: 'Consolidation', sourceTone: 'purple', zoneBreakdown: { A: 72, C: 24 } },
  { orderNo: 'ORD260827-0514', store: 'ST-104', date: '26 Aug', zones: 'A', sku: 11, pcs: 72, source: 'Consolidation', sourceTone: 'purple', zoneBreakdown: { A: 72 } },
  { orderNo: 'ORD260827-0518', store: 'ST-217', date: '26 Aug', zones: 'A, B', sku: 9, pcs: 84, source: 'Single', sourceTone: 'neutral', zoneBreakdown: { A: 24, B: 60 } },
  { orderNo: 'ORD260827-0521', store: 'ST-311', date: '26 Aug', zones: 'C', sku: 7, pcs: 60, source: 'Single', sourceTone: 'neutral', zoneBreakdown: { C: 60 } },
  { orderNo: 'ORD260827-0524', store: 'ST-311', date: '26 Aug', zones: 'B, D', sku: 18, pcs: 132, source: 'Single', sourceTone: 'neutral', zoneBreakdown: { B: 70, D: 62 } },
  { orderNo: 'ORD260827-0529', store: 'ST-402', date: '26 Aug', zones: 'A, C, E', sku: 22, pcs: 148, source: 'Consolidation', sourceTone: 'purple', zoneBreakdown: { A: 50, C: 48, E: 50 } },
  { orderNo: 'ORD260827-0533', store: 'ST-402', date: '25 Aug', zones: 'D', sku: 5, pcs: 40, source: 'Backlog D-2', sourceTone: 'warning', zoneBreakdown: { D: 40 } },
  { orderNo: 'ORD260827-0537', store: 'ST-508', date: '26 Aug', zones: 'B', sku: 12, pcs: 88, source: 'Single', sourceTone: 'neutral', zoneBreakdown: { B: 88 } },
]

export const defaultSelectedOrderNos = ['ORD260827-0512', 'ORD260827-0514', 'ORD260827-0518', 'ORD260827-0521']

// ---------- Admin Verification ----------

export interface VerificationRow {
  orderNo: string
  picker: string
  store: string
  zones: string
  closed: string
  cycle: string
  planActual: string
  result: string
  resultTone: 'warning' | 'success'
  wait: string
  flagged?: boolean
  remark?: string
}

export const verificationQueue: VerificationRow[] = [
  { orderNo: 'ORD260827-0498', picker: 'P002 Anucha', store: 'ST-104', zones: 'A, C', closed: '10:04', cycle: '00:38', planActual: '96 / 90', result: 'Short 6', resultTone: 'warning', wait: '34m', flagged: true, remark: 'ของหมดในบิน R020 แจ้งหัวหน้ากะแล้ว' },
  { orderNo: 'ORD260827-0495', picker: 'P006 Ploy', store: 'ST-217', zones: 'B', closed: '10:08', cycle: '00:41', planActual: '84 / 84', result: '100%', resultTone: 'success', wait: '30m' },
  { orderNo: 'ORD260827-0491', picker: 'P014 Nid', store: 'ST-311', zones: 'C, D', closed: '10:12', cycle: '00:52', planActual: '132 / 120', result: 'Short 12', resultTone: 'warning', wait: '26m', remark: 'ตรวจนับซ้ำที่โซน D' },
  { orderNo: 'ORD260827-0489', picker: 'P008 Wichai', store: 'ST-402', zones: 'A', closed: '10:15', cycle: '00:47', planActual: '60 / 60', result: '100%', resultTone: 'success', wait: '23m' },
  { orderNo: 'ORD260827-0486', picker: 'P017 Somchai', store: 'ST-508', zones: 'D', closed: '10:19', cycle: '01:12', planActual: '148 / 131', result: 'Short 17', resultTone: 'warning', wait: '19m', remark: 'สินค้าชำรุดหลายรายการ' },
  { orderNo: 'ORD260827-0480', picker: 'P010 Techin', store: 'ST-104', zones: 'A', closed: '10:24', cycle: '00:29', planActual: '40 / 40', result: '100%', resultTone: 'success', wait: '14m' },
]

export const shortPickDetailByOrder: Record<string, { sku: string; bin: string; plan: number; actual: number; short: number; reason: string }[]> = {
  'ORD260827-0498': [
    { sku: 'A001', bin: 'B015', plan: 5, actual: 5, short: 0, reason: '—' },
    { sku: 'A001', bin: 'R020', plan: 10, actual: 6, short: 4, reason: 'Stock not found' },
    { sku: 'A118', bin: 'C-21-4', plan: 8, actual: 6, short: 2, reason: 'Damaged' },
    { sku: 'A204', bin: 'C-23-1', plan: 73, actual: 73, short: 0, reason: '—' },
  ],
}

export const rejectReasons = [
  'Short quantity not verified at bin',
  'Wrong SKU picked',
  'Damaged goods reported',
  'Bin Code mismatch with Location Master',
]

// ---------- Worker Management ----------

export const workerKpis = [
  { label: 'TOTAL USERS', labelTh: 'ผู้ใช้งานทั้งหมด', value: '78' },
  { label: 'ACTIVE', labelTh: 'ใช้งานอยู่', value: '62', valueColor: '#16A34A' },
  { label: 'PICKERS ON SHIFT', labelTh: 'ผู้หยิบสินค้าเข้ากะ', value: '41' },
  { label: 'ROLES', labelTh: 'บทบาททั้งหมด', value: '7' },
  { label: 'PENDING APPROVAL', labelTh: 'รออนุมัติ', value: '6', valueColor: '#F59E0B' },
]

export type PermState = 'full' | 'view' | 'hidden'

export const permissionMatrix: { module: string; perms: PermState[] }[] = [
  { module: 'Operations Dashboard', perms: ['full', 'full', 'full', 'full', 'hidden', 'full'] },
  { module: 'Order Pool / Import', perms: ['full', 'full', 'full', 'hidden', 'hidden', 'view'] },
  { module: 'Matching Analysis', perms: ['full', 'full', 'full', 'view', 'hidden', 'view'] },
  { module: 'Batch release', perms: ['full', 'full', 'hidden', 'hidden', 'hidden', 'hidden'] },
  { module: 'Work Assignment', perms: ['full', 'full', 'full', 'hidden', 'hidden', 'hidden'] },
  { module: 'Admin verification', perms: ['full', 'full', 'full', 'hidden', 'hidden', 'hidden'] },
  { module: 'Zone Dashboard', perms: ['full', 'full', 'view', 'full', 'hidden', 'view'] },
  { module: 'Own work / short pick', perms: ['full', 'full', 'hidden', 'hidden', 'full', 'hidden'] },
  { module: 'Configuration / Audit', perms: ['full', 'view', 'hidden', 'hidden', 'hidden', 'hidden'] },
  { module: 'User Management', perms: ['full', 'hidden', 'hidden', 'hidden', 'hidden', 'hidden'] },
]

export const permissionRoleCols = ['ADM', 'SUP', 'PLN', 'ZC', 'PCK', 'VW']

export interface WorkerDetail {
  warehouse: string
  zones: string
  shift: string
  lastLogin: string
  ordersPerHour: string
  pickingSla: string
  shortPickRate: string
}

export interface WorkerRow {
  userId: string
  nameEn: string
  nameTh: string
  role: string
  roleTone: 'danger' | 'info' | 'success' | 'purple' | 'neutral'
  scope: string
  pcsHr: string
  pcsHrColor?: string
  status: string
  statusColor: string
  detail?: WorkerDetail
}

export const workerList: WorkerRow[] = [
  { userId: 'U0001', nameEn: 'Somsak P.', nameTh: 'สมศักดิ์ พงษ์พันธ์', role: 'Supervisor', roleTone: 'danger', scope: 'Bangna DC · all zones', pcsHr: '—', status: '● Active', statusColor: '#16A34A' },
  { userId: 'U0002', nameEn: 'Nattaporn K.', nameTh: 'ณัฐพร กิจเจริญ', role: 'Planner', roleTone: 'info', scope: 'Bangna DC', pcsHr: '—', status: '● Active', statusColor: '#16A34A' },
  {
    userId: 'P002', nameEn: 'Anucha T.', nameTh: 'อนุชา ทองน้อย', role: 'Picker', roleTone: 'success', scope: 'Zones A, C', pcsHr: '2,215', status: '● On shift', statusColor: '#16A34A',
    detail: { warehouse: 'Bangna DC', zones: 'A, C', shift: 'A · 06:00–14:00', lastLogin: '27 Aug 06:02', ordersPerHour: '3.4', pickingSla: '93.1%', shortPickRate: '4.2%' },
  },
  { userId: 'P006', nameEn: 'Ploy S.', nameTh: 'พลอย ศิริกุล', role: 'Picker', roleTone: 'success', scope: 'Zone B', pcsHr: '2,040', status: '● On shift', statusColor: '#16A34A' },
  { userId: 'P010', nameEn: 'Techin P.', nameTh: 'เตชินท์ พูลผล', role: 'Picker', roleTone: 'success', scope: 'Zone A', pcsHr: '687', pcsHrColor: '#DC2626', status: '● Below avg', statusColor: '#F59E0B' },
  { userId: 'U0014', nameEn: 'Weerachai T.', nameTh: 'วีระชัย ทองนิยม', role: 'Zone Controller', roleTone: 'purple', scope: 'Zones C, D', pcsHr: '—', status: '● Active', statusColor: '#16A34A' },
  { userId: 'U0021', nameEn: 'Prasert M.', nameTh: 'ประเสริฐ มณีวงศ์', role: 'Viewer', roleTone: 'neutral', scope: 'BKK West DC (read only)', pcsHr: '—', status: '● Inactive', statusColor: '#9CA3AF' },
]

export const workerAuditTrail = [
  { color: '#16A34A', title: '27 Aug 06:02 · Login', sub: 'IP 10.10.1.23' },
  { color: '#2563EB', title: '26 Aug 16:45 · Zone scope changed A → A, C', sub: 'by U0001 Somsak P.' },
  { color: '#F59E0B', title: '25 Aug 11:20 · Short pick reason overridden', sub: 'ORD260825-0311 · by U0002' },
]
