'use client'

import { useEffect, useRef, useState } from 'react'
import { Camera, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { classificarCodigo, criarLeitor } from '@/lib/leitor-codigo'

const INTERVALO_LEITURA_MS = 250
/** Mesmo código repetido dentro desta janela é ignorado (a câmera "vê" o mesmo livro vários quadros seguidos). */
const JANELA_REPETICAO_MS = 2500

function mensagemDeErroDaCamera(e: unknown): string {
  const nome = e instanceof DOMException ? e.name : ''
  if (!window.isSecureContext) return 'A câmera só funciona em conexão segura (https).'
  if (nome === 'NotAllowedError' || nome === 'SecurityError') return 'Permita o acesso à câmera nas configurações do navegador para escanear.'
  if (nome === 'NotFoundError' || nome === 'OverconstrainedError') return 'Não encontrei uma câmera neste aparelho.'
  if (nome === 'NotReadableError') return 'A câmera está em uso por outro app.'
  return 'Não consegui abrir a câmera.'
}

/**
 * Câmera que lê o código de barras de um livro. Entrega só ISBN (EAN-13 começando com 978/979);
 * outros códigos mostram "Este código não é um ISBN". Com `continuo`, segue lendo após cada acerto
 * (modo prateleira); sem ele, para na primeira leitura.
 */
export function LeitorIsbn({
  onIsbn,
  onFechar,
  continuo = false,
}: {
  onIsbn: (isbn13: string) => void
  onFechar: () => void
  continuo?: boolean
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [carregando, setCarregando] = useState(true)
  // Callbacks por ref: o efeito da câmera roda uma vez e não reinicia a cada render do pai.
  const onIsbnRef = useRef(onIsbn)
  const onFecharRef = useRef(onFechar)
  useEffect(() => {
    onIsbnRef.current = onIsbn
    onFecharRef.current = onFechar
  })

  useEffect(() => {
    let ativo = true
    let stream: MediaStream | null = null
    let timer: ReturnType<typeof setTimeout> | undefined
    const recentes = new Map<string, number>()

    async function iniciar() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setErro(mensagemDeErroDaCamera(null))
        setCarregando(false)
        return
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        })
        if (!ativo) return stream.getTracks().forEach((t) => t.stop())
        const video = videoRef.current
        if (!video) return
        video.srcObject = stream
        await video.play()
        const leitor = await criarLeitor()
        if (!ativo) return
        setCarregando(false)

        const ciclo = async () => {
          if (!ativo) return
          const codigo = await leitor.ler(video).catch(() => null)
          if (codigo && ativo) {
            const agora = Date.now()
            const visto = recentes.get(codigo)
            if (visto === undefined || agora - visto > JANELA_REPETICAO_MS) {
              recentes.set(codigo, agora)
              const r = classificarCodigo(codigo)
              if (r.tipo === 'isbn') {
                setAviso(null)
                navigator.vibrate?.(60)
                onIsbnRef.current(r.isbn13)
                if (!continuo) return // para de ler: o pai fecha o leitor
              } else {
                setAviso('Este código não é um ISBN. Procure o código de barras do verso do livro (começa com 978).')
              }
            }
          }
          timer = setTimeout(ciclo, INTERVALO_LEITURA_MS)
        }
        ciclo()
      } catch (e) {
        if (ativo) {
          setErro(mensagemDeErroDaCamera(e))
          setCarregando(false)
        }
      }
    }
    iniciar()

    return () => {
      ativo = false
      if (timer) clearTimeout(timer)
      stream?.getTracks().forEach((t) => t.stop())
    }
  }, [continuo])

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-border bg-surface-2 p-2">
      <div className="relative aspect-[4/3] w-full overflow-hidden rounded-lg bg-black">
        {/* `muted` + `playsInline`: sem isso o iOS recusa tocar o vídeo da câmera dentro da página. */}
        <video ref={videoRef} muted playsInline className="size-full object-cover" aria-label="Imagem da câmera" />
        {!erro && !carregando && (
          <div aria-hidden className="pointer-events-none absolute inset-x-[8%] top-1/2 h-px bg-danger-text/80 shadow-[0_0_8px_2px] shadow-danger-text/50" />
        )}
        {carregando && !erro && (
          <div className="absolute inset-0 grid place-items-center text-sm text-white/80">
            <span className="flex items-center gap-2"><Camera className="size-4" aria-hidden /> Abrindo a câmera...</span>
          </div>
        )}
        <Button
          variant="secondary"
          className="absolute top-2 right-2 size-11 p-0"
          aria-label="Fechar câmera"
          onClick={() => onFecharRef.current()}
        >
          <X className="size-5" aria-hidden />
        </Button>
      </div>
      {erro ? (
        <p role="alert" className="px-1 text-sm text-danger-text">{erro} Você pode digitar o ISBN.</p>
      ) : (
        <p role="status" className="px-1 text-xs text-muted-foreground">
          {aviso ?? 'Aponte para o código de barras do verso do livro e deixe-o dentro da linha.'}
        </p>
      )}
    </div>
  )
}
