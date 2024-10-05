<script setup>
import { nextTick, onMounted, ref, watchEffect } from "vue";
import { useQuasar } from "quasar";

const { game } = defineProps(["game"]);
const $q = useQuasar();

async function runGame() {
    // Get the game container, canvas and script elements
    const gameContainer = document.getElementById("game-container");
    const gameCanvas = document.getElementById("game-canvas");
    const scriptsContainer = document.getElementById("game-scripts");

    const gameScripts = document.createElement("script");

    // Inject the generated code
    gameScripts.textContent = game.code;

    // Remove any existing script nodes
    if (scriptsContainer.hasChildNodes) {
        for (let childNode of scriptsContainer.childNodes) {
            childNode.remove();
            scriptsContainer.removeChild(childNode);
        }
    }
    await nextTick();
    // Append the game script to the scripts container
    scriptsContainer.appendChild(gameScripts);

    // Run the game script
    const scripts = gameContainer.getElementsByTagName("script");
    for (let i = 0; i < scripts.length; i++) {
        eval(scripts[i].text); // Run the script content
    }
}

// Game info to display below th egame canvas
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

watchEffect(async (game) => {
    console.log("Game content updated");
    await nextTick();
    runGame();
});

const screenSize = ref({
    width: document.documentElement.clientWidth - 100,
    height: document.documentElement.clientHeight - 200,
});

const calculateCanvasSize = () => {
    let parentElement = document.getElementById("game-container");
    let rect = parentElement.getBoundingClientRect();

    return {
        width: Math.floor(parseFloat(rect.width)),
        height: Math.floor(parseFloat(rect.height) - 50),
    };
};

onMounted(() => {
    screenSize.value = calculateCanvasSize();
});
</script>

<template>
    <div id="game-container" class="width: 100%; height=100%">
        <canvas
            id="game-canvas"
            :width="screenSize.width"
            :height="screenSize.height"
            class="bg-grey-9"
        ></canvas>
        <div id="game-scripts"></div>
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
