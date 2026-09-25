<script setup>
import { computed, ref } from "vue";
import { useAppStore } from "../stores/app-store.js";
import { storeToRefs } from "pinia";

const appStore = useAppStore();
const { gameDescription, generating, loadedGame } = storeToRefs(appStore);

const descriptionMaxLength = ref(4096);
const userInput = ref("");
const fieldRef = ref(null);

async function handleUserInput() {
    // Trim user input of any whitespace characters
    userInput.value = userInput.value.replace(/^\s+|\s+$/g, "");

    if (userInput.value == "") return;

    gameDescription.value = userInput.value;
    userInput.value = "";

    // Take the focus off the field: off the textarea after Cmd+Enter, off
    // the send button after a click or tap (QInput's blur() does both)
    fieldRef.value.blur();
}

// With a game open, what the user sends changes it
const emptyLabel = computed(() => (loadedGame.value ? "Change this game..." : "Describe your game..."));

const remainingCharactersText = computed(() => {
    let remainingCharacters =
        descriptionMaxLength.value - userInput.value.length;
    return `${remainingCharacters} character${remainingCharacters != 1 ? "s" : ""} remaining`;
});
</script>

<template>
    <q-toolbar>
        <!-- 90% of the toolbar's width, which the footer keeps clear of an iPhone's sides -->
        <q-input
            autogrow
            class="absolute-center"
            dark
            dense
            filled
            ref="fieldRef"
            style="width: min(90%, 800px)"
            type="textarea"
            v-model="userInput"
            :disable="generating"
            :label="
                userInput.length == 0
                    ? emptyLabel
                    : remainingCharactersText
            "
            :maxlength="descriptionMaxLength"
            @keydown.meta.enter.prevent="handleUserInput()"
        >
            <template v-slot:append>
                <q-btn
                    dense
                    flat
                    icon="mdi-send"
                    color="primary"
                    :loading="generating"
                    @click="handleUserInput()"
                >
                    <template v-slot:loading>
                        <q-spinner-gears color="primary" />
                    </template>
                </q-btn>
            </template>
        </q-input>
    </q-toolbar>
</template>
