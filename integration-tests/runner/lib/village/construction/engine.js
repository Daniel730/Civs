/**
 * Deterministic construction engine — places only via ConstructionTransaction.
 * Never accepts arbitrary LLM block lists without a validated blueprint.
 */

const { expandPlacementOrder } = require('./blueprint');
const { createTransaction, STATUS } = require('./transaction');

/**
 * Place blueprint blocks through a transaction.
 *
 * @param {{
 *   harness: object,
 *   blueprint: object,
 *   actorName?: string,
 *   world?: string,
 *   projectId?: string,
 *   maxBlocks?: number,
 *   startIndex?: number,
 *   placeFn?: (block:object, tx:object)=>Promise<void>,
 *   shouldPause?: ()=>boolean,
 *   priorLog?: object[],
 * }} opts
 */
async function construct(opts) {
  const {
    harness,
    blueprint,
    actorName,
    world = blueprint.world || 'world',
    projectId,
    maxBlocks,
    startIndex = 0,
    placeFn,
    shouldPause,
    priorLog,
  } = opts;

  if (!blueprint || !blueprint.blocks) {
    throw new Error('construct requires validated blueprint with blocks');
  }

  const tx = createTransaction({
    projectId,
    world,
    harness,
    priorLog,
    initialStatus: priorLog && priorLog.length ? STATUS.PROJECT_PAUSED : STATUS.IDLE,
  });
  if (tx.status === STATUS.PROJECT_PAUSED) tx.resume();
  else tx.begin();

  const ordered = expandPlacementOrder(blueprint);
  const end = maxBlocks != null ? Math.min(ordered.length, startIndex + maxBlocks) : ordered.length;
  const placed = [];

  for (let i = startIndex; i < end; i++) {
    if (typeof shouldPause === 'function' && shouldPause()) {
      tx.pause();
      return {
        tx,
        status: STATUS.PROJECT_PAUSED,
        placed,
        nextIndex: i,
        total: ordered.length,
      };
    }

    const block = ordered[i];
    if (typeof placeFn === 'function') {
      await placeFn(block, tx);
    } else if (actorName && harness.cap && typeof harness.cap.placeBlock === 'function') {
      // Prefer capability; fall back to transaction set (logged).
      const mat = block.material;
      try {
        if (harness.cap.lookAt) await harness.cap.lookAt(actorName, block.x, block.y, block.z);
        let oldBlock = 'AIR';
        if (harness.block && harness.block.at) {
          oldBlock = await harness.block.at(block.x, block.y, block.z, world);
        }
        const pl = await harness.cap.placeBlock(actorName, block.x, block.y, block.z, mat);
        await tx.setBlock({
          x: block.x,
          y: block.y,
          z: block.z,
          newBlock: mat,
          oldBlock,
          reason: `role:${block.role}:${pl && pl.success ? 'place' : 'place_failed'}`,
          apply: false,
        });
      } catch {
        await tx.setBlock({
          x: block.x,
          y: block.y,
          z: block.z,
          newBlock: mat,
          reason: `role:${block.role}:error_fallback`,
          apply: false,
        });
      }
    } else {
      await tx.setBlock({
        x: block.x,
        y: block.y,
        z: block.z,
        newBlock: block.material,
        reason: `role:${block.role}`,
      });
    }
    placed.push(block);
  }

  return {
    tx,
    status: STATUS.CONSTRUCTING,
    placed,
    nextIndex: end,
    total: ordered.length,
    complete: end >= ordered.length,
  };
}

/**
 * Log-only placeFn helper for tests / dry runs that still mutate mock harness via tx.
 */
function createLoggingPlaceFn() {
  return async (block, tx) => {
    await tx.setBlock({
      x: block.x,
      y: block.y,
      z: block.z,
      newBlock: block.material,
      reason: `role:${block.role}`,
    });
  };
}

module.exports = {
  construct,
  createLoggingPlaceFn,
};
