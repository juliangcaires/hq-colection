-- Limpa "críticas" que na verdade são notas de importação/catalogação (IMG_xxxx, "restaurado do Notion",
-- "adicionado pelo usuário", "CONFERIR"...). Vieram do campo antigo `observacoes`, que a migration 0008
-- renomeou para `critica`.
--
-- Regras (idempotente; críticas reais de volumes lidos ficam como estão):
--  1) volume que não foi lido não tem crítica de leitura: zera.
--  2) volume lido: zera só se o texto tem cara de nota de importação.

-- 1) não lidos
update itens
set critica = null
where estado <> 'lido'
  and critica is not null;

-- 2) lidos com texto de importação
update itens
set critica = null
where estado = 'lido'
  and (
       critica ~* '^\s*IMG_[0-9]+'
    or critica ~* 'restaurado do notion'
    or critica ~* '^\s*adicionado pelo usu'
    or critica ~* 'identificado pela foto'
    or critica ~* '^\s*sem foto\b'
  );
