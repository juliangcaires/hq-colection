# Prompt para o Claude Code

1. Descompacte este zip em `docs/redesign/desejos/` dentro do repositório `hq-colection` (ficam `DESEJOS.md`, `PROMPT.md` e `referencias/`).
2. Abra o Claude Code na raiz do repositório e envie:

```
Leia AGENTS.md e depois docs/redesign/desejos/DESEJOS.md, com as referências
em docs/redesign/desejos/referencias/ (DesejosOpcaoA.dc.html = modo grade,
DesejosOpcaoC.dc.html = modo agrupado por série).

Reimplemente a tela /desejos seguindo a spec:
- modo padrão em grade de capas;
- toggle "Agrupar por série" que troca para o modo agrupado, guardado na URL
  (?agrupar=serie) junto com os filtros atuais;
- cabeçalho compacto (pílulas no lugar do card grande) e os chips de tipo de
  tag + "Sem capa" consolidados num único menu "Filtros".

Regras:
- Não mude schema nem server actions; reaproveite AdquirirButton,
  selecao-itens, CarregarMais, filtros-url e os tokens do globals.css.
- O agrupamento deve ser uma função pura em src/lib/ com teste em
  src/lib/__tests__/.
- Itens marcados [opcional — confirmar] só depois de me perguntar.

Antes de codar, me mostre um plano curto (arquivos que vai criar/alterar).
Depois implemente, teste em 390px e 1440px, rode lint e vitest e me mostre
o resultado antes de commitar.
```
