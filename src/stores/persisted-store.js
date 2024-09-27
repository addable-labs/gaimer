import { ref, watch } from "vue";
import { defineStore } from "pinia";

export const usePersistedStore = defineStore("persisted-store", () => {
    const apiKey = ref(loadStateFromLocalStorage("apiKey") || "");
    const games = ref(loadStateFromLocalStorage("games") || []);

    function saveStateToLocalStorage(key, value) {
        localStorage.setItem(key, JSON.stringify(value));
    }

    function loadStateFromLocalStorage(key) {
        const value = localStorage.getItem(key);
        return value ? JSON.parse(value) : null;
    }

    function addGame(game) {
        games.value.push(game);
        saveStateToLocalStorage("games", games.value);
    }

    function updateGames(newGames) {
        games.value = newGames;
        saveStateToLocalStorage("games", games.value);
    }

    watch(apiKey, (newValue) => {
        saveStateToLocalStorage("apiKey", newValue);
    });

    watch(games, (newValue) => {
        saveStateToLocalStorage("games", newValue);
    });

    return {
        apiKey,
        games,
        addGame,
        updateGames,
    };
});
