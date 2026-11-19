-- Merge categories that were pure duplicates with no distinguishing rule:
--   Formación        -> Educación         (same MCC rule, same budget group)
--   Nómina           -> Salario           (no rule ever distinguished them)
--   Ticket restaurante -> Tarjeta Restaurante (inconsistent capitalization, same concept)
-- Historical movements and user-defined category rules are relabeled so
-- reports stay consistent; nothing is deleted.

update public.movements set category = 'Educación' where category = 'Formación';
update public.movements set category = 'Salario' where category = 'Nómina';
update public.movements set category = 'Tarjeta Restaurante' where category = 'Ticket restaurante';

update public.movement_category_rules set category = 'Educación' where category = 'Formación';
update public.movement_category_rules set category = 'Salario' where category = 'Nómina';
update public.movement_category_rules set category = 'Tarjeta Restaurante' where category = 'Ticket restaurante';
