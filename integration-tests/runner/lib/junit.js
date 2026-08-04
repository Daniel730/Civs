'use strict';
const fs = require('fs');
const path = require('path');

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

/** Writes standard JUnit XML (Jenkins/GitLab/GitHub compatible) from scenario suites. */
function writeJUnit(suites, filePath) {
  let totalTests = 0, totalFail = 0, totalErr = 0, totalTime = 0;
  const suiteXml = suites.map((s) => {
    const cases = s.cases || [];
    const failures = cases.filter((c) => !c.ok).length;
    const timeS = (s.timeMs || 0) / 1000;
    totalTests += cases.length; totalFail += failures; totalTime += timeS;
    if (s.error) totalErr += 1;

    const caseXml = cases.map((c) => {
      const t = ((c.timeMs || 0) / 1000).toFixed(3);
      if (c.ok) return `    <testcase name="${esc(c.name)}" classname="${esc(s.name)}" time="${t}"/>`;
      return `    <testcase name="${esc(c.name)}" classname="${esc(s.name)}" time="${t}">\n` +
             `      <failure message="${esc(c.message)}">${esc(c.message)}</failure>\n` +
             `    </testcase>`;
    }).join('\n');

    const suiteError = s.error
      ? `\n    <testcase name="${esc(s.name)} (scenario)" classname="${esc(s.name)}">\n` +
        `      <error message="${esc(s.error)}">${esc(s.error)}</error>\n    </testcase>`
      : '';

    return `  <testsuite name="${esc(s.name)}" tests="${cases.length}" failures="${failures}" ` +
           `errors="${s.error ? 1 : 0}" time="${timeS.toFixed(3)}">\n${caseXml}${suiteError}\n  </testsuite>`;
  }).join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<testsuites name="Civs integration tests" tests="${totalTests}" failures="${totalFail}" ` +
    `errors="${totalErr}" time="${totalTime.toFixed(3)}">\n${suiteXml}\n</testsuites>\n`;

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, xml);
  return { totalTests, totalFail, totalErr };
}

module.exports = { writeJUnit };
