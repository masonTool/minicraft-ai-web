import HTMLElement from './HTMLElement';

export class HTMLMediaElement extends HTMLElement {
  constructor(tagName) {
    super(tagName);
  }

  canPlayType(mediaType) {
    if (typeof mediaType !== 'string') {
      return '';
    }
    return 'probably';
  }
}

export class HTMLVideoElement extends HTMLMediaElement {
  constructor(tagName) {
    super(tagName);
  }
}

export class HTMLAudioElement extends HTMLMediaElement {
  constructor(tagName) {
    super(tagName);
  }
}