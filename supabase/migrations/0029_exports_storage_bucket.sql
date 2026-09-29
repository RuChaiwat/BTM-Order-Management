-- §20.1 weekly productivity export, switched from Google Sheets (required a paid-looking Google
-- Cloud project + service account + Drive folder sharing -- real friction and a real, if usually
-- small, billing surface the business didn't want) to a plain .xlsx file, generated with the same
-- `xlsx` package already used for order/location imports, and stored right here in Supabase
-- Storage -- already part of this project, no new account, no new cost.
--
-- Private (not public): the export contains picker names, cycle times and store codes -- not
-- public data. app/api/cron/weekly-export writes here with the service_role key (bypasses RLS
-- entirely, no policy needed for that), and app/api/exports/[jobId]/download is the only way a
-- browser ever reaches a file in it -- it checks the caller is signed in as System Admin, then
-- mints a short-lived signed URL per download instead of this bucket (or any file in it) ever
-- being publicly reachable on its own.

insert into storage.buckets (id, name, public)
values ('exports', 'exports', false)
on conflict (id) do nothing;
