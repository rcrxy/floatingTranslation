import type { ConcurrentRequestOptions, RequestScheduler } from "../@types/ConcurrentRequest";

/** 将无效值回退为调用方提供的正整数默认值。 */
export function normalizePositiveInteger(value: unknown, fallback: number): number {
   return Number.isSafeInteger(value) && (value as number) > 0 ? (value as number) : fallback;
}

/** 根据任务数量和并发上限计算本次实际启动的 worker 数量。 */
export function getConcurrentRequestCount(taskCount: number, concurrency: number): number {
   return Math.min(Math.max(0, taskCount), concurrency);
}

const defaultRequestScheduler: RequestScheduler = {
   now: Date.now,
   wait: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
};

/**
 * 使用有限并发处理全部输入，保持结果顺序，并在首次失败后停止领取新任务。
 * 外部终止或任一任务失败时，终止排队等待并通知所有在途任务。
 */
export async function mapWithConcurrency<TInput, TResult>(
   inputs: readonly TInput[],
   concurrency: number,
   invoke: (input: TInput, signal: AbortSignal) => Promise<TResult>,
   options: ConcurrentRequestOptions = {},
): Promise<TResult[]> {
   const scheduler = options.scheduler ?? defaultRequestScheduler;
   const failureController = new AbortController();
   const signal = options.signal ? AbortSignal.any([options.signal, failureController.signal]) : failureController.signal;
   const results = new Array<TResult>(inputs.length);
   let nextIndex = 0;
   let nextRequestStartTime = scheduler.now();
   let failed = false;
   let firstError: unknown;
   const workerCount = getConcurrentRequestCount(inputs.length, concurrency);
   const requestIntervalMilliseconds = options.requestsPerSecond ? 1_000 / options.requestsPerSecond : 0;

   throwIfAborted(signal);

   await Promise.all(
      Array.from({ length: workerCount }, async () => {
         while (!failed && nextIndex < inputs.length) {
            const currentIndex = nextIndex;
            nextIndex += 1;

            try {
               if (requestIntervalMilliseconds > 0) {
                  const now = scheduler.now();
                  const requestStartTime = Math.max(now, nextRequestStartTime);

                  nextRequestStartTime = requestStartTime + requestIntervalMilliseconds;
                  await waitWithSignal(scheduler.wait(requestStartTime - now), signal);
               }

               throwIfAborted(signal);
               results[currentIndex] = await waitWithSignal(invoke(inputs[currentIndex], signal), signal);
            } catch (error) {
               if (!failed) {
                  failed = true;
                  firstError = error;
                  failureController.abort(error);
               }
            }
         }
      }),
   );

   if (failed) {
      throw firstError;
   }

   return results;
}

/** 在等待排队或请求完成时响应终止信号。 */
async function waitWithSignal<TResult>(promise: Promise<TResult>, signal: AbortSignal): Promise<TResult> {
   throwIfAborted(signal);

   return new Promise<TResult>((resolve, reject) => {
      const handleAbort = (): void => {
         reject(getAbortReason(signal));
      };
      const cleanup = (): void => {
         signal.removeEventListener("abort", handleAbort);
      };

      signal.addEventListener("abort", handleAbort, { once: true });
      promise.then(
         (result) => {
            cleanup();
            resolve(result);
         },
         (error: unknown) => {
            cleanup();
            reject(error);
         },
      );
   });
}

/** 在任务已经终止时抛出统一的 Error 原因。 */
function throwIfAborted(signal: AbortSignal): void {
   if (signal.aborted) {
      throw getAbortReason(signal);
   }
}

/** 将浏览器允许的任意 abort reason 归一化为 Error。 */
function getAbortReason(signal: AbortSignal): Error {
   return signal.reason instanceof Error ? signal.reason : new Error("翻译请求已终止");
}
