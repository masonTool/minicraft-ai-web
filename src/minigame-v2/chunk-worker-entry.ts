import { handleWorkerRequest, type WorkerRequest } from '../worker/chunk.worker.ts';

interface WxWorkerScope {
  onMessage(callback: (data: WorkerRequest) => void): void;
  postMessage(message: unknown, transfer?: Transferable[]): void;
}

declare const worker: WxWorkerScope | undefined;

const handle = (data: WorkerRequest): void => {
  const { response, transfer } = handleWorkerRequest(data);
  worker!.postMessage(response, transfer);
};

if (typeof worker !== 'undefined' && typeof worker.onMessage === 'function') {
  worker.onMessage(handle);
} else if (typeof self !== 'undefined' && typeof self.addEventListener === 'function') {
  self.addEventListener('message', (event: MessageEvent<WorkerRequest>) => handle(event.data));
}
