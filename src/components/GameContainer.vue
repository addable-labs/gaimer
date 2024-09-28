<script setup>
import { nextTick, ref, watchEffect } from "vue";
import { useQuasar } from "quasar";

const { game } = defineProps(["game"]);
const $q = useQuasar();

async function runGame() {
    // Dynamically insert the generated content into the #game-container div
    const container = document.getElementById("game-container");
    container.innerHTML = game.code; // Insert the HTML/JS content

    // If the response contains scripts, manually evaluate them
    const scripts = container.getElementsByTagName("script");
    for (let i = 0; i < scripts.length; i++) {
        eval(scripts[i].text); // Run the script content
    }
}

const gameInfo = ref({
    title: {
        text: game.elements.controls,
        icon: "mdi-gamepad-outline",
    },
    description: {
        text: `${game.rules} ${game.elements.goals}`,
        icon: "mdi-book-open-variant-outline",
    },
});

const displayNotification = (message) => {
    $q.notify({
        message: message,
        position: "top",
        timeout: 2000,
        closeBtn: "OK",
        progress: true,
    });
};

watchEffect(async (game) => {
    console.log("Game content updated");
    await nextTick();
    runGame();
});
</script>

<template>
    <div id="game-container"></div>
    <div id="game-info">
        <q-card
            dense
            flat
            class="JetBrainsMono-font text-primary"
            :dark="$q.dark.isActive"
        >
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
