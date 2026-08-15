/** 将无效值回退为调用方提供的正整数默认值。 */
export function normalizePositiveInteger(value: unknown, fallback: number): number {
   return Number.isSafeInteger(value) && (value as number) > 0 ? (value as number) : fallback;
}

/** 根据任务数量和并发上限计算本次实际启动的 worker 数量。 */
export function getConcurrentRequestCount(taskCount: number, concurrency: number): number {
   return Math.min(Math.max(0, taskCount), concurrency);
}

interface RequestScheduler {
   readonly now: () => number;
   readonly wait: (milliseconds: number) => Promise<void>;
}

const defaultRequestScheduler: RequestScheduler = {
   now: Date.now,
   wait: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
};

/**
 * 使用有限并发处理全部输入，保持结果顺序，并在首次失败后停止领取新任务。
 * 已经开始的任务仍会等待完成，避免调用方收到失败后后台继续产生请求。
 */
export async function mapWithConcurrency<TInput, TResult>(
   inputs: readonly TInput[],
   concurrency: number,
   invoke: (input: TInput) => Promise<TResult>,
   scheduler: RequestScheduler = defaultRequestScheduler,
): Promise<TResult[]> {
   const results = new Array<TResult>(inputs.length);
   let nextIndex = 0;
   let nextRequestStartTime = scheduler.now();
   let failed = false;
   let firstError: unknown;
   const workerCount = getConcurrentRequestCount(inputs.length, concurrency);
   const requestIntervalMilliseconds = 1_000 / concurrency;

   await Promise.all(
      Array.from({ length: workerCount }, async () => {
         while (!failed && nextIndex < inputs.length) {
            const currentIndex = nextIndex;
            nextIndex += 1;
            const now = scheduler.now();
            const requestStartTime = Math.max(now, nextRequestStartTime);

            nextRequestStartTime = requestStartTime + requestIntervalMilliseconds;
            await scheduler.wait(requestStartTime - now);

            if (failed) {
               return;
            }

            try {
               results[currentIndex] = await invoke(inputs[currentIndex]);
            } catch (error) {
               if (!failed) {
                  failed = true;
                  firstError = error;
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
