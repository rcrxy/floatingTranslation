/** 并发请求执行器使用的时间源。 */
export interface RequestScheduler {
   readonly now: () => number;
   readonly wait: (milliseconds: number) => Promise<void>;
}

/** 并发请求执行器的可选限速、时间源和终止配置。 */
export interface ConcurrentRequestOptions {
   readonly requestsPerSecond?: number;
   readonly scheduler?: RequestScheduler;
   readonly signal?: AbortSignal;
}
