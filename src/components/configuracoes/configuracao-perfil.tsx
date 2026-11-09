'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { salvarPerfil } from '@/app/(app)/configuracoes/actions'
import { desembrulhar } from '@/lib/resultado'

export function ConfiguracaoPerfil({ apelidoInicial, nomeInicial }: { apelidoInicial: string; nomeInicial: string }) {
  const [apelido, setApelido] = useState(apelidoInicial)
  const [nome, setNome] = useState(nomeInicial)
  const [isPending, startTransition] = useTransition()
  const alterado = apelido !== apelidoInicial || nome !== nomeInicial

  function salvar() {
    startTransition(async () => {
      try {
        const r = desembrulhar(await salvarPerfil({ apelido, nome_exibicao: nome }))
        setApelido(r.apelido)
        toast.success('Perfil salvo')
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Não foi possível salvar')
      }
    })
  }

  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-[18px]">
      <h2 className="font-heading text-[19px] font-bold">Perfil</h2>
      <p className="text-sm text-muted-foreground">É assim que amigos e quem abrir o seu link veem você.</p>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="apelido">Apelido</Label>
        <Input
          id="apelido"
          className="h-11 rounded-[10px] bg-surface-2"
          value={apelido}
          onChange={(e) => setApelido(e.target.value)}
          maxLength={30}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          placeholder="ex: julian_hq"
        />
        <p className="text-xs text-muted-foreground">Único. Amigos te encontram por ele. Letras minúsculas, números e &quot;_&quot;.</p>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="nome-exibicao">Nome de exibição</Label>
        <Input
          id="nome-exibicao"
          className="h-11 rounded-[10px] bg-surface-2"
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          maxLength={80}
          placeholder="opcional"
        />
      </div>
      <Button className="h-11 w-fit" onClick={salvar} disabled={isPending || !alterado || apelido.trim().length < 3}>
        {isPending ? 'Salvando...' : 'Salvar perfil'}
      </Button>
    </section>
  )
}
