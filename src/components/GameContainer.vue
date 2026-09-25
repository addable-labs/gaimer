<script setup>
import { computed, nextTick, onMounted, onBeforeUnmount, ref, watchEffect } from "vue";
import { useQuasar } from "quasar";
import { useAppStore } from "../stores/app-store.js";
import { createSandbox } from "../engine/sandbox.js";
import { saveGameState, loadGameState } from "../helpers/game-storage.js";

const { game } = defineProps(["game"]);
const $q = useQuasar();
const appStore = useAppStore();
const gameId = computed(() => appStore.loadedGame);

let sandbox = null;
const containerRef = ref(null);
const saveSupported = ref(false);
const saving = ref(false);

async function probeSaveSupport() {
    if (!sandbox) return;
    try {
        await sandbox.requestSave();
        saveSupported.value = true;
    } catch {
        saveSupported.value = false;
    }
}

async function checkAndOfferRestore() {
    if (!saveSupported.value || !gameId.value) return;
    const stateData = await loadGameState(gameId.value);
    if (!stateData) return;

    $q.dialog({
        title: "Restore progress?",
        message: "A saved game state was found. Would you like to restore it?",
        dark: true,
        cancel: { flat: true, color: "grey-5", label: "Start fresh" },
        ok: { flat: true, color: "primary", label: "Restore" },
    }).onOk(() => {
        if (sandbox) sandbox.requestRestore(stateData);
    });
}

async function onSave() {
    if (!sandbox || !gameId.value) return;
    saving.value = true;
    try {
        const stateData = await sandbox.requestSave();
        await saveGameState(gameId.value, stateData);
        $q.notify({ message: "Game saved", position: "top", color: "positive", timeout: 1500 });
    } catch {
        $q.notify({ message: "Save failed", position: "top", color: "negative", timeout: 2000 });
    } finally {
        saving.value = false;
    }
}

// The container's size in whole pixels
function containerSize() {
    const rect = containerRef.value.getBoundingClientRect();
    return { width: Math.floor(rect.width), height: Math.floor(rect.height) };
}

function loadGameScript() {
    const container = containerRef.value;
    if (!container || !game.code) return;

    saveSupported.value = false;

    // Destroy previous sandbox if it exists
    if (sandbox) {
        sandbox.destroy();
        sandbox = null;
    }

    // Create a new sandboxed iframe for the game, the size of the container
    sandbox = createSandbox(container, containerSize());

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
            // Probe for save/restore support, then offer restore if available
            probeSaveSupport().then(() => checkAndOfferRestore());
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

// When the container changes size (the window is resized, the device
// rotates), scale the game to fit it. Loading the game again at the new size
// would restart it and lose the player's progress.
function fitGameToContainer() {
    if (!sandbox || !containerRef.value) return;
    const { width, height } = containerSize();
    sandbox.scaleToFit(width, height);
}

// Watches the container rather than the window: Quasar sets the page's
// height a moment after the window resizes
let resizeObserver = null;

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
    resizeObserver = new ResizeObserver(fitGameToContainer);
    resizeObserver.observe(containerRef.value);
});

onBeforeUnmount(() => {
    document.removeEventListener("visibilitychange", handleVisibilityChange);
    resizeObserver.disconnect();
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
        <q-space />
        <q-btn
            v-if="saveSupported"
            flat
            dense
            icon="mdi-content-save"
            color="grey-5"
            :loading="saving"
            @click="onSave"
        >
            <q-tooltip :delay="500">Save game</q-tooltip>
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
/* The game's iframe is positioned absolutely within it, so the iframe's
   size never changes the wrapper's */
.game-canvas-wrapper {
    position: relative;
    flex: 1;
    width: 100%;
    min-height: 0;
    overflow: hidden;
    background: #1a1a1a;
}

.game-info-bar {
    display: flex;
    gap: 4px;
    padding: 4px 8px;
    background: #1a1a1a;
}
</style>
