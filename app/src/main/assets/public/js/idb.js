// Minimal IndexedDB helper — no external dependency, works fully offline.
const DB_NAME = "smart_energy_db";
const DB_VERSION = 1;
const STORES = ["energyHistory", "activityLogs"];

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (!("indexedDB" in window)) {
      reject(new Error("IndexedDB not supported"));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      STORES.forEach((name) => {
        if (!db.objectStoreNames.contains(name)) {
          db.createObjectStore(name, { keyPath: "id", autoIncrement: true });
        }
      });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

export async function idbGetAll(storeName) {
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, "readonly");
      const store = tx.objectStore(storeName);
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.warn("idbGetAll fallback (storage unavailable):", err.message);
    return [];
  }
}

export async function idbAdd(storeName, value) {
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, "readwrite");
      const store = tx.objectStore(storeName);
      const req = store.add(value);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.warn("idbAdd failed:", err.message);
    return null;
  }
}

export async function idbClear(storeName) {
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, "readwrite");
      tx.objectStore(storeName).clear();
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.warn("idbClear failed:", err.message);
    return false;
  }
}

export async function idbBulkPut(storeName, items) {
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, "readwrite");
      const store = tx.objectStore(storeName);
      items.forEach((item) => store.put(item));
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.warn("idbBulkPut failed:", err.message);
    return false;
  }
}

export async function idbTrim(storeName, maxItems) {
  try {
    const all = await idbGetAll(storeName);
    if (all.length <= maxItems) return;
    const sorted = all.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
    const toRemove = sorted.slice(0, sorted.length - maxItems);
    const db = await openDb();
    const tx = db.transaction(storeName, "readwrite");
    const store = tx.objectStore(storeName);
    toRemove.forEach((item) => store.delete(item.id));
  } catch (err) {
    console.warn("idbTrim failed:", err.message);
  }
}

export { STORES };
