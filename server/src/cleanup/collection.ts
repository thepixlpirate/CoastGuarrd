import { jf, jellyfinReady } from '../jellyfin/client.js';
import { getState, setState } from '../lib/state.js';

/**
 * Keeps a Jellyfin collection (default "Leaving Soon") in step with the
 * titles that are flagged, so the family can see them in one place.
 */

interface Box {
  Id: string;
  Name: string;
}

async function findByName(name: string): Promise<string | null> {
  const res = await jf<{ Items: Box[] }>(`/Items?IncludeItemTypes=BoxSet&Recursive=true&SearchTerm=${encodeURIComponent(name)}`);
  return res.Items?.find((i) => i.Name.toLowerCase() === name.toLowerCase())?.Id ?? null;
}

async function exists(id: string): Promise<boolean> {
  try {
    const res = await jf<{ Items: Box[] }>(`/Items?Ids=${id}&Recursive=true`);
    return (res.Items ?? []).length > 0;
  } catch {
    return false;
  }
}

async function children(id: string): Promise<string[]> {
  const res = await jf<{ Items: { Id: string }[] }>(`/Items?ParentId=${id}&EnableImages=false`);
  return (res.Items ?? []).map((i) => i.Id);
}

/** Makes the collection contain exactly `ids`. An empty list removes the collection. */
export async function syncCollection(name: string, ids: string[]) {
  if (!jellyfinReady()) return;
  let id = getState<string | null>('collection:id', null);
  if (id && !(await exists(id))) id = null;
  if (!id) id = await findByName(name);

  if (!ids.length) {
    if (id) {
      // Remove our collection entirely so an empty row doesn't show in Jellyfin.
      await jf(`/Items/${id}`, { method: 'DELETE' }).catch(async () => {
        const cur = await children(id!);
        if (cur.length) await jf(`/Collections/${id}/Items?Ids=${cur.join(',')}`, { method: 'DELETE' });
      });
    }
    setState('collection:id', null);
    return;
  }

  if (!id) {
    const created = await jf<{ Id: string }>(`/Collections?Name=${encodeURIComponent(name)}&Ids=${ids.slice(0, 50).join(',')}&IsLocked=true`, { method: 'POST' });
    id = created.Id;
  }
  setState('collection:id', id);
  const current = new Set(await children(id));
  const want = new Set(ids);
  const add = ids.filter((i) => !current.has(i));
  const remove = [...current].filter((i) => !want.has(i));
  for (let i = 0; i < add.length; i += 50) await jf(`/Collections/${id}/Items?Ids=${add.slice(i, i + 50).join(',')}`, { method: 'POST' });
  for (let i = 0; i < remove.length; i += 50) await jf(`/Collections/${id}/Items?Ids=${remove.slice(i, i + 50).join(',')}`, { method: 'DELETE' });
}
