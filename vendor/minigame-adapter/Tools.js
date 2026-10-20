const keystr = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
``;
function atobLookup(chr) {
  const index = keystr.indexOf(chr);
  return index < 0 ? undefined : index;
}
function atob(data) {
  if (arguments.length === 0) {
    throw new TypeError('1 argument required, but only 0 present.');
  }
  data = `${data}`;
  data = data.replace(/[ \t\n\f\r]/g, '');
  if (data.length % 4 === 0) {
    data = data.replace(/==?$/, '');
  }
  if (data.length % 4 === 1 || /[^+/0-9A-Za-z]/.test(data)) {
    return null;
  }
  let output = '';
  let buffer = 0;
  let accumulatedBits = 0;
  for (let i = 0; i < data.length; i++) {
    buffer <<= 6;
    buffer |= atobLookup(data[i]);
    accumulatedBits += 6;
    if (accumulatedBits === 24) {
      output += String.fromCharCode((buffer & 0xff0000) >> 16);
      output += String.fromCharCode((buffer & 0xff00) >> 8);
      output += String.fromCharCode(buffer & 0xff);
      buffer = accumulatedBits = 0;
    }
  }
  if (accumulatedBits === 12) {
    buffer >>= 4;
    output += String.fromCharCode(buffer);
  } else if (accumulatedBits === 18) {
    buffer >>= 2;
    output += String.fromCharCode((buffer & 0xff00) >> 8);
    output += String.fromCharCode(buffer & 0xff);
  }
  return output;
}

function btoaLookup(index) {
  if (index >= 0 && index < 64) {
    return keystr[index];
  }
  return undefined;
}
function btoa(s) {
  if (arguments.length === 0) {
    throw new TypeError('1 argument required, but only 0 present.');
  }

  let i;
  s = `${s}`;
  for (i = 0; i < s.length; i++) {
    if (s.charCodeAt(i) > 255) {
      return null;
    }
  }
  let out = '';
  for (i = 0; i < s.length; i += 3) {
    const groupsOfSix = [undefined, undefined, undefined, undefined];
    groupsOfSix[0] = s.charCodeAt(i) >> 2;
    groupsOfSix[1] = (s.charCodeAt(i) & 0x03) << 4;
    if (s.length > i + 1) {
      groupsOfSix[1] |= s.charCodeAt(i + 1) >> 4;
      groupsOfSix[2] = (s.charCodeAt(i + 1) & 0x0f) << 2;
    }
    if (s.length > i + 2) {
      groupsOfSix[2] |= s.charCodeAt(i + 2) >> 6;
      groupsOfSix[3] = s.charCodeAt(i + 2) & 0x3f;
    }
    for (let j = 0; j < groupsOfSix.length; j++) {
      if (typeof groupsOfSix[j] === 'undefined') {
        out += '=';
      } else {
        out += btoaLookup(groupsOfSix[j]);
      }
    }
  }
  return out;
}

function isUrl(value) {
  return /^(https?:\/\/)/i.test(value);
}

function cleanUrl(value) {
  const index = value.indexOf('?');
  if (index > 0) {
    return value.substring(0, index);
  } else {
    return value;
  }
}

function isBase64(value) {
  return /^data:image\/[a-z]+;base64,/.test(value);
}

function removeRelative(relative) {
  const parts = relative.split('/');
  const resolvedParts = [];

  for (const part of parts) {
    if (part === '..') {
      resolvedParts.pop();
    } else if (part !== '.') {
      resolvedParts.push(part);
    }
  }
  return resolvedParts.join('/');
}

// 有效文件前缀
const VALID_EXTENTION = [
  'png',
  'jpg',
  'jpeg',
  'gif',
  'svg',
  'js',
  'json',
  'cer',
  'obj',
  'dae',
  'fbx',
  'mtl',
  'stl',
  '3ds',
  'mp3',
  'pvr',
  'wav',
  'plist',
  'ttf',
  'fnt',
  'gz',
  'ccz',
  'm4a',
  'mp4',
  'bmp',
  'atlas',
  'swf',
  'ani',
  'part',
  'proto',
  'bin',
  'sk',
  'mipmaps',
  'txt',
  'zip',
  'tt',
  'map',
  'ogg',
  'silk',
  'dbbin',
  'dbmv',
  'etc',
  'lmat',
  'lm',
  'ls',
  'lh',
  'lani',
  'lav',
  'lsani',
  'ltc',
  'aac',
  'astc',
  'br',
  'csv',
  'cur',
  'dat',
  'dds',
  'glb',
  'gltf',
  'ico',
  'ktx',
  'lmani',
  'lml',
  'pkm',
  'prefab',
  'scene',
  'skel',
  'wasm',
  'xml',
];

/** 获得有效的本地地址
 * 1. 去掉相对路径值,方便readFile
 * 2. 替换不支持的后缀为tt (需要修改原文件后缀)
 */
function getValidLocalFilePath(relative) {
  const absolute = removeRelative(relative);
  const extention = absolute.substring(absolute.lastIndexOf('.') + 1);
  if (VALID_EXTENTION.includes(extention)) {
    return absolute;
  } else {
    return absolute.substring(0, absolute.length - extention.length) + 'tt';
  }
}

/**
 * 代理替换 instance 的 method 方法
 * @param {*} instance
 * @param {*} method
 * @param {*} proxy
 */
function proxyMethod(instance, method, proxy = (instance, oldMethod, args) => oldMethod.apply(instance, args)) {
  const oldMethod = instance[method];
  instance[method] = function () {
    return proxy(instance, oldMethod, arguments);
  };
}

/**
 * 对于异步的初始化对象的单例实现
 * instanceGetter可以是一个promise获一个正常函数.
 * 返回的结果为全局唯一的结果, 且保证获取操作只执行一次.并行安全
 */
const instanceMap = new Map();
async function getInstance(instanceGetter) {
  // {result, loading}
  const value = instanceMap.get(instanceGetter) || {};
  instanceMap.set(instanceGetter, value);

  if (value.result) {
    return value.result;
  }
  try {
    if (!value.loading) {
      value.loading = instanceGetter();
    }
    if (value.loading instanceof Promise) {
      value.result = await value.loading;
    } else {
      value.result = value.loading;
    }
  } finally {
    value.loading = null;
  }
  return value.result;
}

export {
  atob,
  btoa,
  isUrl,
  isBase64,
  cleanUrl,
  getValidLocalFilePath,
  proxyMethod,
  getInstance, //
};
