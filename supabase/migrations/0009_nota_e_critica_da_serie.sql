-- Avaliação da série como um todo: nota e crítica próprias, independentes das dos volumes.
-- Sem nota própria (null), a nota exibida da série é a média dos volumes lidos e avaliados.

alter table series add column if not exists nota numeric(2,1);
alter table series add column if not exists critica text;

alter table series drop constraint if exists series_nota_check;
alter table series add constraint series_nota_check
  check (nota is null or (nota between 0.5 and 5 and (nota * 2) = trunc(nota * 2)));

alter table series drop constraint if exists series_critica_check;
alter table series add constraint series_critica_check
  check (critica is null or char_length(critica) <= 2000);
