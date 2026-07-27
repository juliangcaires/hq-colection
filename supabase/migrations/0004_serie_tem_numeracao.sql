-- Séries numeradas: quando ligada, todo volume incluído na série pela tela de
-- "Adicionar volumes" precisa vir com `numero_volume` preenchido e sem repetir
-- número dentro da série.
--
-- Nasce desligada: as séries já cadastradas continuam se comportando como hoje
-- até que a flag seja marcada uma a uma.
--
-- A regra é aplicada na server action (`adicionarItensASerie`), não por
-- constraint: `numero_volume` é numeric e nullable de propósito (edições 1.5) e
-- as séries não numeradas continuam podendo repetir/omitir número.

alter table series
  add column tem_numeracao boolean not null default false;
