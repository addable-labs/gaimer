<script>
// A game's controls and its rules, as the dialog shows them. The buttons below
// a game show them, and so do those next to it in the game list.
export function gameInfo(game) {
    return {
        controls: { title: "Controls", text: game.controls, icon: "mdi-gamepad-outline" },
        rules: { title: "Rules", text: game.rules, icon: "mdi-book-open-variant-outline" },
    };
}
</script>

<script setup>
// Shows a game's controls or its rules (info, from gameInfo) in a dialog,
// which stays open until the player closes it, so that a long text can be
// read, on a phone too
defineProps(["info"]);
const shown = defineModel({ default: false });
</script>

<template>
    <!-- A tap or click outside closes it too -->
    <q-dialog v-model="shown">
        <q-card style="width: 480px; max-width: 92vw">
            <q-card-section class="row items-center no-wrap">
                <q-icon :name="info.icon" color="primary" size="sm" class="q-mr-sm" />
                <div class="text-h6">{{ info.title }}</div>
            </q-card-section>

            <q-card-section class="q-pt-none text-body1 game-info-text">{{ info.text }}</q-card-section>

            <q-card-actions align="right">
                <q-btn
                    flat
                    no-caps
                    label="Close"
                    color="grey-5"
                    @click="shown = false"
                />
            </q-card-actions>
        </q-card>
    </q-dialog>
</template>

<style scoped>
/* Keeps the line breaks the text may have */
.game-info-text {
    white-space: pre-line;
}
</style>
