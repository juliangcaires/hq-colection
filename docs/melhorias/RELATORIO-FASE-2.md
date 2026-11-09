# Relatório — Fase 2: catálogo de edições e cadastro por ISBN

## Plano da fase

Branch: `feat/melhorias-fase-2` (empilhada sobre `feat/melhorias-fase-1`).

| Tarefa | Arquivos |
| --- | --- |
| F2.1 | `supabase/migrations/0011_catalogo_edicoes.sql` (`edicoes`, `editora_apelidos`, `itens.edicao_id`, `edicao_registrar`, `itens_por_isbn`, limite de consultas), testes SQL |
| F2.2 | `src/lib/isbn.ts` + teste |
| F2.3 | `src/lib/texto.ts`, `src/lib/edicao-titulo.ts`, `src/lib/isbn-busca.ts` (catálogo → BrasilAPI → Google Books) + testes com respostas fixas; `capa-busca.ts` exporta o que precisar |
| F2.4 | `src/app/(app)/itens/isbn-actions.ts` (`consultarIsbn`) |
| F2.5 | `src/lib/casamento.ts` + teste (série parecida, editora por apelido, autores) |
| F2.6 | `src/components/quick-add/quick-add-isbn.tsx`, `quick-add-provider.tsx`, `quick-add-form.tsx` (ISBN inicial), action `cadastrarPorIsbn`, `item_salvar` com `edicao_id` |
| F2.7 | `src/components/quick-add/leitor-isbn.tsx`, `next.config.ts` (Permissions-Policy da câmera), dependência de fallback |
| F2.8 | modo prateleira em `src/components/quick-add/prateleira-isbn.tsx`, action `cadastrarLoteDeIsbn` |
| F2.9 | `createItem`/`updateItem` alimentam o catálogo (origem `usuario`) |

Ordem: F2.1 → F2.9, um commit por tarefa.

## O que foi feito

- **F2.1** `0011_catalogo_edicoes.sql`: `edicoes` (leitura para `authenticated`, escrita só por `edicao_registrar` `security definer`), `editora_apelidos` (semente: Panini, JBC, NewPOP, Pipoca & Nanquim, Devir, Mythos, Conrad), `itens.edicao_id`, `itens_por_isbn`, limite de consultas (`isbn_consultas` + `isbn_consulta_registrar`), `item_salvar` com `edicao_id`. Testes SQL: leitura sim, escrita direta não, ISBN único, dado de usuário nunca sobrescreve API, API substitui rascunho de usuário.
- **F2.2** `src/lib/isbn.ts` (limpar, validar ISBN-10/13, converter, EAN de ISBN) + testes.
- **F2.3** `src/lib/isbn-busca.ts`: catálogo → BrasilAPI → Google Books, com timeout de 8 s, 404/429/403/5xx tratados, dados sanitizados nos limites do banco, série e número extraídos do título (`edicao-titulo.ts`), tipo (HQ/mangá) inferido. Grava no catálogo o que vem de fora. Testes com `fetch` falso (sem rede).
- **F2.4** `consultarIsbn`: valida antes de chamar, avisa "você já tem este volume", limite de 60 consultas externas por hora por usuário (catálogo não conta).
- **F2.5** `src/lib/casamento.ts`: série parecida (Dice sobre bigramas, pré-seleção só ≥ 0,85), editora por apelidos, autores (aceita "Sobrenome, Nome"). Só sugere.
- **F2.6** Aba "Por ISBN" no quick-add: prévia editável (título, série, número, estado, tipo, tags), `cadastrarPorIsbn` cria o item com `edicao_id` e capa. ISBN não encontrado cai no cadastro manual com o ISBN preenchido.
- **F2.7** Botão "Escanear código de barras": `BarcodeDetector` nativo; sem ele, `@zxing/library` carregada sob demanda. Só EAN-13 978/979 com dígito certo; outro código mostra "Este código não é um ISBN". `Permissions-Policy` passou de `camera=()` para `camera=(self)`.
- **F2.8** Aba "Prateleira": leitura contínua, fila de consultas, lista de revisão com duplicatas marcadas ("já na coleção", "repetido na lista"), salvamento em lotes de 8 itens, cada item independente (falha de um não perde os outros), série nova criada uma vez por nome.
- **F2.9** `createItem`/`updateItem` e linhas sem dados da prateleira alimentam o catálogo com origem `usuario` (só título, série, número, tipo, editora, autores).

## Migrations a aplicar (em ordem)

1. `0010_serie_lida_e_lido_em.sql` (Fase 1, se ainda não aplicada)
2. `0011_catalogo_edicoes.sql`

## Dependências adicionadas

- `@zxing/library@^0.23.0` — fallback do leitor de código de barras no Safari/iOS. Motivo: é JavaScript puro (sem WASM, então a CSP atual não muda), tem só o decodificador necessário, é carregado com `import()` só quando o navegador não tem `BarcodeDetector`. As alternativas (`barcode-detector`/`zxing-wasm`) exigiriam `wasm-unsafe-eval` na CSP e hospedar o `.wasm`.

## Decisões fora do plano

- Apelidos de editora existem na tabela **e** em `src/lib/editoras.ts` (espelho); um teste confere que as duas listas são idênticas.
- `edicoes.capa_url_externa` guarda a capa que a API informou (o plano não listava o campo); o download continua passando pela lista de hosts permitidos e, se falhar, cai em `buscarCapaPorIsbn`.
- Limite: 60 consultas externas por hora por usuário, janela deslizante em `isbn_consultas`.
- Na prévia, série e tags **existentes** vêm marcadas; tags que seriam **criadas** vêm desmarcadas. No modo prateleira, tags novas só são criadas se a opção "Criar tags de editora e autor novas" for ligada; séries novas são listadas no aviso antes de salvar.
- Aba padrão do quick-add continua "Manual" (não muda o hábito atual).
- Risco conhecido, aceito pelo plano ("ninguém corrige na fase 2"): qualquer usuário logado pode chamar `edicao_registrar` direto e plantar uma edição para um ISBN ainda inexistente no catálogo. A função valida tudo (ISBN, tamanhos, https) e não sobrescreve edição de API, mas não impede lixo em ISBN novo.
- Capas de provedores fora da lista de hosts (alguma `cover_url` da BrasilAPI) não aparecem na prévia por causa da CSP; o item ainda pega capa pelo fallback.

## Pendências

- Leitura de código de barras não pôde ser testada em aparelho real aqui; o `BarcodeDetector` tem teste com detector falso e o fallback ZXing não tem teste automatizado (precisa de DOM/câmera).
- Sem tela para corrigir dados de edição do catálogo (decisão do plano).

## Roteiro de teste manual no celular

1. Quick-add → "Por ISBN" → digitar um ISBN de mangá da JBC/Panini com hífens → conferir prévia, capa e série sugerida.
2. Repetir o mesmo ISBN: deve avisar "Você já tem este volume".
3. ISBN inexistente (ex.: `9780000000002` com dígito válido): "Cadastrar manualmente" abre o formulário com o ISBN.
4. "Escanear código de barras" no Chrome/Android e no Safari/iOS (PWA instalado): permitir câmera, ler um livro; ler uma embalagem comum e ver "Este código não é um ISBN".
5. Aba "Prateleira": escanear 4–5 livros, um repetido e um já da coleção; desmarcar um; salvar; confirmar que falha de um não perde os outros (ex.: desligar o Wi-Fi no meio).
6. Cadastro manual com ISBN válido: depois, com outra conta, buscar o mesmo ISBN e ver que vem do catálogo ("Do catálogo").
