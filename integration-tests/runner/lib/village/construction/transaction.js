/**
 * Construction transactions — every block change is logged and reversible.
 *
 * Log entry: { projectId, world, chunk, x, y, z, oldBlock, newBlock, reason }
 */

const STATUS = Object.freeze({
  IDLE: 'IDLE',
  BEGIN: 'BEGIN',
  CONSTRUCTING: 'CONSTRUCTING',
  PROJECT_PAUSED: 'PROJECT_PAUSED',
  COMMITTED: 'COMMITTED',
  ROLLED_BACK: 'ROLLED_BACK',
  PROJECT_ABORTED: 'PROJECT_ABORTED',
});

let _seq = 0;

function nextProjectId(prefix = 'proj') {
  _seq += 1;
  return `${prefix}_${Date.now()}_${_seq}`;
}

function chunkKey(x, z) {
  return `${x >> 4},${z >> 4}`;
}

/**
 * @param {{
 *   projectId?: string,
 *   world?: string,
 *   harness?: { block: { at: Function, set: Function } },
 *   priorLog?: object[],
 *   initialStatus?: string,
 * }} [opts]
 */
function createTransaction(opts = {}) {
  const projectId = opts.projectId || nextProjectId();
  const world = opts.world || 'world';
  const log = Array.isArray(opts.priorLog) ? opts.priorLog.slice() : [];
  let status = opts.initialStatus || STATUS.IDLE;
  let pauseIndex = log.length;

  return {
    projectId,
    world,
    get status() {
      return status;
    },
    get log() {
      return log.slice();
    },
    get pauseIndex() {
      return pauseIndex;
    },

    begin() {
      if (
        status !== STATUS.IDLE &&
        status !== STATUS.PROJECT_PAUSED &&
        status !== STATUS.ROLLED_BACK
      ) {
        throw new Error(`cannot begin from ${status}`);
      }
      status = STATUS.BEGIN;
      return this;
    },

    /**
     * Record + apply a block change.
     * @param {{ x:number, y:number, z:number, newBlock:string, reason:string, oldBlock?:string, apply?:boolean }} change
     *   Set apply:false when the world was already mutated (e.g. capability place_block) — still logs for rollback.
     */
    async setBlock(change) {
      if (status === STATUS.IDLE) this.begin();
      if (
        status === STATUS.PROJECT_ABORTED ||
        status === STATUS.COMMITTED ||
        status === STATUS.ROLLED_BACK
      ) {
        throw new Error(`cannot setBlock in ${status}`);
      }
      status = STATUS.CONSTRUCTING;
      const harness = opts.harness;
      let oldBlock = change.oldBlock;
      if (oldBlock == null && harness && harness.block) {
        oldBlock = await harness.block.at(change.x, change.y, change.z, world);
      }
      if (oldBlock == null) oldBlock = 'AIR';

      const entry = {
        projectId,
        world,
        chunk: chunkKey(change.x, change.z),
        x: change.x,
        y: change.y,
        z: change.z,
        oldBlock: String(oldBlock),
        newBlock: String(change.newBlock),
        reason: change.reason || 'construct',
      };
      log.push(entry);

      const shouldApply = change.apply !== false;
      if (shouldApply && harness && harness.block && typeof harness.block.set === 'function') {
        await harness.block.set(change.x, change.y, change.z, change.newBlock, world);
      }
      pauseIndex = log.length;
      return entry;
    },

    /** Mark paused so NPC can resume later. */
    pause() {
      if (status === STATUS.CONSTRUCTING || status === STATUS.BEGIN) {
        status = STATUS.PROJECT_PAUSED;
      }
      return status;
    },

    resume() {
      if (status !== STATUS.PROJECT_PAUSED) {
        throw new Error(`cannot resume from ${status}`);
      }
      status = STATUS.CONSTRUCTING;
      return status;
    },

    commit() {
      if (status === STATUS.PROJECT_ABORTED || status === STATUS.ROLLED_BACK) {
        throw new Error(`cannot commit from ${status}`);
      }
      status = STATUS.COMMITTED;
      return { projectId, status, changes: log.length };
    },

    /**
     * Restore old blocks in reverse order.
     */
    async rollback() {
      const harness = opts.harness;
      for (let i = log.length - 1; i >= 0; i--) {
        const e = log[i];
        if (harness && harness.block && typeof harness.block.set === 'function') {
          await harness.block.set(e.x, e.y, e.z, e.oldBlock, e.world);
        }
      }
      status = STATUS.ROLLED_BACK;
      return { projectId, status, restored: log.length };
    },

    /**
     * Abort and clean up (rollback).
     */
    async abort(reason) {
      await this.rollback();
      status = STATUS.PROJECT_ABORTED;
      return { projectId, status, reason: reason || 'aborted', restored: log.length };
    },

    /** All changes explained — UNEXPLAINED_BLOCK_CHANGES invariant helper. */
    unexplainedCount(externalChanges) {
      if (!externalChanges || !externalChanges.length) return 0;
      const keys = new Set(log.map((e) => `${e.x},${e.y},${e.z},${e.newBlock}`));
      let n = 0;
      for (const c of externalChanges) {
        const k = `${c.x},${c.y},${c.z},${c.newBlock || c.material}`;
        if (!keys.has(k)) n += 1;
      }
      return n;
    },
  };
}

module.exports = {
  STATUS,
  nextProjectId,
  chunkKey,
  createTransaction,
};
