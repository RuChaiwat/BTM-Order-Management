-- Business feedback from UAT: a separate "Badge Code" read like some kind of internal
-- achievement/certificate badge, not an employee ID card number, and having it be a value
-- DIFFERENT from Picker ID was confusing in practice -- Admin expected scanning the Picker ID
-- itself (already the identifier printed on the employee's ID card) to just work at Assignment
-- time. Drop the separate badge_code concept entirely; picker_id is now the sole identifier,
-- both displayed everywhere and scanned in Work Assignment.
alter table pickers drop column badge_code;
