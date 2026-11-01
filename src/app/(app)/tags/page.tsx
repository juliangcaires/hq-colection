import { createClient } from '@/lib/supabase/server'
import { TagsManager } from '@/components/tags/tags-manager'
import { ScrollRestore } from '@/components/ui/scroll-restore'

export default async function TagsPage() {
  const supabase = await createClient()
  const { data: tags } = await supabase
    .from('tags')
    .select('id, nome, tipo, cor, created_at, user_id')
    .order('tipo')
    .order('nome')

  return (
    <div className="flex flex-col gap-6">
      <ScrollRestore />
      <div>
        <h1 className="font-heading text-[28px] font-extrabold tracking-tight text-foreground">Tags</h1>
        <p className="text-sm text-muted-foreground">
          Tags aplicadas a uma série são herdadas por todos os volumes dela.
        </p>
      </div>
      <TagsManager initialTags={tags ?? []} />
    </div>
  )
}
