import { createClient } from '@/lib/supabase/server'
import { TagsManager } from '@/components/tags/tags-manager'

export default async function TagsPage() {
  const supabase = await createClient()
  const { data: tags } = await supabase
    .from('tags')
    .select('id, nome, tipo, cor, created_at, user_id')
    .order('tipo')
    .order('nome')

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Tags</h1>
        <p className="text-sm text-neutral-500">
          Renomeie, mude o tipo ou mescle tags duplicadas. Tags marcadas em uma série valem para
          todos os volumes dela.
        </p>
      </div>
      <TagsManager initialTags={tags ?? []} />
    </div>
  )
}
