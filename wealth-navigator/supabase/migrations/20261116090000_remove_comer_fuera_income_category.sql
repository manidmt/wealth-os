-- "Comer fuera" as an INCOME category was a copy-paste leftover from the
-- expense list, not an intentional case (e.g. meal reimbursements). Removed
-- from INCOME_CATEGORIES in code; reclassify the one historical income
-- movement that used it to the income catch-all so it isn't left pointing at
-- a category that no longer exists in the picker.
update public.movements
set category = 'Otros ingresos'
where type = 'income' and category = 'Comer fuera';
