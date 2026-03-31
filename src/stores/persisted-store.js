import { ref, watch } from "vue";
import { defineStore } from "pinia";
import { createCredentialStore } from "../credentials/credential-store.js";

const credentials = createCredentialStore();

export const usePersistedStore = defineStore("persisted-store", () => {
    // OpenAI API key – loaded asynchronously from credential store
    const apiKey = ref("");
    const apiKeyReady = ref(false);

    // Selected AI provider
    const selectedProvider = ref(loadStateFromLocalStorage("selectedProvider") || "openai");

    // Firebase user
    const user = ref(loadStateFromLocalStorage("fb_user") || "");
    const userName = ref(loadStateFromLocalStorage("fb_userName") || "");
    const userAvatar = ref(loadStateFromLocalStorage("fb_userAvatar") || "");

    function saveStateToLocalStorage(key, value) {
        localStorage.setItem(key, JSON.stringify(value));
    }

    function loadStateFromLocalStorage(key) {
        const value = localStorage.getItem(key);
        return value ? JSON.parse(value) : null;
    }

    // Load API key from credential store (and migrate from localStorage if needed)
    async function init() {
        try {
            const stored = await credentials.get("openai", "apiKey");
            if (stored) {
                apiKey.value = stored;
            } else {
                // One-time migration from localStorage
                const legacy = loadStateFromLocalStorage("apiKey");
                if (legacy) {
                    apiKey.value = legacy;
                    await credentials.set("openai", "apiKey", legacy);
                    localStorage.removeItem("apiKey");
                }
            }
        } catch (err) {
            console.warn("Credential store init failed, falling back to localStorage:", err);
            const legacy = loadStateFromLocalStorage("apiKey");
            if (legacy) apiKey.value = legacy;
        }
        apiKeyReady.value = true;
    }

    // Persist API key changes to credential store
    watch(apiKey, async (newValue) => {
        if (!apiKeyReady.value) return;
        if (newValue) {
            await credentials.set("openai", "apiKey", newValue);
        } else {
            await credentials.remove("openai", "apiKey");
        }
    });

    watch(selectedProvider, (newValue) => {
        saveStateToLocalStorage("selectedProvider", newValue);
    });

    watch(user, (newValue) => {
        saveStateToLocalStorage("fb_user", newValue);
    });
    watch(userName, (newValue) => {
        saveStateToLocalStorage("fb_userName", newValue);
    });
    watch(userAvatar, (newValue) => {
        saveStateToLocalStorage("fb_userAvatar", newValue);
    });

    return {
        apiKey,
        apiKeyReady,
        selectedProvider,
        init,
        user,
        userName,
        userAvatar,
    };
});
