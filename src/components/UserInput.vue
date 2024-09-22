<script setup>
import { computed, ref } from "vue";

import { useAppStore } from "../stores/app-store.js";
import { storeToRefs } from "pinia";

const appStore = useAppStore();
const { gameDescription, generating } = storeToRefs(appStore);

const descriptionMaxLength = ref(4096);
const userInput = ref("");
const response = ref("");

async function handleUserInput() {
    // Trim user input of any whitespace characters
    userInput.value = userInput.value.replace(/^\s+|\s+$/g, "");

    if (userInput.value == "") return;

    gameDescription.value = userInput.value;
    userInput.value = "";
}

const remainingCharactersText = computed(() => {
    let remainingCharacters =
        descriptionMaxLength.value - userInput.value.length;
    return `${remainingCharacters} character${remainingCharacters != 1 ? "s" : ""} remaining`;
});
</script>

<template>
    <div>
        <q-input
            dense
            filled
            autogrow
            style="width: 100%"
            type="textarea"
            id="user-input"
            :label="
                userInput.length == 0
                    ? 'Describe your game...'
                    : remainingCharactersText
            "
            v-model="userInput"
            :maxlength="descriptionMaxLength"
            @keydown.command.enter.prevent="handleUserInput"
        >
            <template v-slot:append>
                <q-btn
                    dense
                    flat
                    icon="mdi-send"
                    color="primary"
                    stack-label
                    :loading="generating"
                    @click="handleUserInput()"
                />
            </template>
        </q-input>
    </div>

    <p>{{ response }}</p>
</template>
