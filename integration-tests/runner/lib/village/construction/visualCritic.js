/**
 * Optional visual critic stub.
 * Vision models must NEVER modify the world — only return structured suggestions.
 * Disabled by default; enable with opts.enabled === true when infrastructure exists.
 */

/**
 * @param {{
 *   enabled?: boolean,
 *   screenshotPath?: string,
 *   blueprint?: object,
 *   inspection?: object,
 *   critiqueFn?: Function,
 * }} opts
 * @returns {Promise<{ enabled:boolean, suggestions:Array<{code:string,message:string}> }>}
 */
async function reviewVisual(opts = {}) {
  if (!opts.enabled) {
    return { enabled: false, suggestions: [] };
  }
  if (typeof opts.critiqueFn === 'function') {
    const suggestions = await opts.critiqueFn({
      screenshotPath: opts.screenshotPath,
      blueprint: opts.blueprint,
      inspection: opts.inspection,
    });
    return { enabled: true, suggestions: suggestions || [] };
  }
  // No vision model wired — empty suggestions (deterministic engine stays authoritative).
  return {
    enabled: true,
    suggestions: [],
    note: 'vision_model_not_configured',
  };
}

module.exports = {
  reviewVisual,
};
