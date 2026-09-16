-- An optional free-text field on Pickers -- Business wants a place to note things like employee
-- type/distinction (e.g. "outstanding employee", certifications) that don't belong as part of the
-- Picker ID/scan identity (that's exactly the confusion the dropped Badge Code caused, see
-- migration 0018). Purely informational: never required, never used to look anything up.
alter table pickers add column note text;
