import { ref, watch } from "vue";
import { defineStore } from "pinia";
import { createCredentialStore } from "../credentials/credential-store.js";

const credentials = createCredentialStore();

export const usePersistedStore = defineStore("persisted-store", () => {
    // OpenAI API key – loaded asynchronously from credential store
    const apiKey = ref("");
    const apiKeyReady = ref(false);

    // Selected AI provider, and the model chosen for each provider
    // ("" means the provider's default)
    const selectedProvider = ref(loadStateFromLocalStorage("selectedProvider") || "openai");
    const selectedModels = ref(loadSelectedModels());

    function saveStateToLocalStorage(key, value) {
        localStorage.setItem(key, JSON.stringify(value));
    }

    function loadStateFromLocalStorage(key) {
        const value = localStorage.getItem(key);
        return value ? JSON.parse(value) : null;
    }

    function loadSelectedModels() {
        const models = { openai: "", anthropic: "" };
        const saved = loadStateFromLocalStorage("selectedModels");
        if (saved) return { ...models, ...saved };

        // One-time migration: earlier versions kept a single model for both
        // providers. Give it to the provider it belongs to: Claude model
        // names start with "claude", and every other one was OpenAI's.
        const legacy = loadStateFromLocalStorage("selectedModel");
        if (legacy) {
            models[legacy.startsWith("claude") ? "anthropic" : "openai"] = legacy;
        }
        saveStateToLocalStorage("selectedModels", models);
        localStorage.removeItem("selectedModel");
        return models;
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

    watch(selectedModels, (newValue) => {
        saveStateToLocalStorage("selectedModels", newValue);
    }, { deep: true });

    return {
        apiKey,
        apiKeyReady,
        selectedProvider,
        selectedModels,
        init,
    };
});
