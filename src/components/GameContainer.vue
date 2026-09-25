<script setup>
import { computed, onMounted, onBeforeUnmount, ref } from "vue";
import { useQuasar } from "quasar";
import { useAppStore } from "../stores/app-store.js";
import { createSandbox } from "../engine/sandbox.js";
import { saveGameState, loadGameState } from "../helpers/game-storage.js";

const { game } = defineProps(["game"]);
const emit = defineEmits(["startError"]);
const $q = useQuasar();
const appStore = useAppStore();
const gameId = computed(() => appStore.loadedGame);

let sandbox = null;
const containerRef = ref(null);
const saveSupported = ref(false);
const saving = ref(false);
// The message of the game error logged last
let loggedError = null;

// A game fails as it starts when it reports an error before it is ready (a
// syntax error, or an error its start code throws), or in its first
// START_SECONDS seconds after that. Those seconds cover its first frames and
// the timers and countdowns it starts with, while the player has not got far
// yet. A game with a start screen plays only from the player's first input,
// and an error that only play sets off (the first collision, the first
// spawn) can come after those seconds: the START_SECONDS seconds after that
// input count as well. Only seconds with the page visible count: a hidden
// page runs no frames, and the game is paused. The first such error goes to
// App as startError, and no later one.
const START_SECONDS = 5;
// Whether the game has sent ready, whether its page has reported the
// player's first input, and whether an error has gone to App as startError
let ready = false;
let inputSeen = false;
let startErrorSent = false;
// The seconds left to count, from ready or from the first input
let startSecondsLeft = 0;
let startClock = null;

// Counts START_SECONDS seconds from now, in which an error is still one the
// game fails with as it starts
function countStartSeconds() {
    stopStartClock();
    startSecondsLeft = START_SECONDS;
    startClock = setInterval(() => {
        if (!document.hidden && --startSecondsLeft === 0) stopStartClock();
    }, 1000);
}

function stopStartClock() {
    clearInterval(startClock);
    startClock = null;
}

// A line or column number from the game page, or undefined if it is not one
function lineOrColumn(value) {
    return Number.isInteger(value) && value > 0 ? value : undefined;
}

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
    } catch (error) {
        // Say why: the game's state could not be sent, the game did not
        // answer, or the state file could not be written. Tauri's file
        // system rejects with a string.
        $q.notify({
            message: `Save failed: ${error.message || String(error)}`,
            position: "top",
            color: "negative",
            timeout: 2000,
        });
    } finally {
        saving.value = false;
    }
}

// The container's size in whole pixels
function containerSize() {
    const rect = containerRef.value.getBoundingClientRect();
    return { width: Math.floor(rect.width), height: Math.floor(rect.height) };
}

// Loads the game into the container. It runs once: App gives each game a
// GameContainer of its own.
function loadGameScript() {
    const container = containerRef.value;
    if (!container || !game.code) return;

    // Create a sandboxed iframe for the game, the size of the container
    sandbox = createSandbox(container, containerSize());

    // Listen for messages from the sandbox
    sandbox.onMessage((msg) => {
        if (msg.type === "error") {
            // A game that throws on every frame sends the same error every
            // frame: log it once
            if (msg.data?.message !== loggedError) {
                loggedError = msg.data?.message;
                console.error("Game error:", loggedError);
            }
            $q.notify({
                message: `Game error: ${msg.data?.message || "Unknown error"}`,
                position: "top",
                color: "negative",
            });
            if (!startErrorSent && (!ready || startSecondsLeft > 0)) {
                startErrorSent = true;
                stopStartClock();
                emit("startError", {
                    message: String(msg.data?.message || "Unknown error"),
                    stack: typeof msg.data?.stack === "string" ? msg.data.stack : "",
                    // Where the error is in the game's code, when the page
                    // can tell
                    line: lineOrColumn(msg.data?.line),
                    column: lineOrColumn(msg.data?.column),
                    // Or that it is after the end of the code, when the
                    // page says so
                    afterCode: msg.data?.afterCode === true || undefined,
                });
            }
        } else if (msg.type === "ready") {
            if (!ready) {
                ready = true;
                countStartSeconds();
                focusReadyGame();
            }
            // Probe for save/restore support, then offer restore if available
            probeSaveSupport().then(() => checkAndOfferRestore());
        } else if (msg.type === "firstInput" && !inputSeen) {
            inputSeen = true;
            countStartSeconds();
        }
    });

    // Load the game code into the sandbox
    sandbox.loadGame(game.code);
}

// The game takes the keyboard focus when it is ready, so that key presses
// reach it before the player clicks it. A click gives the game the focus,
// but not when the game's own pointerdown handler calls preventDefault(), as
// some games do. The focus stays in a text field, such as the description
// box while the user types there, and in a dialog.
function focusReadyGame() {
    if (document.activeElement?.closest("input, textarea, [role='dialog']")) return;
    sandbox.focus();
}

// What keeps the focus when the app's window gets it: a field, a button, a
// link, an element the user can reach with Tab, or anything in a dialog
const CONTROL = "input, textarea, select, button, a[href], [tabindex]:not([tabindex='-1']), [role='dialog']";

// When the app's window gets the focus back, the game takes it again, unless
// a control has it. The window gets a focus event too when the focus moves
// from the game to the page: when the user clicks the description box or a
// button, or leaves the game with Tab. So the game waits until the focus
// has moved, and leaves it on the control it went to. A click beside the
// game puts the focus on the page's layout, which is no control, and the
// game takes it back. A game that is not ready yet takes it when it is.
function handleWindowFocus() {
    setTimeout(() => {
        if (sandbox && ready && !document.activeElement?.closest(CONTROL)) sandbox.focus();
    });
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

onMounted(() => {
    loadGameScript();
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("focus", handleWindowFocus);
    resizeObserver = new ResizeObserver(fitGameToContainer);
    resizeObserver.observe(containerRef.value);
});

onBeforeUnmount(() => {
    stopStartClock();
    document.removeEventListener("visibilitychange", handleVisibilityChange);
    window.removeEventListener("focus", handleWindowFocus);
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
