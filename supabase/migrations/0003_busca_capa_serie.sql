-- Memória de busca de capa por série: o que já deu certo num volume da série
-- fica registrado para os próximos volumes não repetirem a resolução por
-- título do zero (ver PLANO-CAPAS.md).

alter table series
  add column busca_termo text,             -- termo que funcionou (ex. 'Berserk')
  add column busca_provedor text,          -- 'google_books' | 'open_library' | 'anilist' | 'mangadex'
  add column busca_ref text,               -- id externo da obra no provedor (ex. manga id do MangaDex)
  add column busca_atualizado_em timestamptz;
