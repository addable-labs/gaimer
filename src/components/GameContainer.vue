<script setup>
import { nextTick, onMounted, ref, watchEffect } from "vue";
import { useQuasar } from "quasar";

const { game } = defineProps(["game"]);
const $q = useQuasar();

async function loadGameScript() {
    // Get the game container and script elements
    const gameContainer = document.getElementById("game-container");
    const scriptsContainer = document.getElementById("game-scripts");

    // Remove any existing script nodes
    while (scriptsContainer.firstChild) {
        scriptsContainer.removeChild(scriptsContainer.firstChild);
    }

    await nextTick();

    // Create a new script element
    const gameScripts = document.createElement("script");

    // Wrap the generated JavaScript code in an IIFE to create a new scope for each game.
    // Variables and functions are scoped within the function and won’t pollute the global scope.
    // IIFE = Immediately Invoked Function Expression
    gameScripts.textContent = `
        (function() {
            // Your game code here
            // const canvas = document.getElementById('game-canvas');
            ${game.code}
        })();
    `;

    // Append the game script to the scripts container
    scriptsContainer.appendChild(gameScripts);

    // Wait for the DOM to update after appending the script
    await nextTick();

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
    // runGame();
    loadGameScript();
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
