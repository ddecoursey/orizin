import { test } from "node:test";
import assert from "node:assert/strict";
import {
  _fmpMaxQueueMsForTests,
  _setFmpRateGateForTests,
  waitForFmpRateSlot,
} from "../fmp.js";

test("FMP rate gate rejects reservations beyond the bounded queue horizon", async () => {
  _setFmpRateGateForTests(Date.now() + _fmpMaxQueueMsForTests() + 1_000);
  await assert.rejects(
    waitForFmpRateSlot(),
    (error) => error?.code === "fmp_queue_full",
  );
  _setFmpRateGateForTests(0);
});
