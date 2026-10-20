import { getValidLocalFilePath, isUrl, proxyMethod } from './Tools';

const WebAssembly = WXWebAssembly;
proxyMethod(WebAssembly, 'instantiate', (instance, oldMethod, args) => {
  const path = args[0];
  if (typeof path === 'string' && isUrl(path) && path.startsWith(window.miniprogramPath)) {
    const p = path.substring(window.miniprogramPath.length);
    args[0] = getValidLocalFilePath(`minigame-html-src/src/${p}`);
  }
  return oldMethod.apply(instance, args);
});

export { WebAssembly };
