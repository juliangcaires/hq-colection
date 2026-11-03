import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { listarItens } from '@/lib/queries'
import { urlsDeCapas } from '@/lib/supabase/capas'
import { calcularVolumesFaltantes, serieEstaCompleta } from '@/lib/volumes'
import { uuidOuNull } from '@/lib/filtros-url'
import Image from 'next/image'
import { Badge } from '@/components/ui/badge'
import { SerieForm } from '@/components/series/serie-form'
import { AdicionarVolumesDialog } from '@/components/series/adicionar-volumes-dialog'
import { CriarVolumesDialog } from '@/components/series/criar-volumes-dialog'
import { TipoBadge } from '@/components/ui/tipo-badge'
import { SerieProgress } from '@/components/series/serie-progress'
import { AvaliarSerie } from '@/components/series/avaliar-serie'
import { VolumesGrid } from '@/components/series/volumes-grid'
import { BackButton } from '@/components/ui/back-button'
import { ScrollRestore } from '@/components/ui/scroll-restore'

const MAX_FALTANTES_EXIBIDOS = 30

export default async function SeriePage({ params }: { params: Promise<{ id: string }> }) {
  const id = uuidOuNull((await params).id)
  if (!id) notFound()
  const supabase = await createClient()

  const { data: serie, error: erroSerie } = await supabase
    .from('series')
    .select('*, serie_tags(tag_id)')
    .eq('id', id)
    .maybeSingle()

  // Falha real do banco não pode virar "não encontrada": vai para o error.tsx.
  if (erroSerie) throw new Error(erroSerie.message)
  if (!serie) notFound()

  const [itens, { data: allTags }] = await Promise.all([
    listarItens(supabase, { serieId: id }, { column: 'numero_volume', ascending: true }),
    supabase.from('tags').select('id, nome, tipo, cor').order('nome'),
  ])

  const capaMap = urlsDeCapas(itens.map((i) => i.capa_url)
  )

  const tagIds = (serie.serie_tags ?? []).map((st: { tag_id: string }) => st.tag_id)

  const volumesFaltantes = calcularVolumesFaltantes(itens, serie.total_volumes)
  const completa = serieEstaCompleta({
    totalVolumes: serie.total_volumes,
    temNumeracao: Boolean(serie.tem_numeracao),
    volumes: itens,
  })
  const numerosOcupados = itens
    .map((i) => i.numero_volume)
    .filter((n): n is number => n !== null)
  const possuidos = itens.filter((i) => i.estado !== 'desejo').length
  const desejados = itens.length - possuidos
  const lidos = itens.filter((i) => i.estado === 'lido').length
  const notasAvaliadas = itens
    .filter((i) => i.estado === 'lido' && i.nota !== null)
    .map((i) => Number(i.nota))
  const mediaVolumes = notasAvaliadas.length > 0 ? notasAvaliadas.reduce((a, b) => a + b, 0) / notasAvaliadas.length : null
  const naFila = itens.filter((i) => i.estado === 'comprado').length
  const capaHero = itens.map((i) => capaMap.get(i.capa_url ?? '')).find(Boolean) ?? null
  const faltantesExibidos = volumesFaltantes.slice(0, MAX_FALTANTES_EXIBIDOS)
  const faltantesOcultos = volumesFaltantes.length - faltantesExibidos.length

  return (
    <div className="flex flex-col gap-6">
      <ScrollRestore />
      <BackButton />
      <div className="flex gap-4 lg:gap-8">
        <div className="relative aspect-[2/3] w-[92px] shrink-0 overflow-hidden rounded-lg bg-card ring-1 ring-white/10 lg:w-[168px]">
          {capaHero && <Image unoptimized src={capaHero} alt="" fill sizes="168px" className="object-cover" />}
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <TipoBadge tipo={serie.tipo} />
            {serie.tem_numeracao && <span className="text-xs text-muted-foreground">numerada</span>}
            {!serie.em_publicacao && <Badge variant="secondary">encerrada</Badge>}
            {completa && <Badge variant="sucesso">completa</Badge>}
          </div>
          <h1 className="font-heading text-[28px] leading-tight font-extrabold tracking-tight text-foreground lg:text-[44px]">
            {serie.nome}
          </h1>
          <p className="text-sm text-muted-foreground">
            {/* Só os adquiridos contam aqui, senão a conta não fecha com os furos:
                um volume só desejado apareceria ao mesmo tempo como tido e faltante. */}
            {possuidos} volume(ns) na coleção
            {serie.total_volumes ? ` de ${serie.total_volumes}` : ''}
            {desejados > 0 ? ` · ${desejados} na lista de desejos` : ''}
          </p>
          <SerieProgress lidos={lidos} naFila={naFila} faltando={volumesFaltantes.length} />
        </div>
      </div>

      {volumesFaltantes.length > 0 && (
        <div className="rounded-xl border border-warning/45 bg-warning/10 p-4">
          <p className="font-medium text-warning-text">
            {volumesFaltantes.length === 1 ? '1 furo na série' : `${volumesFaltantes.length} furos na série`}
          </p>
          <p className="text-sm text-warning-text">
            {volumesFaltantes.length === 1 ? 'Falta ' : 'Faltam '}
            {faltantesExibidos.map((n) => `#${n}`).join(', ')}
            {faltantesOcultos > 0 ? ` e mais ${faltantesOcultos}` : ''}
          </p>
        </div>
      )}

      <AvaliarSerie
        serieId={id}
        notaAtual={serie.nota === null ? null : Number(serie.nota)}
        criticaAtual={serie.critica}
        media={mediaVolumes}
        avaliados={notasAvaliadas.length}
        lidos={lidos}
      />

      <SerieForm serie={{ ...serie, tagIds }} allTags={allTags ?? []} />

      <div>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-heading text-sm font-semibold text-foreground/90">Volumes</h2>
          <div className="flex flex-wrap items-center gap-2">
            <CriarVolumesDialog
              serieId={id}
              serieNome={serie.nome}
              temNumeracao={Boolean(serie.tem_numeracao)}
              numerosOcupados={numerosOcupados}
              faltantes={volumesFaltantes}
            />
            <AdicionarVolumesDialog
              serieId={id}
              serieNome={serie.nome}
              temNumeracao={Boolean(serie.tem_numeracao)}
              numerosOcupados={numerosOcupados}
              tags={allTags ?? []}
            />
          </div>
        </div>
        {itens.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nenhum volume desta série na sua coleção ainda. Use &ldquo;Criar volumes&rdquo; para
            registrar o que você comprou, ou &ldquo;Adicionar volumes&rdquo; para agrupar itens que
            já estão na coleção.
          </p>
        ) : (
          <VolumesGrid
            serieId={id}
            itens={itens}
            capas={Array.from(capaMap.entries())}
            faltantes={volumesFaltantes}
          />
        )}
      </div>
    </div>
  )
}
