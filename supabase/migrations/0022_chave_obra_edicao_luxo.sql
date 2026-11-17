-- 0022: "Berserk" e "Berserk Edição de Luxo" passam a ser a mesma obra.
--
-- A chave da obra (itens.obra_chave) e da série (series.serie_chave) é calculada no app (`chaveObra` / `chaveSerie`
-- em src/lib/texto.ts). A partir daqui o app remove da série/título os sufixos de edição ("edição de luxo",
-- "deluxe", "nova edição", "edição definitiva"...). Omnibus NÃO entra (numeração diferente).
--
-- Esta migration:
--  1. cria `privado.normalizar_obra`, a cópia em SQL da normalização do app (mesma lista de sufixos);
--  2. recalcula SÓ as chaves de itens/séries cujo nome tem sufixo (quem não tem sufixo não muda, por construção);
--  3. acompanha os vínculos manuais (`obra_equivalencias`), descartando os que viram "a mesma obra" ou duplicados.
-- Idempotente: rodar de novo não acha mais nada com sufixo para mudar. Tabelas grandes: só linhas com sufixo são
-- tocadas (pré-filtro por texto) e o índice parcial de chave é mantido.

-- Normaliza como `normalizarParaChave` (+ remoção dos sufixos quando p_sem_sufixo): minúsculo, sem acento,
-- "&" vira " e ", "#" e pontuação viram espaço, tira o ruído (vol, tomo, edicao, de, o, a...).
create or replace function privado.normalizar_obra(p_texto text, p_sem_sufixo boolean default true)
returns text
language sql
immutable
set search_path = pg_catalog
as $$
  with base as (
    select btrim(regexp_replace(
             replace(lower(translate(coalesce(p_texto, ''),
               'ÀÁÂÃÄÅàáâãäåÇçÈÉÊËèéêëÌÍÎÏìíîïÑñÒÓÔÕÖòóôõöÙÚÛÜùúûüÝýÿ',
               'AAAAAAaaaaaaCcEEEEeeeeIIIIiiiiNnOOOOOoooooUUUUuuuuYyy')), '&', ' e '),
             '[^a-z0-9]+', ' ', 'g')) as t
  ),
  sem as (
    select case
             when p_sem_sufixo then
               coalesce(nullif(btrim(regexp_replace(
                 regexp_replace(' ' || t || ' ',
                   '(?: )(?:edicao de luxo|edicao luxo|deluxe edition|edicao deluxe|deluxe|nova edicao|edicao definitiva|definitive edition)(?= )',
                   ' ', 'g'),
                 ' +', ' ', 'g')), ''), t)
             else t
           end as t
      from base
  )
  select coalesce(string_agg(p, ' ' order by n), '')
    from sem, regexp_split_to_table(sem.t, ' ') with ordinality as x(p, n)
   where p <> '' and p not in ('vol', 'volume', 'tomo', 'edicao', 'ed', 'no', 'n', 'numero', 'a', 'o', 'de', 'do', 'da')
$$;

-- Chave da obra, igual a `chaveObra` (texto.ts). p_numero em numeric: 3 -> '3', 1.5 -> '1.5'.
create or replace function privado.chave_obra(p_serie text, p_numero numeric, p_titulo text, p_tipo text, p_sem_sufixo boolean default true)
returns text
language sql
immutable
set search_path = pg_catalog, privado
as $$
  select left(
    case
      when privado.normalizar_obra(p_serie, p_sem_sufixo) <> '' then
        case
          when p_numero is not null then
            privado.normalizar_obra(p_serie, p_sem_sufixo) || '|' || trim_scale(p_numero)::text || '|' || coalesce(p_tipo, '')
          else
            privado.normalizar_obra(p_serie, p_sem_sufixo) || '|t:' || privado.normalizar_obra(p_titulo, p_sem_sufixo) || '|' || coalesce(p_tipo, '')
        end
      else privado.normalizar_obra(p_titulo, p_sem_sufixo) || '||' || coalesce(p_tipo, '')
    end, 400)
$$;

