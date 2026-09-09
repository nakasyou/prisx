export type Draft = {
  id: string;
  userId: string;
  workspaceId: string;
  entityId: string;
  body: string;
  expectedRevision: number;
  updatedAt: number;
};
function connect(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open("prisx-drafts", 1);
    r.onupgradeneeded = () =>
      r.result.createObjectStore("drafts", { keyPath: "id" });
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
async function op<T>(
  mode: IDBTransactionMode,
  fn: (s: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await connect();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("drafts", mode),
      req = fn(tx.objectStore("drafts"));
    tx.oncomplete = () => {
      resolve(req.result);
      db.close();
    };
    tx.onerror = () => {
      reject(tx.error);
      db.close();
    };
  });
}
export const draftKey = (u: string, w: string, e: string) =>
  [u, w, e].join(":");
export const saveDraft = (d: Draft) => op("readwrite", (s) => s.put(d));
export const readDraft = (id: string) =>
  op<Draft | undefined>("readonly", (s) => s.get(id));
export const removeDraft = (id: string) => op("readwrite", (s) => s.delete(id));
export async function clearDrafts(userId: string) {
  const all = await op<Draft[]>("readonly", (s) => s.getAll());
  await Promise.all(
    all.filter((d) => d.userId === userId).map((d) => removeDraft(d.id)),
  );
}
