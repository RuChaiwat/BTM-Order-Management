-- §6 Location Master / Pick Sequence — Aisle is the one component of the Pick Sequence formula
-- that needs an explicit maintained order: Side Pair, Direction, Level, and Block are all pure
-- functions of their own letter/number (AB=01, CD=02, ...; A=Right, B=Left; A=01, B=02, ...) and
-- never need a lookup table, but Aisle codes (A1, A6, B1, R2, ...) don't have a universal
-- deterministic order — this warehouse's aisles happen to sort alphabetically, but that isn't
-- guaranteed in general. Per business decision, new Aisles are always appended to the end of the
-- walking order (never inserted mid-sequence), which means no other location's Pick Sequence ever
-- needs to be recomputed when a new Aisle appears — only the new Aisle's own rank is assigned.
create table aisle_sequence (
  warehouse_code text not null references warehouses(warehouse_code),
  aisle text not null,
  aisle_rank int not null,
  created_at timestamptz not null default now(),
  primary key (warehouse_code, aisle)
);
create unique index uq_aisle_sequence_rank on aisle_sequence(warehouse_code, aisle_rank);

alter table aisle_sequence enable row level security;
create policy read_aisle_sequence on aisle_sequence for select using (auth_role() is not null);
