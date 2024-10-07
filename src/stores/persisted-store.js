import { ref, watch } from "vue";
import { defineStore } from "pinia";

export const usePersistedStore = defineStore("persisted-store", () => {
    // OpenAI API key
    const apiKey = ref(loadStateFromLocalStorage("apiKey") || "");

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

    watch(apiKey, (newValue) => {
        saveStateToLocalStorage("apiKey", newValue);
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
        user,
        userName,
        userAvatar,
    };
});
