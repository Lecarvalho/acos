import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const examples = JSON.parse(
  await readFile(new URL("../schema/estimation.contract-examples.json", import.meta.url), "utf8"),
);
const schema = JSON.parse(
  await readFile(new URL("../schema/acos.schema.json", import.meta.url), "utf8"),
);

function assertReservationAddsUp(estimate) {
  const orchestrator = estimate.orchestrator;
  assert.equal(
    orchestrator.reserved_tokens,
    orchestrator.startup_tokens + orchestrator.work_tokens + orchestrator.coordination_tokens,
  );
  assert.equal(
    estimate.aggregate_reserved_tokens,
    orchestrator.reserved_tokens + estimate.workers.reduce((sum, worker) => sum + worker.reserved_tokens, 0),
  );
}

test("schema names per-context limits and removes ambiguous aggregate fields", () => {
  const limitProperties = schema.$defs.Limits.properties;
  const estimateProperties = schema.$defs.Estimate.properties;

  assert.ok(limitProperties.worker_context_tokens);
  assert.ok(limitProperties.worker_tokens_total);
  assert.equal(limitProperties.worker_tokens, undefined);
  assert.ok(estimateProperties.orchestrator);
  assert.ok(estimateProperties.workers);
  assert.ok(estimateProperties.aggregate_reserved_tokens);
  assert.equal(estimateProperties.worker_tokens, undefined);
});

test("mechanical deletion is smaller than semantic work and command verification reserves zero", () => {
  const mechanical = examples.cases.mechanical_deletion.estimate;
  const semantic = examples.cases.two_file_inline.estimate;

  assertReservationAddsUp(mechanical);
  assert.ok(mechanical.orchestrator.work_tokens < semantic.orchestrator.work_tokens);
  assert.equal(mechanical.per_stage.find((stage) => stage.work_class === "command").reserved_tokens, 0);
});

test("the default orchestrator ceiling admits a two-file semantic inline change", () => {
  const estimate = examples.cases.two_file_inline.estimate;
  assertReservationAddsUp(estimate);
  assert.ok(estimate.orchestrator.reserved_tokens <= examples.limits.orchestrator_tokens);
});

test("fan-out fit is evaluated independently for every context lane", () => {
  const estimate = examples.cases.parallel_implementers_and_evidence.estimate;
  assertReservationAddsUp(estimate);
  assert.ok(estimate.orchestrator.reserved_tokens <= examples.limits.orchestrator_tokens);
  assert.ok(estimate.workers.every((worker) => worker.reserved_tokens <= worker.limit_tokens));
  assert.ok(estimate.aggregate_reserved_tokens > examples.limits.worker_context_tokens);
});

test("an eight-file visible slice fits two worker contexts despite aggregate volume above one worker ceiling", () => {
  const estimate = examples.cases.eight_file_visible_slice.estimate;
  assertReservationAddsUp(estimate);
  assert.ok(estimate.workers.every((worker) => worker.reserved_tokens <= worker.limit_tokens));
  assert.ok(estimate.aggregate_reserved_tokens > examples.limits.worker_context_tokens);
});

test("final evidence carries every claim from deterministically verified earlier parts", () => {
  const parts = examples.cases.deferred_evidence.parts;
  const finalPart = parts.at(-1);
  const deferred = parts.slice(0, -1);

  assert.ok(deferred.every((part) => part.deterministic_verify));
  assert.ok(deferred.every((part) => part.evidence.deferred_to === finalPart.index));
  assert.deepEqual(finalPart.evidence.covers_parts, deferred.map((part) => part.index));
  assert.deepEqual(
    finalPart.evidence.claims,
    deferred.flatMap((part) => part.evidence.claims),
  );
});

test("compose-time reservation stays unknown until measured actual usage is recorded separately", () => {
  const record = examples.cases.before_and_after_execution;
  assert.equal(record.estimate.observed_tokens, null);
  assert.notEqual(record.actual.observed.aggregate_tokens, record.estimate.aggregate_reserved_tokens);
  assert.equal(
    record.actual.observed.aggregate_tokens,
    record.actual.observed.orchestrator_tokens +
      record.actual.observed.workers.reduce((sum, worker) => sum + worker.tokens, 0),
  );
});
