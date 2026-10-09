import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

// Both capture scripts need a real Chrome or Edge. Exit code 3 means none is
// installed (a CI image, for instance): those tests are skipped, not failed.
const E_NO_BROWSER = 3;
const scripts = fileURLToPath(new URL("../skills/acos/scripts/", import.meta.url));
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

// The page decides what it shows while it first renders, as an app does with a
// bridge its host injects: nothing run after load can change it.
const PAGE = `<!doctype html><meta charset="utf-8"><body style="margin:0">
<main id="mode"></main><input id="name"><button id="add">Add</button><ul id="list"></ul>
<script>
  document.getElementById("mode").textContent = window.__mode ?? "plain";
  document.getElementById("add").addEventListener("click", () => {
    const item = document.createElement("li");
    item.textContent = document.getElementById("name").value;
    document.getElementById("list").append(item);
  });
</script>`;

function workspace(t) {
  const dir = mkdtempSync(join(tmpdir(), "acos-test-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, "page.html"), PAGE);
  return { dir, url: pathToFileURL(join(dir, "page.html")).href };
}

function run(script, args) {
  return spawnSync(process.execPath, [join(scripts, script), ...args], { encoding: "utf8", env: { ...process.env, ACOS_PLAYWRIGHT: "off" } });
}

const isPng = (file) => statSync(file).size > 100 && readFileSync(file).subarray(0, 4).equals(PNG);

test("shot.mjs --init runs before the page's own scripts", (t) => {
  const { dir, url } = workspace(t);
  const out = join(dir, "init.png");
  // The selector exists only when the init script ran first; --eval would be too late.
  const probe = `document.getElementById("mode").dataset.seen = document.getElementById("mode").textContent`;
  const result = run("shot.mjs", ["--url", url, "--out", out, "--init", `window.__mode = "desktop"`, "--eval", probe, "--selector", `#mode[data-seen="desktop"]`, "--settle", "200", "--timeout", "20000"]);
  if (result.status === E_NO_BROWSER) return t.skip("no Chrome or Edge on this machine");
  assert.equal(result.status, 0, result.stderr);
  assert.ok(isPng(out));
});

test("shot.mjs reads --init-file and refuses it beside --init", (t) => {
  const { dir, url } = workspace(t);
  const initFile = join(dir, "init.js");
  writeFileSync(initFile, `window.__mode = "from-file";`);
  const both = run("shot.mjs", ["--url", url, "--out", join(dir, "x.png"), "--full", "--init", "1", "--init-file", initFile]);
  assert.equal(both.status, 2);
  const out = join(dir, "file.png");
  const probe = `document.getElementById("mode").dataset.seen = document.getElementById("mode").textContent`;
  const result = run("shot.mjs", ["--url", url, "--out", out, "--init-file", initFile, "--eval", probe, "--selector", `#mode[data-seen="from-file"]`, "--settle", "200", "--timeout", "20000"]);
  if (result.status === E_NO_BROWSER) return t.skip("no Chrome or Edge on this machine");
  assert.equal(result.status, 0, result.stderr);
  assert.ok(isPng(out));
});

test("shots.mjs runs a visit with init, typing, a click and two captures per width", (t) => {
  const { dir, url } = workspace(t);
  const spec = join(dir, "spec.mjs");
  writeFileSync(spec, `
export const init = 'window.__mode = "desktop"';
export default [{
  name: "page", url: ${JSON.stringify(url)}, settle: 200,
  async run(page, width) {
    if (await page.text("#mode") !== "desktop") throw new Error("init did not run before first render");
    await page.shot("before", "#mode", { pad: 4 });
    await page.type("#name", "Add retry");
    await page.click({ text: "Add" });
    await page.waitFor("#list li");
    if (await page.text("#list li") !== "Add retry") throw new Error("typed text did not arrive");
    await page.shot("after", "#list");
  },
}, {
  name: "broken", url: ${JSON.stringify(url)}, settle: 200,
  async run(page) { await page.waitFor("#never", 500); },
}];`);
  const usage = run("shots.mjs", []);
  assert.equal(usage.status, 2);
  const good = run("shots.mjs", [spec, "--only", "page", "--widths", "800,390", "--timeout", "20000"]);
  if (good.status === E_NO_BROWSER) return t.skip("no Chrome or Edge on this machine");
  assert.equal(good.status, 0, good.stderr);
  for (const name of ["before-800", "after-800", "before-390", "after-390"]) assert.ok(isPng(join(dir, "shots", `${name}.png`)), name);
  assert.equal(good.stdout.trim().split("\n").length, 4);

  const bad = run("shots.mjs", [spec, "--only", "broken", "--widths", "800", "--timeout", "20000"]);
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /broken @800 failed: #never never matched/);
  assert.ok(isPng(join(dir, "shots", "broken-FAILED-800.png")));
});
