import assert from "node:assert/strict";
import { test } from "node:test";
import { createUuid } from "../apps/web/src/uuid.js";

test("LAN HTTP fallback creates unique UUID v4 identifiers without randomUUID", () => {
  const source = { getRandomValues: crypto.getRandomValues.bind(crypto) };
  const ids = Array.from({ length: 1000 }, () => createUuid(source));
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ids)
    assert.match(
      id,
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
});

test("secure contexts use their native UUID generator", () => {
  const source = {
    randomUUID: () => "00000000-0000-4000-8000-000000000001" as const,
    getRandomValues: () => {
      throw new Error("native UUID needs no fallback");
    },
  };
  assert.equal(createUuid(source), "00000000-0000-4000-8000-000000000001");
});
