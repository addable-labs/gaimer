<script setup>
import { nextTick, onMounted, onBeforeUnmount, ref, watchEffect } from "vue";
import { useQuasar } from "quasar";
import { createSandbox } from "../engine/sandbox.js";

const { game } = defineProps(["game"]);
const $q = useQuasar();

let sandbox = null;
const containerRef = ref(null);

function loadGameScript() {
    const container = containerRef.value;
    if (!container || !game.code) return;

    // Destroy previous sandbox if it exists
    if (sandbox) {
        sandbox.destroy();
        sandbox = null;
    }

    // Calculate size from the container's actual dimensions
    const rect = container.getBoundingClientRect();
    const width = Math.floor(rect.width);
    const height = Math.floor(rect.height);

    // Create a new sandboxed iframe for the game
    sandbox = createSandbox(container, { width, height });

    // Listen for messages from the sandbox
    sandbox.onMessage((msg) => {
        if (msg.type === "error") {
            console.error("Game error:", msg.data?.message);
            $q.notify({
                message: `Game error: ${msg.data?.message || "Unknown error"}`,
                position: "top",
                color: "negative",
            });
        } else if (msg.type === "ready") {
            console.log("Game ready in sandbox");
        }
    });

    // Load the game code into the sandbox
    sandbox.loadGame(game.code);
}

// Handle visibility changes for pause/resume
function handleVisibilityChange() {
    if (!sandbox) return;
    if (document.hidden) {
        sandbox.postMessage("pause", {});
    } else {
        sandbox.postMessage("resume", {});
    }
}

// Handle resize for responsive canvas
function handleResize() {
    if (!sandbox || !containerRef.value) return;
    // Reload game with new dimensions
    loadGameScript();
}

let resizeTimeout = null;
function debouncedResize() {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(handleResize, 300);
}

// Game info to display below the game canvas
const gameInfo = ref([
    { text: game.controls, icon: "mdi-gamepad-outline" },
    { text: game.rules, icon: "mdi-book-open-variant-outline" },
]);

const displayNotification = (message) => {
    $q.notify({
        message: message,
        position: "top",
    });
};

watchEffect(async () => {
    console.log("Game content updated");
    await nextTick();
    loadGameScript();
});

onMounted(() => {
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("resize", debouncedResize);
});

onBeforeUnmount(() => {
    document.removeEventListener("visibilitychange", handleVisibilityChange);
    window.removeEventListener("resize", debouncedResize);
    clearTimeout(resizeTimeout);
    if (sandbox) {
        sandbox.destroy();
        sandbox = null;
    }
});
</script>

<template>
    <div class="game-container-root">
    <div ref="containerRef" class="game-canvas-wrapper">
    </div>
    <div class="game-info-bar">
        <q-btn
            v-for="item in gameInfo"
            :key="item.icon"
            color="primary-darkened"
            flat
            dense
            :icon="item.icon"
            @click="displayNotification(item.text)"
        >
            <q-tooltip
                :delay="500"
                max-width="300px"
                transition-show="scale"
                transition-hide="scale"
            >
                {{ item.text }}
            </q-tooltip>
        </q-btn>
    </div>
    </div>
</template>

<style scoped>
.game-container-root {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
}
.game-canvas-wrapper {
    flex: 1;
    width: 100%;
    min-height: 0;
    overflow: hidden;
    background: #1a1a1a;
    display: flex;
    justify-content: center;
    align-items: center;
}
.game-canvas-wrapper :deep(iframe) {
    max-width: 100%;
    max-height: 100%;
}

.game-info-bar {
    display: flex;
    gap: 4px;
    padding: 4px 8px;
    background: #1a1a1a;
}
</style>
