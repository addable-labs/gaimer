<script setup>
import { nextTick, onMounted, onBeforeUnmount, ref, watchEffect } from "vue";
import { useQuasar } from "quasar";
import { createSandbox } from "../engine/sandbox.js";

const { game } = defineProps(["game"]);
const $q = useQuasar();

let sandbox = null;

function loadGameScript() {
    const container = document.getElementById("game-container");
    if (!container || !game.code) return;

    // Destroy previous sandbox if it exists
    if (sandbox) {
        sandbox.destroy();
        sandbox = null;
    }

    // Create a new sandboxed iframe for the game
    sandbox = createSandbox(container, {
        width: screenSize.value.width,
        height: screenSize.value.height,
    });

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

const screenSize = ref({
    width: document.documentElement.clientWidth - 100,
    height: document.documentElement.clientHeight - 200,
});

const calculateCanvasSize = () => {
    let parentElement = document.getElementById("game-container");
    if (!parentElement) return screenSize.value;
    let rect = parentElement.getBoundingClientRect();

    return {
        width: Math.floor(parseFloat(rect.width)),
        height: Math.floor(parseFloat(rect.height) - 50),
    };
};

onMounted(() => {
    screenSize.value = calculateCanvasSize();
    document.addEventListener("visibilitychange", handleVisibilityChange);
});

onBeforeUnmount(() => {
    document.removeEventListener("visibilitychange", handleVisibilityChange);
    if (sandbox) {
        sandbox.destroy();
        sandbox = null;
    }
});
</script>

<template>
    <div id="game-container" style="width: 100%; height: 100%">
    </div>
    <div id="game-info">
        <q-card dense flat class="JetBrainsMono-font text-primary" dark>
            <div class="row">
                <div class="col">
                    <q-btn
                        color="primary-darkened"
                        flat
                        v-for="item in gameInfo"
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
        </q-card>
    </div>
</template>
