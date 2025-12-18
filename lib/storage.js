const DB_NAME = 'HelloFromDB';
const DB_VERSION = 1;
const STORE_NAME = 'secure_storage';

export const initDB = () => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = (event) => reject("IndexedDB error: " + event.target.error);

    request.onsuccess = (event) => resolve(event.target.result);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
  });
};

export const saveToStorage = async (key, data) => {
  try {
    const db = await initDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.put(data, key);

      request.onsuccess = () => resolve();
      request.onerror = (event) => reject(event.target.error);
    });
  } catch (e) {
    console.error("Storage save error:", e);
    throw e;
  }
};

export const loadFromStorage = async (key) => {
  try {
    const db = await initDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(key);

      request.onsuccess = (event) => {
        let result = event.target.result;
        
        // Migration/Fallback: Check localStorage if not in DB
        if (result === undefined) {
            const localData = localStorage.getItem(key);
            if (localData) {
                // Return local data (it's a string)
                resolve(localData);
                return;
            }
        }
        resolve(result);
      };
      request.onerror = (event) => reject(event.target.error);
    });
  } catch (e) {
    console.error("Storage load error:", e);
    return null;
  }
};

export const removeFromStorage = async (key) => {
    try {
        const db = await initDB();
        // Also remove from localStorage to be sure
        localStorage.removeItem(key);
        
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([STORE_NAME], 'readwrite');
            const store = transaction.objectStore(STORE_NAME);
            const request = store.delete(key);
            
            request.onsuccess = () => resolve();
            request.onerror = (event) => reject(event.target.error);
        });
    } catch (e) {
        console.error("Storage remove error:", e);
    }
};
