import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

// Claude Code's Write tool refuses a subagent's file whose name reads as a report
// (skills/acos/references/adapters.md, "Artifact names"). ACOS never names an output
// or an artifact that way, so a worker can always save its own artifact.
const REFUSED = /report|summary|findings|analysis/i;

const root = new URL("../", import.meta.url);
const schema = JSON.parse(await readFile(new URL("schema/acos.schema.json", root), "utf8"));

async function textFiles(dir) {
  const files = [];
  for (const entry of await readdir(new URL(dir, root), { withFileTypes: true })) {
    const path = `${dir}${entry.name}`;
    if (entry.isDirectory()) files.push(...await textFiles(`${path}/`));
    else if (/\.(ya?ml|md)$/.test(entry.name)) files.push(path);
  }
  return files;
}

function outputNames(text) {
  const names = [];
  for (const match of text.matchAll(/^\s*outputs:\s*\[([^\]]*)\]/gm)) {
    names.push(...match[1].split(",").map((name) => name.trim().replace(/^["']|["']$/g, "")).filter(Boolean));
  }
  return names;
}

function outputsPattern() {
  const pattern = JSON.stringify(schema).match(/"pattern":"(\^\(\?!\.\*\(\?:[^"]*)"/);
  assert.ok(pattern, "schema declares a pattern for stage outputs");
  return new RegExp(pattern[1]);
}

test("the schema rejects refused output names and accepts the catalog's", () => {
  const pattern = outputsPattern();
  for (const name of ["report", "stage-summary", "Findings", "risk-analysis", "implement-report"]) {
    assert.equal(pattern.test(name), false, name);
  }
  for (const name of ["design-contract", "try-it", "context", "diff", "plan", "review", "verify", "result", "notes", "handoff"]) {
    assert.equal(pattern.test(name), true, name);
  }
});

test("catalog blocks, presets and the example manifest name no refused output", async () => {
  const files = [
    ...await textFiles("skills/acos/catalog/"),
    ...await textFiles("skills/acos/presets/"),
    "schema/manifest.example.yaml",
  ];
  let checked = 0;
  for (const file of files) {
    const text = await readFile(new URL(file, root), "utf8");
    for (const name of outputNames(text)) {
      checked += 1;
      assert.doesNotMatch(name, REFUSED, `${file}: output "${name}"`);
    }
  }
  assert.ok(checked >= 7, `expected the catalog's stage outputs, found ${checked}`);
});

test("no skill text asks a worker to write a refused artifact file", async () => {
  const files = [...await textFiles("skills/acos/"), "SPEC.md", "schema/manifest.example.yaml"];
  for (const file of files) {
    const text = await readFile(new URL(file, root), "utf8");
    for (const match of text.matchAll(/artifacts\/([\w.-]+)/g)) {
      assert.doesNotMatch(match[1], REFUSED, `${file}: artifacts/${match[1]}`);
    }
  }
});
