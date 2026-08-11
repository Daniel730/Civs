/**
 * Deterministic repair engine — never LLM-driven world edits.
 * Can fill small foundation gaps, remove orphan floaters, or full rollback.
 */

const { STATUS } = require('./transaction');

/**
 * @param {{
 *   tx: object,
 *   inspection: object,
 *   blueprint: object,
 *   harness?: object,
 *   mode?: 'auto'|'rollback'|'repair'|'abort',
 *   minScore?: number,
 * }} opts
 */
async function repairOrRollback(opts) {
  const { tx, inspection, blueprint, mode = 'auto', minScore = 0.55 } = opts;
  const score = inspection.score ? inspection.score.overall : 0;

  if (inspection.pass && score >= minScore) {
    tx.commit();
    return { action: 'commit', status: STATUS.COMMITTED, score, inspection };
  }

  if (mode === 'rollback' || mode === 'abort') {
    const result = mode === 'abort' ? await tx.abort('inspection_failed') : await tx.rollback();
    return { action: mode, ...result, score, inspection };
  }

  // auto: try cheap repairs then re-evaluate policy
  const repairs = [];
  const floating = (inspection.findings || []).filter((f) => f.code === 'floating_block');

  if (floating.length && floating.length <= 8 && opts.harness && blueprint.materials) {
    const fill = (blueprint.materials && blueprint.materials.foundation) || 'cobblestone';
    for (const f of floating) {
      await tx.setBlock({
        x: f.x,
        y: f.y - 1,
        z: f.z,
        newBlock: fill,
        reason: 'repair:foundation_fill',
      });
      repairs.push({ type: 'foundation_fill', ...f });
    }
    return {
      action: 'repair',
      status: tx.status,
      repairs,
      score,
      inspection,
      needsReinspect: true,
    };
  }

  // Too damaged / unsafe → rollback
  const result = await tx.rollback();
  return {
    action: 'rollback',
    ...result,
    score,
    inspection,
    repairs,
    reason: 'inspection_failed_unrepairable',
  };
}

module.exports = {
  repairOrRollback,
};
