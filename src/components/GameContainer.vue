<script setup>
import { nextTick, ref, watchEffect } from "vue";

const { gameContent } = defineProps(["gameContent"]);

async function runGame() {
    const gameDescription =
        "Create a simple pong game with two paddles and a ball.";

    // Call the function to generate the game content
    // const gameContent = await generateGame(gameDescription);

    // Dynamically insert the generated content into the #game-container div
    const container = document.getElementById("game-container");
    container.innerHTML = gameContent; // Insert the HTML/JS content

    // If the response contains scripts, manually evaluate them
    const scripts = container.getElementsByTagName("script");
    for (let i = 0; i < scripts.length; i++) {
        eval(scripts[i].text); // Run the script content
    }
}

watchEffect(async (gameContent) => {
    console.log("gameContent changed");
    await nextTick();
    runGame();
});
</script>

<template>
    <div id="game-container"></div>
</template>
