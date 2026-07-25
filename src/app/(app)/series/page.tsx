import { listarSeries } from './actions'
import { SeriesManager } from '@/components/series/series-manager'

export default async function SeriesPage() {
  const series = await listarSeries('')

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Séries</h1>
        <p className="text-sm text-neutral-500">
          Gerencie suas séries sem precisar passar por um item. Edição completa (editora, tags,
          total de volumes) fica na página de cada série.
        </p>
      </div>
      <SeriesManager initialSeries={series} />
    </div>
  )
}
