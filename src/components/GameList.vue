<template>
  <q-dialog v-model="isDialogOpen">
    <q-card>
      <q-card-section>
        <div class="text-h6">Game List</div>
      </q-card-section>

      <q-card-section>
        <q-list>
          <q-item v-for="game in games" :key="game.id">
            <q-item-section>{{ game.prompt }}</q-item-section>
            <q-item-section>
              <q-btn @click="loadGame(game.id)" label="Load" />
              <q-btn @click="deleteGame(game.id)" label="Delete" />
            </q-item-section>
          </q-item>
        </q-list>
      </q-card-section>

      <q-card-actions align="right">
        <q-btn flat label="Close" v-close-popup />
      </q-card-actions>
    </q-card>
  </q-dialog>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { listGames, loadGame, deleteGame } from '../helpers/indexeddb.js';

const isDialogOpen = ref(false);
const games = ref([]);

const fetchGames = async () => {
  games.value = await listGames();
};

const loadGame = async (id) => {
  const game = await loadGame(id);
  // Emit the loaded game to the parent component
  emit('loadGame', game);
};

const deleteGame = async (id) => {
  await deleteGame(id);
  // Refresh the game list after deletion
  fetchGames();
  // Emit the deleted game ID to the parent component
  emit('deleteGame', id);
};

onMounted(() => {
  fetchGames();
});
</script>
