/** MMKV-shaped memory store: the production backend adapter still runs. */
const stores = new Map<string, Map<string, string>>();
export function createMMKV({ id }: { id: string }) {
  if (!stores.has(id)) stores.set(id, new Map());
  const data = stores.get(id)!;
  return {
    getString: (key: string) => data.get(key),
    set: (key: string, value: string) => data.set(key, value),
    remove: (key: string) => data.delete(key),
    getAllKeys: () => [...data.keys()],
  };
}
export function resetNativeStorage(): void { stores.clear(); }
export function open(): never { throw new Error('Native SQLite is not available in React interaction tests'); }
