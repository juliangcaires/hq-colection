import { listarSeries } from './actions'
import { SeriesManager } from '@/components/series/series-manager'
import { ScrollRestore } from '@/components/ui/scroll-restore'

export default async function SeriesPage() {
  const series = await listarSeries('')

  return (
    <div className="flex flex-col gap-6">
      <ScrollRestore />
      <h1 className="font-heading text-[28px] font-extrabold tracking-tight text-foreground">Séries</h1>
      <SeriesManager initialSeries={series} />
    </div>
  )
}
