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
         { scheduler },
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
      let secondRequestSignal: AbortSignal | undefined;
      const expectedError = new Error("request failed");

      const resultPromise = mapWithConcurrency(
         [1, 2, 3, 4],
         2,
         async (value, signal) => {
            startedValues.push(value);

            if (value === 1) {
               await new Promise<void>((_resolve, reject) => {
                  rejectFirstRequest = reject;
               });
            } else {
               secondRequestSignal = signal;
               await new Promise(() => undefined);
            }

            return value;
         },
         { scheduler },
      );

      await new Promise<void>((resolve) => setImmediate(resolve));

      assert.deepEqual(startedValues, [1, 2]);

      rejectFirstRequest(expectedError);

      await assert.rejects(resultPromise, expectedError);
      assert.deepEqual(startedValues, [1, 2]);
      assert.equal(secondRequestSignal?.aborted, true);
      assert.equal(secondRequestSignal?.reason, expectedError);
   });

   test("按 QPS 均匀分配请求启动时间", async () => {
      const scheduler = createImmediateScheduler();

      await mapWithConcurrency([1, 2, 3, 4], 2, async (value) => value, {
         requestsPerSecond: 2,
         scheduler,
      });

      assert.deepEqual(scheduler.waitTimes, [0, 500, 1000, 1500]);
   });

   test("外部终止信号停止排队及在途任务", async () => {
      const abortController = new AbortController();
      const startedValues: number[] = [];
      const scheduler = createImmediateScheduler();
      const terminateError = new Error("terminated");
      let receivedSignal: AbortSignal | undefined;

      const resultPromise = mapWithConcurrency(
         [1, 2, 3],
         1,
         async (value, signal) => {
            startedValues.push(value);
            receivedSignal = signal;
            await new Promise(() => undefined);
            return value;
         },
         { scheduler, signal: abortController.signal },
      );

      await new Promise<void>((resolve) => setImmediate(resolve));
      abortController.abort(terminateError);

      await assert.rejects(resultPromise, terminateError);
      assert.deepEqual(startedValues, [1]);
      assert.equal(receivedSignal?.aborted, true);
      assert.equal(receivedSignal?.reason, terminateError);
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
