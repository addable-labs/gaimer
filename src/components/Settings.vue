<script setup>
import { ref } from "vue";
import { useAppStore } from "../stores/app-store.js";
import { storeToRefs } from "pinia";

const appStore = useAppStore();
const { apiKey } = storeToRefs(appStore);

const message = ref("");
const userInput = ref("");

async function handleInput() {
    // Trim user input of any whitespace characters
    userInput.value = userInput.value.replace(/^\s+|\s+$/g, "");

    if (userInput.value == "") {
        message.value = "You need to enter an API key!";
        return;
    }

    apiKey.value = userInput.value;
    message.value = "Successfully set API key!";
}
</script>

<template>
    <q-input
        dense
        filled
        autofocus
        id="user-input"
        v-model="userInput"
        placeholder="Enter your API key..."
    />
    <q-btn color="primary" label="Save" @click="handleInput()" />

    <p>{{ message }}</p>
</template>
