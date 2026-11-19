/**
 * The computers this browser is paired with. Each record holds the device's key as a `CryptoKey`
 * that cannot be exported: IndexedDB stores the key itself, so this origin's scripts can use it
 * and none can read it. A browser without IndexedDB (some private windows) pairs for the visit
 * only.
 */
/**
 * How a computer looks: its theme (one of the desktop's, by its saved name) and appearance. Kept
 * with the pairing, so the page wears it before the computer answers.
 */
export interface Look {
  readonly theme: string;
  readonly appearance: "system" | "light" | "dark";
}

export interface SavedHost {
  readonly hostId: string;
  readonly hostName: string;
  readonly deviceId: string;
  readonly key: CryptoKey;
  readonly pairedAt: number;
  /** As the computer last said; absent until it says. */
  readonly look?: Look;
}

const NAME = "auracode-remote";
const STORE = "hosts";
const memory = new Map<string, SavedHost>();
let persistent = true;

function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE, { keyPath: "hostId" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function run<T>(
  mode: IDBTransactionMode,
  work: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await database();
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = db.transaction(STORE, mode);
      const request = work(transaction.objectStore(STORE));
      transaction.oncomplete = () => resolve(request.result);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally {
    db.close();
  }
}

/** Whether pairings survive closing the page. */
export function keepsPairings(): boolean {
  return persistent;
}

export async function loadHosts(): Promise<SavedHost[]> {
  try {
    const hosts = await run<SavedHost[]>("readonly", (store) => store.getAll());
    return hosts.sort((a, b) => b.pairedAt - a.pairedAt);
  } catch {
    persistent = false;
    return [...memory.values()];
  }
}

export async function saveHost(host: SavedHost): Promise<void> {
  memory.set(host.hostId, host);
  try {
    await run("readwrite", (store) => store.put(host));
  } catch {
    persistent = false;
  }
}

export async function deleteHost(hostId: string): Promise<void> {
  memory.delete(hostId);
  try {
    await run("readwrite", (store) => store.delete(hostId));
  } catch {
    persistent = false;
  }
}
