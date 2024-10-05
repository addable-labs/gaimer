import { ref } from "vue";
import { defineStore } from "pinia";

export const useAppStore = defineStore("app-store", () => {
    // Shared states
    const gameDescription = ref("");
    const loadedGame = ref(null);
    const gameList = ref([]);

    return {
        gameDescription,
        loadedGame,
        gameList,
    };
});
