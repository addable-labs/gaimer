import { ref, watch } from "vue";
import { defineStore } from "pinia";

export const usePersistedStore = defineStore("persisted-store", () => {
    const apiKey = ref(loadStateFromLocalStorage("fb_apiKey") || "");
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
        saveStateToLocalStorage("fb_apiKey", newValue);
    });

    watch(userName, (newValue) => {
        saveStateToLocalStorage("fb_userName", newValue);
    });

    watch(userAvatar, (newValue) => {
        saveStateToLocalStorage("fb_userAvatar", newValue);
    });

    return {
        apiKey,
        userName,
        userAvatar,
    };
});
