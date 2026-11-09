-- Banco já existente: execute uma vez no SQL Editor do Supabase.
-- Mantém todos os registros e permite o tratamento combinado.
begin;
alter table public.clients
  drop constraint if exists clients_treatment_type_check;
alter table public.clients
  add constraint clients_treatment_type_check
  check (treatment_type in ('Estrias', 'Cicatriz', 'Estrias e cicatrizes'));
commit;
