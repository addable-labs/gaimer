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
                        @click.stop="deleteGame(game.id)"
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
    </q-list>
</template>

<script setup>
import { deleteGame as deleteGameFromFS } from "../helpers/game-storage.js";
import { useAppStore } from "../stores/app-store.js";
import { storeToRefs } from "pinia";
const appStore = useAppStore();
const { gameList, loadedGame } = storeToRefs(appStore);

const deleteGame = async (id) => {
    try {
        await deleteGameFromFS(id);
        gameList.value = gameList.value.filter((game) => game.id !== id);
    } catch (error) {
        console.error(`Error deleting game: ${id}`, error);
    }
};
</script>
