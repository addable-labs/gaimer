import { ref, watch } from "vue";
import { defineStore } from "pinia";

export const useAppStore = defineStore("app-store", () => {
    // Helper functions to save and load state from local storage
    const saveState = (key, state) => {
        localStorage.setItem(key, JSON.stringify(state));
    };

    const loadState = (key) => {
        const state = localStorage.getItem(key);
        return state ? JSON.parse(state) : null;
    };

    // Shared states
    const gameDescription = ref("");
    const aiResponse = ref("");
    const generating = ref(false);

    // Stored states
    const apiKey = ref(loadState("apiKey") || "");

    // Watch stored states changes and save to local storage
    watch(apiKey, (newValue) => saveState("apiKey", newValue));

    return {
        aiResponse,
        apiKey,
        gameDescription,
        generating,
    };
});
