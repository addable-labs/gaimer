const DB_NAME = "GaimerDB";
const DB_VERSION = 21;
const STORE_NAME = "games";

const IndexedDBClient = () => {
    let db = null;
    let useInlineKeys = true; // Default assumption

    function initDB() {
        return new Promise((resolve, reject) => {
            if (!window.indexedDB) {
                reject(
                    new Error("IndexedDB is not supported in this browser."),
                );
                return;
            }

            const request = indexedDB.open(DB_NAME, DB_VERSION);

            request.onupgradeneeded = (event) => {
                db = event.target.result;
                if (!db.objectStoreNames.contains(STORE_NAME)) {
                    db.createObjectStore(STORE_NAME, { keyPath: "id" });
                }
            };

            request.onsuccess = (event) => {
                db = event.target.result;
                const transaction = db.transaction([STORE_NAME], "readonly");
                const store = transaction.objectStore(STORE_NAME);
                useInlineKeys = store.keyPath !== null; // Determine if keys are in-line
                resolve();
            };

            request.onerror = (event) => {
                reject(event.target.error);
            };

            request.onblocked = () => {
                console.warn(
                    "Database upgrade is blocked. Please close other tabs with this site open.",
                );
            };
        });
    }

    function addItem(item) {
        return new Promise((resolve, reject) => {
            if (!db) {
                reject(new Error("Database is not initialized."));
                return;
            }

            const transaction = db.transaction([STORE_NAME], "readwrite");
            const store = transaction.objectStore(STORE_NAME);
            const request = useInlineKeys
                ? store.add(item)
                : store.add(item, item.id);

            request.onsuccess = () => {
                resolve();
            };

            request.onerror = (event) => {
                reject(event.target.error);
            };
        });
    }

    function putItem(item) {
        return new Promise((resolve, reject) => {
            if (!db) {
                reject(new Error("Database is not initialized."));
                return;
            }

            const transaction = db.transaction([STORE_NAME], "readwrite");
            const store = transaction.objectStore(STORE_NAME);
            const request = useInlineKeys
                ? store.put(item)
                : store.put(item, item.id);

            request.onsuccess = () => {
                resolve();
            };

            request.onerror = (event) => {
                reject(event.target.error);
            };
        });
    }

    function listItems() {
        return new Promise((resolve, reject) => {
            if (!db) {
                reject(new Error("Database is not initialized."));
                return;
            }

            const transaction = db.transaction([STORE_NAME], "readonly");
            const store = transaction.objectStore(STORE_NAME);
            const request = store.getAll();

            request.onsuccess = (event) => {
                resolve(event.target.result);
            };

            request.onerror = (event) => {
                reject(event.target.error);
            };
        });
    }

    function getItem(key) {
        return new Promise((resolve, reject) => {
            if (!db) {
                reject(new Error("Database is not initialized."));
                return;
            }

            const transaction = db.transaction([STORE_NAME], "readonly");
            const store = transaction.objectStore(STORE_NAME);
            const request = store.get(key);

            request.onsuccess = (event) => {
                resolve(event.target.result);
            };

            request.onerror = (event) => {
                reject(event.target.error);
            };
        });
    }

    function deleteItem(id) {
        return new Promise((resolve, reject) => {
            if (!db) {
                reject(new Error("Database is not initialized."));
                return;
            }

            const transaction = db.transaction([STORE_NAME], "readwrite");
            const store = transaction.objectStore(STORE_NAME);
            const request = store.delete(id);

            request.onsuccess = () => {
                resolve();
            };

            request.onerror = (event) => {
                reject(event.target.error);
            };
        });
    }

    return {
        initDB,
        addItem,
        putItem,
        getItem,
        listItems,
        deleteItem,
    };
};

export default IndexedDBClient;
