// Do not hold the first interactive frame behind all 49 terrain chunks.
// Prepare the complete near field (the central 5×5) in small real batches;
// the normal frame streamer finishes the distant ring while play begins.
const NEAR_FIELD_CHUNKS = 25;
const BUILD_BUDGET = 4;

export async function prepareNearField(game, playerState, status) {
  const x = playerState.player.x, z = playerState.player.z;
  game.chunks.update(x, z, 0); // build the distance-sorted queue without consuming it
  const target = Math.min(NEAR_FIELD_CHUNKS, game.chunks.queue.length);
  let ready = 0;
  while (ready < target && game.chunks.queue.length) {
    const before = game.chunks.chunks.size;
    game.chunks.update(x, z, Math.min(BUILD_BUDGET, target - ready));
    ready += game.chunks.chunks.size - before;
    status.textContent = `Near field · ${ready} of ${target} ground sections`;
    if (ready < target) await new Promise(resolve => setTimeout(resolve, 0));
  }
  return ready;
}
