export interface V2Settings {
  brightness: number;
  viewDistance: number;
  sensitivity: number;
  fov: number;
  invertY: boolean;
  autoJump: boolean;
  showDebug: boolean;
  fingerAim: boolean;
  sound: boolean;
  volume: number;
  volumeBlocks: number;
  volumeUi: number;
  quality: 'auto' | 'high' | 'low';
  volumeMobs: number;
  volumePlayer: number;
  volumeAmbient: number;
  volumeMusic: number;
  leftHanded: boolean;
  view: 'first' | 'third';
  skinColor: string;
  shirtColor: string;
  pantsColor: string;
  hairStyle: 'none' | 'short' | 'long';
  hairColor: string;
  beard: boolean;
  eyeColor: string;
  cape: boolean;
  eyeStyle: 'normal' | 'wide';
  age: 'young' | 'adult' | 'old';
  build: 'slim' | 'normal' | 'broad';
}

export interface SettingsStorage {
  get(key: string): string | null;
  set(key: string, value: string): void;
}

const SETTINGS_KEY = 'wx.v2.settings';

export const defaultSettings: V2Settings = {
  brightness: 1,
  viewDistance: 2,
  sensitivity: 1,
  fov: 72,
  invertY: false,
  autoJump: false,
  showDebug: false,
  fingerAim: true,
  sound: true,
  volume: 0.7,
  volumeBlocks: 1,
  volumeUi: 1,
  quality: 'auto',
  volumeMobs: 1,
  volumePlayer: 1,
  volumeAmbient: 1,
  volumeMusic: 1,
  leftHanded: false,
  view: 'first',
  skinColor: '#e0ac69',
  shirtColor: '#3b6ea5',
  pantsColor: '#2f3f5a',
  hairStyle: 'short',
  hairColor: '#3b2a1a',
  beard: false,
  eyeColor: '#3b2a1a',
  cape: false,
  eyeStyle: 'normal',
  age: 'adult',
  build: 'normal',
};

export function readSettings(storage: SettingsStorage): V2Settings {
  try {
    const raw = storage.get(SETTINGS_KEY);
    if (!raw) return { ...defaultSettings };
    const parsed = JSON.parse(raw) as Partial<V2Settings>;
    return {
      brightness: Math.max(0.5, Math.min(2, Number(parsed.brightness ?? 1))),
      viewDistance: Math.max(1, Math.min(4, Math.round(Number(parsed.viewDistance ?? 2)))),
      sensitivity: Math.max(0.5, Math.min(2, Number(parsed.sensitivity ?? 1))),
      fov: Math.max(60, Math.min(110, Number(parsed.fov ?? 72))),
      invertY: parsed.invertY === true,
      autoJump: parsed.autoJump === true,
      showDebug: parsed.showDebug === true,
      fingerAim: parsed.fingerAim !== false,
      sound: parsed.sound !== false,
      volume: Math.max(0, Math.min(1, Number(parsed.volume ?? 0.7))),
      volumeBlocks: Math.max(0, Math.min(1, Number(parsed.volumeBlocks ?? 1))),
      volumeUi: Math.max(0, Math.min(1, Number(parsed.volumeUi ?? 1))),
      quality: parsed.quality === 'high' || parsed.quality === 'low' ? parsed.quality : 'auto',
      volumeMobs: Math.max(0, Math.min(1, Number(parsed.volumeMobs ?? 1))),
      volumePlayer: Math.max(0, Math.min(1, Number(parsed.volumePlayer ?? 1))),
      volumeAmbient: Math.max(0, Math.min(1, Number(parsed.volumeAmbient ?? 1))),
      volumeMusic: Math.max(0, Math.min(1, Number(parsed.volumeMusic ?? 1))),
      leftHanded: parsed.leftHanded === true,
      view: parsed.view === 'third' ? 'third' : 'first',
      skinColor: typeof parsed.skinColor === 'string' ? parsed.skinColor : '#e0ac69',
      shirtColor: typeof parsed.shirtColor === 'string' ? parsed.shirtColor : '#3b6ea5',
      pantsColor: typeof parsed.pantsColor === 'string' ? parsed.pantsColor : '#2f3f5a',
      hairStyle: parsed.hairStyle === 'none' || parsed.hairStyle === 'long' ? parsed.hairStyle : 'short',
      hairColor: typeof parsed.hairColor === 'string' ? parsed.hairColor : '#3b2a1a',
      beard: parsed.beard === true,
      eyeColor: typeof parsed.eyeColor === 'string' ? parsed.eyeColor : '#3b2a1a',
      cape: parsed.cape === true,
      eyeStyle: parsed.eyeStyle === 'wide' ? 'wide' : 'normal',
      age: parsed.age === 'young' || parsed.age === 'old' ? parsed.age : 'adult',
      build: parsed.build === 'slim' || parsed.build === 'broad' ? parsed.build : 'normal',
    };
  } catch {
    return { ...defaultSettings };
  }
}

export function saveSettings(storage: SettingsStorage, settings: V2Settings): void {
  storage.set(SETTINGS_KEY, JSON.stringify(settings));
}