create or replace function privado.chave_serie(p_nome text, p_tipo text, p_sem_sufixo boolean default true)
returns text
language sql
immutable
set search_path = pg_catalog, privado
as $$
  select left(privado.normalizar_obra(p_nome, p_sem_sufixo) || '|' || coalesce(p_tipo, ''), 400)
$$;

revoke all on function privado.normalizar_obra(text, boolean) from public, anon, authenticated;
revoke all on function privado.chave_obra(text, numeric, text, text, boolean) from public, anon, authenticated;
revoke all on function privado.chave_serie(text, text, boolean) from public, anon, authenticated;

-- Mapa antigo -> novo das chaves de obra que mudam: só itens cujo nome tem sufixo E cuja chave gravada é a que o
-- algoritmo antigo daria (chave desatualizada fica para o app refazer).
drop table if exists _obra_chave_mapa;
create temp table _obra_chave_mapa as
  select distinct i.obra_chave as antiga,
         privado.chave_obra(s.nome, i.numero_volume, i.titulo, i.tipo::text) as nova
    from itens i
    left join series s on s.id = i.serie_id
   where i.obra_chave is not null
     and (coalesce(s.nome, '') ~* '(luxo|deluxe|nova|definitiv)' or i.titulo ~* '(luxo|deluxe|nova|definitiv)')
     and i.obra_chave = privado.chave_obra(s.nome, i.numero_volume, i.titulo, i.tipo::text, false)
     and privado.chave_obra(s.nome, i.numero_volume, i.titulo, i.tipo::text) <> i.obra_chave;

-- Itens (cada um pelo seu cálculo; o mapa só serve de pré-filtro por chave, usando o índice de obra_chave).
update itens i
   set obra_chave = privado.chave_obra(s.nome, i.numero_volume, i.titulo, i.tipo::text)
  from itens alvo
  left join series s on s.id = alvo.serie_id
 where i.id = alvo.id
   and alvo.obra_chave in (select antiga from _obra_chave_mapa)
   and alvo.obra_chave = privado.chave_obra(s.nome, alvo.numero_volume, alvo.titulo, alvo.tipo::text, false)
   and privado.chave_obra(s.nome, alvo.numero_volume, alvo.titulo, alvo.tipo::text) <> alvo.obra_chave;

-- Séries.
update series
   set serie_chave = privado.chave_serie(nome, tipo::text)
 where serie_chave is not null
   and nome ~* '(luxo|deluxe|nova|definitiv)'
   and serie_chave = privado.chave_serie(nome, tipo::text, false)
   and serie_chave <> privado.chave_serie(nome, tipo::text);

-- Vínculos manuais acompanham o mapa nos dois lados. Refaz as linhas afetadas (a chave primária e o check
-- "chave <> chave_amigo" não deixam um UPDATE simples): os que viram "a mesma obra" ou duplicados somem.
create temp table _equiv_afetadas as
  select oe.user_id,
         coalesce((select m.nova from _obra_chave_mapa m where m.antiga = oe.obra_chave), oe.obra_chave) as obra_chave,
         coalesce((select m.nova from _obra_chave_mapa m where m.antiga = oe.obra_chave_amigo), oe.obra_chave_amigo) as obra_chave_amigo,
         oe.created_at,
         oe.obra_chave as antiga_a,
         oe.obra_chave_amigo as antiga_b
    from obra_equivalencias oe
   where oe.obra_chave in (select antiga from _obra_chave_mapa)
      or oe.obra_chave_amigo in (select antiga from _obra_chave_mapa);

delete from obra_equivalencias oe
 using _equiv_afetadas a
 where oe.user_id = a.user_id and oe.obra_chave = a.antiga_a and oe.obra_chave_amigo = a.antiga_b;

insert into obra_equivalencias (user_id, obra_chave, obra_chave_amigo, created_at)
select distinct on (user_id, obra_chave, obra_chave_amigo) user_id, obra_chave, obra_chave_amigo, created_at
  from _equiv_afetadas
 where obra_chave <> obra_chave_amigo
 order by user_id, obra_chave, obra_chave_amigo, created_at
on conflict do nothing;

drop table _equiv_afetadas;
drop table _obra_chave_mapa;
