-- Human-readable Batch No so floor staff can reference a batch out loud instead of a UUID.
-- Format: B{YYMMDD}-{running 3-digit sequence per Order Date}, e.g. B260901-001.
alter table consolidation_batches add column if not exists batch_no text;

create or replace function set_consolidation_batch_no() returns trigger as $$
declare
  next_seq int;
begin
  if new.batch_no is not null then
    return new;
  end if;
  select count(*) + 1 into next_seq from consolidation_batches where order_date = new.order_date;
  new.batch_no := 'B' || to_char(new.order_date, 'YYMMDD') || '-' || lpad(next_seq::text, 3, '0');
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_set_consolidation_batch_no on consolidation_batches;
create trigger trg_set_consolidation_batch_no
  before insert on consolidation_batches
  for each row execute function set_consolidation_batch_no();

-- Backfill any batches created before this migration (numbered in original creation order).
with numbered as (
  select consol_batch_id, order_date, row_number() over (partition by order_date order by created_at) as rn
  from consolidation_batches
  where batch_no is null
)
update consolidation_batches cb
set batch_no = 'B' || to_char(numbered.order_date, 'YYMMDD') || '-' || lpad(numbered.rn::text, 3, '0')
from numbered
where cb.consol_batch_id = numbered.consol_batch_id;

alter table consolidation_batches alter column batch_no set not null;
create unique index if not exists idx_consolidation_batches_batch_no on consolidation_batches(batch_no);
