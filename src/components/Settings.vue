<script setup>
import { ref } from "vue";
import { usePersistedStore } from "../stores/persisted-store.js";
import { storeToRefs } from "pinia";

const persistedStore = usePersistedStore();
const { apiKey } = storeToRefs(persistedStore);

const userInput = ref(apiKey.value);

async function handleInput() {
    // Trim user input of any whitespace characters
    userInput.value = userInput.value.replace(/^\s+|\s+$/g, "");

    if (userInput.value == "") {
        return;
    }

    apiKey.value = userInput.value;
}
</script>

<template>
    <div class="q-gutter-sm" style="width: 400px">
        <q-input
            dense
            filled
            autofocus
            id="user-input"
            v-model="userInput"
            label="Enter your API key..."
            @keydown.enter="handleInput()"
        />
        <q-btn
            dense
            flat
            icon="mdi-content-save"
            color="primary"
            stack-label
            label="Save"
            @click="handleInput()"
        />
    </div>
</template>
