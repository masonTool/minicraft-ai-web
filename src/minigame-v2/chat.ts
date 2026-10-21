import { UiLayer, box, button, text } from './ui-kit/index.ts';

export interface ChatDeps {
  ui: UiLayer;
  uiHeight: number;
  askText(initial: string, maxLength: number): Promise<string | null>;
  showHud(): void;
  seed(): number | null;
  position(): { x: number; y: number; z: number };
  heal(): void;
  setTime(kind: 'day' | 'night'): void;
  setWeather(kind: 'clear' | 'rain' | 'thunder'): void;
  setGameMode(mode: 'survival' | 'creative'): void;
  teleport(x: number, y: number, z: number): void;
  give(id: number, count: number): number;
  clear(): void;
  kill(): void;
  toggleFly(): boolean;
}

/** 本地聊天与命令面板；不包含联机。 */
export class ChatSystem {
  private readonly messages: string[] = ['v2 本地聊天', '输入 /help 查看命令'];
  private input = '';
  private open = false;

  constructor(private readonly deps: ChatDeps) {}

  get isOpen(): boolean {
    return this.open;
  }

  show(): void {
    this.open = true;
    const panelW = 760;
    const panelH = Math.min(460, this.deps.uiHeight - 32);
    const panelX = (1024 - panelW) / 2;
    const panelY = (this.deps.uiHeight - panelH) / 2;
    const visible = this.messages.slice(-8);
    const lines = visible.map((line, index) =>
      text(panelX + 28, panelY + 80 + index * 28, panelW - 56, 26, line, {
        fontSize: 17,
        color: index === visible.length - 1 ? '#ffffff' : 'rgba(220,235,245,0.78)',
      }),
    );
    this.deps.ui.setRoot(
      box(0, 0, 1024, this.deps.uiHeight, [
        box(0, 0, 1024, this.deps.uiHeight, [], { background: 'rgba(0,0,0,0.55)' }),
        box(panelX, panelY, panelW, panelH, [
          text(panelX + 28, panelY + 20, 500, 40, '聊天', { fontSize: 30, color: '#ffffff' }),
          button(panelX + panelW - 70, panelY + 20, 42, 42, 'X', () => {
            this.open = false;
            this.deps.showHud();
          }, { background: 'rgba(30,38,46,0.95)', border: 'rgba(180,215,235,0.35)', radius: 8 }),
          ...lines,
          button(panelX + 28, panelY + panelH - 68, panelW - 220, 44, this.input || '点击输入聊天/命令', () => {
            const wxApi = (globalThis as unknown as { wx?: { showKeyboard?: (options: any) => void } }).wx;
            if (!wxApi?.showKeyboard) return;
            void this.deps.askText(this.input, 80).then((value) => {
              if (value !== null) {
                this.input = value;
                this.show();
              }
            });
          }, { background: 'rgba(22,30,36,0.95)', border: 'rgba(180,215,235,0.35)', radius: 8 }),
          button(panelX + panelW - 176, panelY + panelH - 68, 148, 44, '发送', () => this.send(this.input), {
            background: 'rgba(60,110,90,0.96)',
            border: 'rgba(190,235,215,0.55)',
            radius: 8,
          }),
        ], {
          background: 'rgba(16,22,28,0.97)',
          border: 'rgba(170,205,230,0.45)',
          borderWidth: 2,
          radius: 12,
        }),
      ]),
    );
  }

  private push(line: string): void {
    this.messages.push(line);
    if (this.messages.length > 9) this.messages.splice(0, this.messages.length - 9);
  }

  private send(value: string): void {
    const textValue = value.trim();
    if (!textValue) return;
    const [command, ...args] = textValue.split(/\s+/);
    if (command === '/help') {
      this.push('/help · /seed · /pos · /heal · /kill');
      this.push('/give id [count] · /clear · /fly');
      this.push('/gamemode survival|creative · /tp x y z');
      this.push('/weather clear|rain|thunder · /time set day|night');
      this.push('聊天为 v2 本地日志，尚未接联机');
    } else if (command === '/seed') {
      this.push(`种子 ${this.deps.seed() ?? '-'}`);
    } else if (command === '/time') {
      if (args[0] === 'set' && (args[1] === 'day' || args[1] === 'night')) {
        this.deps.setTime(args[1]);
        this.push(`时间：${args[1] === 'day' ? '白天' : '夜晚'}`);
      } else {
        this.push('用法：/time set day|night');
      }
    } else if (command === '/pos') {
      const pos = this.deps.position();
      this.push(`坐标 ${pos.x.toFixed(1)}, ${pos.y.toFixed(1)}, ${pos.z.toFixed(1)}`);
    } else if (command === '/heal') {
      this.deps.heal();
      this.push('生命/饥饿已恢复');
    } else if (command === '/weather') {
      const kind = args[0];
      if (kind !== 'clear' && kind !== 'rain' && kind !== 'thunder') {
        this.push('用法：/weather clear|rain|thunder');
      } else {
        this.deps.setWeather(kind);
        this.push(`天气：${kind}`);
      }
    } else if (command === '/give') {
      const id = Number(args[0]);
      const count = Number.isFinite(Number(args[1])) ? Math.max(1, Math.min(64, Number(args[1]))) : 1;
      if (!Number.isInteger(id) || id <= 0) {
        this.push('用法：/give id [count]');
      } else {
        const remaining = this.deps.give(id, count);
        this.push(remaining > 0 ? `背包已满，剩余 ${remaining}` : `已给予 ${id} x${count}`);
      }
    } else if (command === '/clear') {
      this.deps.clear();
      this.push('背包已清空');
    } else if (command === '/kill') {
      this.deps.kill();
      this.push('已执行 /kill');
    } else if (command === '/fly') {
      const flying = this.deps.toggleFly();
      this.push(`飞行：${flying ? '开' : '关'}`);
    } else if (command === '/gamemode') {
      const mode = args[0] === 'creative' ? 'creative' : args[0] === 'survival' ? 'survival' : null;
      if (!mode) {
        this.push('用法：/gamemode survival|creative');
      } else if (this.deps.seed() !== null) {
        this.deps.setGameMode(mode);
        this.push(`游戏模式：${mode === 'creative' ? '创造' : '生存'}`);
      }
    } else if (command === '/tp') {
      const [x, y, z] = args.map(Number);
      if (![x, y, z].every((n) => Number.isFinite(n))) {
        this.push('用法：/tp x y z');
      } else {
        this.deps.teleport(x!, y!, z!);
        this.push(`已传送到 ${x}, ${y}, ${z}`);
      }
    } else {
      this.push(`我：${textValue}`);
    }
    this.input = '';
    this.show();
  }
}
