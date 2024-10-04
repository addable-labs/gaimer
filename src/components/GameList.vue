<template>
    <q-list>
        <q-item-label header>Game List</q-item-label>
        <q-item v-for="game in games" :key="game.id" clickable>
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
                        @click="deleteGame(game.id)"
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
import { ref, onMounted } from "vue";
import IndexedDBClient from "../helpers/indexeddb.js";

const idbClient = IndexedDBClient();
const games = ref([]);

const deleteGame = async (id) => {
    idbClient
        .deleteItem(id)
        .then(() => {
            games.value = games.value.filter((game) => game.id !== id);
            console.log(`Delete game: ${id}`);
        })
        .catch((error) => {
            console.error(`Error deleting game: ${id}`, error);
        });
};

onMounted(async () => {
    console.log("GameList mounted");
    await idbClient.initDB();
    idbClient.listItems().then((items) => {
        items.forEach((item) => {
            games.value.push({ id: item.id, ...JSON.parse(item.content) });
        });
    });
});
</script>
