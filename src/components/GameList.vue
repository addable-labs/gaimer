<template>
    <q-list>
        <q-item-label header>Game List</q-item-label>
        <q-item v-for="game in gameList" :key="game.id" clickable>
            <q-item-section>
                <q-item-label @click="$emit('loadGame', game.id)"
                    >{{ game.title }}
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
import { onMounted } from "vue";
import IndexedDBClient from "../helpers/indexeddb.js";
import { useAppStore } from "../stores/app-store.js";
import { storeToRefs } from "pinia";
const appStore = useAppStore();
const { gameList } = storeToRefs(appStore);

const idbClient = IndexedDBClient();

const deleteGame = async (id) => {
    idbClient
        .deleteItem(id)
        .then(() => {
            gameList.value = gameList.value.filter((game) => game.id !== id);
            console.log(`Delete game: ${id}`);
        })
        .catch((error) => {
            console.error(`Error deleting game: ${id}`, error);
        });
};

onMounted(async () => {
    console.log("GameList mounted");
    await idbClient.initDB();
    if (gameList.value.length == 0) {
        idbClient.listItems().then((items) => {
            items.forEach((item) => {
                let content = JSON.parse(item.content);
                gameList.value.push({
                    id: item.id,
                    title: content.title,
                    description: content.description,
                    controls: content.controls,
                    rules: content.rules,
                });
            });
        });
    }
});
</script>
