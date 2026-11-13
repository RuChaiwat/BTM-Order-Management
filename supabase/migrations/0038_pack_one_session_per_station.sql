-- 1 Pack Station : 1 packer at a time (client rule). The app checks this when the employee is
-- scanned and again when an order is scanned; this index makes it impossible in the database too
-- (two devices scanning at the same instant). Same pattern as uq_pack_sessions_open_order /
-- uq_pack_sessions_open_picker in 0035.
--
-- Before creating the index, any station that already has more than one open session keeps only
-- its earliest one; the later ones are cancelled (order back to waiting to pack), exactly like a
-- supervisor cancel, so the index can be built.

with ranked as (
  select session_id, order_id,
         row_number() over (partition by station_code order by started_at) as rn
  from pack_sessions
  where finished_at is null
),
cancelled as (
  update pack_sessions ps
  set finished_at = now(),
      result = 'cancelled',
      cancel_reason = 'ระบบยกเลิก: Station มีคนแพ็กอยู่แล้ว (1 Station : 1 คน) · Auto-cancelled, station already in use'
  from ranked r
  where ps.session_id = r.session_id and r.rn > 1
  returning ps.order_id
)
update orders o
set pack_status = 'pending'
from cancelled c
where o.order_id = c.order_id and o.pack_status = 'packing';

create unique index if not exists uq_pack_sessions_open_station on pack_sessions(station_code) where finished_at is null;
