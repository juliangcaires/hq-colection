'use client'

import { useRef, useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Avatar } from '@/components/ui/avatar'
import { prepararFotoDePerfil } from '@/lib/avatar-cliente'
import { removerAvatar, salvarAvatar, salvarPerfil } from '@/app/(app)/configuracoes/actions'
import { desembrulhar } from '@/lib/resultado'

export function ConfiguracaoPerfil({ apelidoInicial, nomeInicial, avatarInicial }: { apelidoInicial: string; nomeInicial: string; avatarInicial: string | null }) {
  const [apelido, setApelido] = useState(apelidoInicial)
  const [nome, setNome] = useState(nomeInicial)
  const [avatar, setAvatar] = useState(avatarInicial)
  const [isPending, startTransition] = useTransition()
  const [enviando, startEnvio] = useTransition()
  const inputFoto = useRef<HTMLInputElement>(null)
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

  function escolherFoto(arquivo: File | undefined) {
    if (!arquivo) return
    startEnvio(async () => {
      try {
        const blob = await prepararFotoDePerfil(arquivo)
        const dados = new FormData()
        dados.set('foto', new File([blob], 'foto', { type: blob.type }))
        const r = desembrulhar(await salvarAvatar(dados))
        setAvatar(r.url)
        toast.success('Foto atualizada')
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Não foi possível enviar a foto')
      } finally {
        if (inputFoto.current) inputFoto.current.value = ''
      }
    })
  }

  function removerFoto() {
    startEnvio(async () => {
      try {
        desembrulhar(await removerAvatar())
        setAvatar(null)
        toast.success('Foto removida')
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Não foi possível remover a foto')
      }
    })
  }

  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-[18px]">
      <h2 className="font-heading text-[19px] font-bold">Perfil</h2>
      <p className="text-sm text-muted-foreground">É assim que amigos e quem abrir o seu link veem você.</p>
      <div className="flex items-center gap-4">
        <Avatar apelido={apelidoInicial} nome={nomeInicial} url={avatar} size={72} />
        <div className="flex flex-col gap-1.5">
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" className="h-10" disabled={enviando} onClick={() => inputFoto.current?.click()}>
              {enviando ? 'Enviando...' : avatar ? 'Trocar foto' : 'Enviar foto'}
            </Button>
            {avatar && (
              <Button type="button" variant="ghost" className="h-10 text-danger-soft-text" disabled={enviando} onClick={removerFoto}>
                Remover
              </Button>
            )}
          </div>
          <p className="text-xs text-muted-foreground">JPEG, PNG ou WebP. Fica quadrada (256 px) e sem dados do aparelho.</p>
        </div>
        <input ref={inputFoto} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" aria-label="Escolher foto de perfil" onChange={(e) => escolherFoto(e.target.files?.[0])} />
      </div>
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
