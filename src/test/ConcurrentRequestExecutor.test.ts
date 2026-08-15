import * as assert from "node:assert/strict";
import { mapWithConcurrency, normalizePositiveInteger } from "../Utils/ConcurrentRequestExecutor";

suite("ConcurrentRequestExecutor", () => {
   test("限制峰值并发并保持结果顺序", async () => {
      const releaseRequests: Array<() => void> = [];
      const scheduler = createImmediateScheduler();
      let activeRequestCount = 0;
      let peakRequestCount = 0;

      const resultPromise = mapWithConcurrency(
         [1, 2, 3, 4, 5],
         2,
         async (value) => {
            activeRequestCount += 1;
            peakRequestCount = Math.max(peakRequestCount, activeRequestCount);

            await new Promise<void>((resolve) => releaseRequests.push(resolve));
            activeRequestCount -= 1;

            return value * 10;
         },
         scheduler,
      );

      await new Promise<void>((resolve) => setImmediate(resolve));

      assert.equal(releaseRequests.length, 2);

      while (releaseRequests.length > 0) {
         releaseRequests.shift()?.();
         await new Promise<void>((resolve) => setImmediate(resolve));
      }

      assert.deepEqual(await resultPromise, [10, 20, 30, 40, 50]);
      assert.equal(peakRequestCount, 2);
   });

   test("首次失败后不再领取尚未开始的任务", async () => {
      const startedValues: number[] = [];
      const scheduler = createImmediateScheduler();
      let rejectFirstRequest: (error: Error) => void = () => undefined;
      let resolveSecondRequest: () => void = () => undefined;
      const expectedError = new Error("request failed");

      const resultPromise = mapWithConcurrency(
         [1, 2, 3, 4],
         2,
         async (value) => {
            startedValues.push(value);

            if (value === 1) {
               await new Promise<void>((_resolve, reject) => {
                  rejectFirstRequest = reject;
               });
            } else {
               await new Promise<void>((resolve) => {
                  resolveSecondRequest = resolve;
               });
            }

            return value;
         },
         scheduler,
      );

      await new Promise<void>((resolve) => setImmediate(resolve));

      assert.deepEqual(startedValues, [1, 2]);

      rejectFirstRequest(expectedError);
      resolveSecondRequest();

      await assert.rejects(resultPromise, expectedError);
      assert.deepEqual(startedValues, [1, 2]);
   });

   test("按 QPS 均匀分配请求启动时间", async () => {
      const scheduler = createImmediateScheduler();

      await mapWithConcurrency([1, 2, 3, 4], 2, async (value) => value, scheduler);

      assert.deepEqual(scheduler.waitTimes, [0, 500, 1000, 1500]);
   });

   test("无效并发数回退到默认值", () => {
      assert.equal(normalizePositiveInteger(5, 50), 5);
      assert.equal(normalizePositiveInteger(0, 50), 50);
      assert.equal(normalizePositiveInteger(1.5, 50), 50);
      assert.equal(normalizePositiveInteger("5", 50), 50);
   });
});

function createImmediateScheduler() {
   const waitTimes: number[] = [];

   return {
      waitTimes,
      now: () => 0,
      wait: async (milliseconds: number) => {
         waitTimes.push(milliseconds);
      },
   };
}
