import { ref, watch } from "vue";
import { defineStore } from "pinia";
import { createCredentialStore } from "../credentials/credential-store.js";

const credentials = createCredentialStore();

// The Claude models earlier versions offered by their full names, and the
// alias that replaced each: the Claude CLI's name for the latest model of
// the same kind
const claudeAliases = new Map([
    ["claude-sonnet-4-6", "sonnet"],
    ["claude-opus-4-6", "opus"],
    ["claude-haiku-4-5", "haiku"],
]);

export const usePersistedStore = defineStore("persisted-store", () => {
    // OpenAI API key – loaded asynchronously from credential store
    const apiKey = ref("");
    const apiKeyReady = ref(false);
    // Why the credential store could not load or save the key, for Settings
    const apiKeyError = ref("");

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
        const saved = loadStateFromLocalStorage("selectedModels");
        const models = { openai: "", anthropic: "", ...saved };
        if (!saved) {
            // One-time migration: earlier versions kept a single model for
            // both providers. Give it to the provider it belongs to: Claude
            // model names start with "claude", and every other one was
            // OpenAI's.
            const legacy = loadStateFromLocalStorage("selectedModel");
            if (legacy) {
                models[legacy.startsWith("claude") ? "anthropic" : "openai"] = legacy;
            }
            localStorage.removeItem("selectedModel");
        }

        // A Claude model saved by its full name becomes its alias, which
        // Settings offers now
        models.anthropic = claudeAliases.get(models.anthropic) ?? models.anthropic;
        saveStateToLocalStorage("selectedModels", models);
        return models;
    }

    // Load API key from credential store (and migrate from localStorage if needed)
    async function init() {
        try {
            await credentials.importOldVault();
        } catch (err) {
            apiKeyError.value = String(err);
        }
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
            apiKeyError.value = `Could not load the API key from the system keychain: ${err}`;
            const legacy = loadStateFromLocalStorage("apiKey");
            if (legacy) apiKey.value = legacy;
        }
        apiKeyReady.value = true;
    }

    // Persist API key changes to credential store. A key that could not be
    // saved still works until the app quits. The watcher runs synchronously,
    // so the key init() loads is not written back.
    watch(apiKey, async (newValue) => {
        if (!apiKeyReady.value) return;
        try {
            if (newValue) {
                await credentials.set("openai", "apiKey", newValue);
            } else {
                await credentials.remove("openai", "apiKey");
            }
            apiKeyError.value = "";
        } catch (err) {
            apiKeyError.value = newValue
                ? `Could not save the API key in the system keychain, so it works only until gaimer quits: ${err}`
                : `Could not delete the API key from the system keychain: ${err}`;
        }
    }, { flush: "sync" });

    watch(selectedProvider, (newValue) => {
        saveStateToLocalStorage("selectedProvider", newValue);
    });

    watch(selectedModels, (newValue) => {
        saveStateToLocalStorage("selectedModels", newValue);
    }, { deep: true });

    return {
        apiKey,
        apiKeyReady,
        apiKeyError,
        selectedProvider,
        selectedModels,
        init,
    };
});
