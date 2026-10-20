var globalLast = null;
export default class Worker {
  constructor(scriptPath, options) {
    const path = normalizePath(`${scriptPath}`);
    console.log('Worker>>>', `${path}`, options);
    globalLast && globalLast.terminate();
    const worker = wx.createWorker(`${path}`, options);
    if (worker) {
      const terminate = worker.terminate;
      worker.terminate = function () {
        worker.terminated = true;
        terminate(...arguments);
      }
      const postMessage = worker.postMessage;
      worker.postMessage = function () {
        if (worker.terminated) {
          console.warn(`Worker ${path} terminated, the message is ignored ${arguments}`)
          return;
        }
        return postMessage(...arguments);
      }
      // 本分支改动：现有代码用 addEventListener('message')，原生只提供 onMessage
      worker.addEventListener = function (type, callback) {
        if (type === 'message') worker.onMessage(callback);
      };
      worker.removeEventListener = function () {};
      globalLast = worker;
      return worker;
    }
  }

  postMessage() {}
}

function normalizePath(inputPath) {
  const parts = inputPath.split('/');
  const normalizedParts = [];

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];

    if (part === '..') {
      normalizedParts.pop();
    } else if (part !== '.' && part !== '') {
      normalizedParts.push(part);
    }
  }

  const normalizedPath = normalizedParts.join('/');
  return normalizedPath;
}
