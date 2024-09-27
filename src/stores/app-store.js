import { ref } from "vue";
import { defineStore } from "pinia";

export const useAppStore = defineStore("app-store", () => {
    // Shared states
    const gameDescription = ref("");
    const aiResponse = ref("");
    const generating = ref(false);

    return {
        aiResponse,
        gameDescription,
        generating,
    };
});
