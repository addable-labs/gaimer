<template>
    <q-list>
        <q-item-label header>Game List</q-item-label>
        <q-item
            v-for="game in gameList"
            :key="game.id"
            clickable
            :active="loadedGame === game.id"
            active-class="text-primary bg-grey-9"
            @click="$emit('loadGame', game.id)"
        >
            <q-item-section>
                <q-item-label>
                    <q-icon
                        v-if="loadedGame === game.id"
                        name="mdi-play"
                        size="xs"
                        class="q-mr-xs"
                    />{{ game.title }}
                    <q-tooltip
                        :delay="100"
                        max-width="300px"
                        transition-show="scale"
                        transition-hide="scale"
                    >
                        {{ game.description }}
                    </q-tooltip>
                </q-item-label>
            </q-item-section>
            <q-item-section side>
                <div class="text-grey-8 q-gutter-xs">
                    <q-btn dense flat icon="mdi-information" size="sm">
                        <q-tooltip
                            :delay="500"
                            max-width="300px"
                            transition-show="scale"
                            transition-hide="scale"
                        >
                            {{ game.rules }}
                        </q-tooltip>
                    </q-btn>
                    <q-btn dense flat icon="mdi-gamepad-outline" size="sm">
                        <q-tooltip
                            :delay="500"
                            max-width="300px"
                            transition-show="scale"
                            transition-hide="scale"
                        >
                            {{ game.controls }}
                        </q-tooltip>
                    </q-btn>
                    <q-btn
                        dense
                        flat
                        icon="mdi-delete"
                        size="sm"
                        @click.stop="confirmDelete(game)"
                    >
                        <q-tooltip
                            :delay="500"
                            max-width="300px"
                            transition-show="scale"
                            transition-hide="scale"
                        >
                            Delete
                        </q-tooltip>
                    </q-btn>
                </div>
            </q-item-section>
        </q-item>
        <q-separator spaced />

        <q-dialog v-model="confirmingDelete">
            <q-card style="width: 400px; max-width: 92vw">
                <q-card-section>
                    <div class="text-h6">Delete game?</div>
                </q-card-section>

                <q-card-section class="q-pt-none">
                    "{{ gameToDelete.title }}" and any saved progress will be deleted.
                </q-card-section>

                <q-card-actions align="right">
                    <q-btn
                        flat
                        no-caps
                        label="Cancel"
                        color="grey-5"
                        @click="confirmingDelete = false"
                    />
                    <q-btn
                        flat
                        no-caps
                        label="Delete"
                        color="red-5"
                        @click="deleteGame(gameToDelete.id)"
                    />
                </q-card-actions>
            </q-card>
        </q-dialog>
    </q-list>
</template>

<script setup>
import { ref } from "vue";
import { deleteGame as deleteGameFromFS } from "../helpers/game-storage.js";
import { useAppStore } from "../stores/app-store.js";
import { storeToRefs } from "pinia";
const emit = defineEmits(["loadGame", "gameDeleted"]);
const appStore = useAppStore();
const { gameList, loadedGame } = storeToRefs(appStore);

// The game the user asked to delete. It is kept after the dialog closes, so
// that its title stays in the dialog while the dialog fades out.
const gameToDelete = ref(null);
const confirmingDelete = ref(false);

function confirmDelete(game) {
    gameToDelete.value = game;
    confirmingDelete.value = true;
}

const deleteGame = async (id) => {
    confirmingDelete.value = false;
    try {
        await deleteGameFromFS(id);
        gameList.value = gameList.value.filter((game) => game.id !== id);
        emit("gameDeleted", id);
    } catch (error) {
        console.error(`Error deleting game: ${id}`, error);
    }
};
</script>
