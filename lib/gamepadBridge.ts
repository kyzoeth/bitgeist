import {
  NES_INPUT_A,
  NES_INPUT_B,
  NES_INPUT_DOWN,
  NES_INPUT_LEFT,
  NES_INPUT_RIGHT,
  NES_INPUT_SELECT,
  NES_INPUT_START,
  NES_INPUT_UP,
} from './inputReplay';
import type { ConsoleSystemId } from './types';

export interface GamepadPollSnapshot {
  connected: boolean;
  controllerLabel: string | null;
  shortBrandLabel: string | null;
  buttonsMask: number;
  virtualButtons: string[];
  anyActionOrDirPressed: boolean;
  aJustPressed: boolean;
  bJustPressed: boolean;
  startJustPressed: boolean;
  selectJustPressed: boolean;
  prevSegmentJustPressed: boolean;
  nextSegmentJustPressed: boolean;
}

export type GamepadRumblePreset = 'start' | 'overtake' | 'death' | 'victory' | 'step';

const RADIAL_DEADZONE = 0.32;
// sin(22.5 deg) = 0.38268 -> divides 360 deg into 8 equal 45-degree octants for crisp diagonal dashes
const OCTANT_SIN_THRESHOLD = 0.3827;
const TRIGGER_THRESHOLD = 0.35;

interface GamepadHapticActuatorLike {
  playEffect?: (
    type: string,
    params: {
      startDelay?: number;
      duration: number;
      weakMagnitude: number;
      strongMagnitude: number;
    }
  ) => Promise<unknown>;
  pulse?: (value: number, duration: number) => Promise<unknown>;
}

type ExtendedGamepad = Gamepad & {
  vibrationActuator?: GamepadHapticActuatorLike | null;
};

function isBtnPressed(btn: GamepadButton | undefined, threshold = TRIGGER_THRESHOLD): boolean {
  if (!btn) return false;
  return Boolean(btn.pressed) || (typeof btn.value === 'number' && btn.value > threshold);
}

function hasAnyPadActivity(pad: Gamepad): boolean {
  for (let i = 0; i < pad.buttons.length; i++) {
    if (isBtnPressed(pad.buttons[i])) return true;
  }
  const ax = pad.axes[0] ?? 0;
  const ay = pad.axes[1] ?? 0;
  return Math.hypot(ax, ay) > RADIAL_DEADZONE;
}

export function detectControllerShortBrand(rawId: string): string {
  const s = rawId.toLowerCase();
  if (s.includes('dualsense') || s.includes('054c') && s.includes('0ce6')) return 'PS5 PAD';
  if (s.includes('dualshock') || s.includes('playstation') || s.includes('054c')) return 'PS4 PAD';
  if (s.includes('xbox') || s.includes('xinput') || s.includes('045e')) return 'XBOX PAD';
  if (s.includes('8bitdo') || s.includes('2dc8')) return '8BITDO';
  if (s.includes('switch') || s.includes('joy-con') || s.includes('pro controller') || s.includes('057e')) {
    return 'SWITCH';
  }
  return 'PAD';
}

const DISCONNECTED_SNAPSHOT: GamepadPollSnapshot = {
  connected: false,
  controllerLabel: null,
  shortBrandLabel: null,
  buttonsMask: 0,
  virtualButtons: [],
  anyActionOrDirPressed: false,
  aJustPressed: false,
  bJustPressed: false,
  startJustPressed: false,
  selectJustPressed: false,
  prevSegmentJustPressed: false,
  nextSegmentJustPressed: false,
};

export class GamepadPoller {
  private lastActivePadIndex: number = -1;
  private usedInSession = false;
  private prevAPressed = false;
  private prevBPressed = false;
  private prevStartPressed = false;
  private prevSelectPressed = false;
  private prevL1Pressed = false;
  private prevR1Pressed = false;

  private resetEdges(): void {
    this.prevAPressed = false;
    this.prevBPressed = false;
    this.prevStartPressed = false;
    this.prevSelectPressed = false;
    this.prevL1Pressed = false;
    this.prevR1Pressed = false;
  }

  poll(
    consoleSystem: ConsoleSystemId = 'nes',
    isCelesteSprint: boolean = true
  ): GamepadPollSnapshot {
    if (typeof navigator === 'undefined' || typeof navigator.getGamepads !== 'function') {
      this.resetEdges();
      return DISCONNECTED_SNAPSHOT;
    }

    let pads: (Gamepad | null)[];
    try {
      pads = navigator.getGamepads();
    } catch {
      this.resetEdges();
      return DISCONNECTED_SNAPSHOT;
    }

    // 1. Dynamically lock onto whichever connected gamepad most recently saw live input,
    // avoiding dummy virtual HID devices (keyboards/pedals) occupying slot 0.
    let activePad: Gamepad | null = null;
    for (let i = 0; i < pads.length; i++) {
      const p = pads[i];
      if (p && p.connected && hasAnyPadActivity(p)) {
        this.lastActivePadIndex = p.index;
        this.usedInSession = true;
        activePad = p;
        break;
      }
    }

    if (!activePad && this.lastActivePadIndex >= 0) {
      const remembered = pads[this.lastActivePadIndex];
      if (remembered && remembered.connected) {
        activePad = remembered;
      }
    }

    if (!activePad) {
      // Prefer W3C 'standard' mapped gamepads over unmapped auxiliary HID devices
      for (let i = 0; i < pads.length; i++) {
        const p = pads[i];
        if (p && p.connected && p.mapping === 'standard') {
          activePad = p;
          this.lastActivePadIndex = p.index;
          break;
        }
      }
    }

    if (!activePad) {
      for (let i = 0; i < pads.length; i++) {
        const p = pads[i];
        if (p && p.connected) {
          activePad = p;
          this.lastActivePadIndex = p.index;
          break;
        }
      }
    }

    if (!activePad) {
      this.lastActivePadIndex = -1;
      this.resetEdges();
      return DISCONNECTED_SNAPSHOT;
    }

    const btns = activePad.buttons;
    const axes = activePad.axes;

    // 2. Crisp 8-Way Radial Octant Analog Stick + Hardware D-Pad Merging
    const ax = axes.length > 0 ? axes[0] : 0;
    const ay = axes.length > 1 ? axes[1] : 0;
    const stickMag = Math.hypot(ax, ay);
    let stickUp = false;
    let stickDown = false;
    let stickLeft = false;
    let stickRight = false;
    if (stickMag > RADIAL_DEADZONE) {
      const nx = ax / stickMag;
      const ny = ay / stickMag;
      stickRight = nx > OCTANT_SIN_THRESHOLD;
      stickLeft = nx < -OCTANT_SIN_THRESHOLD;
      stickDown = ny > OCTANT_SIN_THRESHOLD;
      stickUp = ny < -OCTANT_SIN_THRESHOLD;
    }

    const up = isBtnPressed(btns[12]) || stickUp;
    const down = isBtnPressed(btns[13]) || stickDown;
    const left = isBtnPressed(btns[14]) || stickLeft;
    const right = isBtnPressed(btns[15]) || stickRight;

    const south0 = isBtnPressed(btns[0]);
    const east1 = isBtnPressed(btns[1]);
    const west2 = isBtnPressed(btns[2]);
    const north3 = isBtnPressed(btns[3]);
    const l1 = isBtnPressed(btns[4]);
    const r1 = isBtnPressed(btns[5]);
    const l2 = isBtnPressed(btns[6]);
    const r2 = isBtnPressed(btns[7]);
    const selectPressed = isBtnPressed(btns[8]);
    const startPressed = isBtnPressed(btns[9]);

    const isMultiButtonConsole =
      consoleSystem === 'snes' || consoleSystem === 'gba' || consoleSystem === 'genesis';

    let jumpA: boolean;
    let actionB: boolean;
    let btnX = false;
    let btnY = false;
    let shoulderL = false;
    let shoulderR = false;

    if (isMultiButtonConsole) {
      // Authentic SNES / GBA / Genesis 4-face + L/R shoulder layout
      actionB = south0;
      jumpA = east1;
      btnY = west2;
      btnX = north3;
      shoulderL = l1 || l2;
      shoulderR = r1 || r2;
    } else if (isCelesteSprint) {
      // Ergonomic modern platformer mapping for CelesteNES:
      // - Jump (NES A): South (Xbox A / PS Cross), North (Y / Triangle), or R2/RT trigger
      // - Dash (NES B): West (Xbox X / PS Square), East (Xbox B / PS Circle), or L2/LT trigger
      // - L1/LB & R1/RB bumpers step cleanly across the 6 Celeste speedrun segments!
      jumpA = south0 || north3 || r2;
      actionB = west2 || east1 || l2;
    } else {
      // Custom 2-button NES / Game Boy ROMs
      jumpA = south0 || north3 || r1 || r2;
      actionB = west2 || east1 || l1 || l2;
    }

    const aJustPressed = jumpA && !this.prevAPressed;
    const bJustPressed = actionB && !this.prevBPressed;
    const startJustPressed = startPressed && !this.prevStartPressed;
    const selectJustPressed = selectPressed && !this.prevSelectPressed;
    const prevSegmentJustPressed = isCelesteSprint && !isMultiButtonConsole && l1 && !this.prevL1Pressed;
    const nextSegmentJustPressed = isCelesteSprint && !isMultiButtonConsole && r1 && !this.prevR1Pressed;

    this.prevAPressed = jumpA;
    this.prevBPressed = actionB;
    this.prevStartPressed = startPressed;
    this.prevSelectPressed = selectPressed;
    this.prevL1Pressed = l1;
    this.prevR1Pressed = r1;

    let mask = 0;
    const virtualButtons: string[] = [];

    if (right) {
      mask |= NES_INPUT_RIGHT;
      virtualButtons.push('right');
    }
    if (left) {
      mask |= NES_INPUT_LEFT;
      virtualButtons.push('left');
    }
    if (down) {
      mask |= NES_INPUT_DOWN;
      virtualButtons.push('down');
    }
    if (up) {
      mask |= NES_INPUT_UP;
      virtualButtons.push('up');
    }
    if (jumpA) {
      mask |= NES_INPUT_A;
      virtualButtons.push('a');
    }
    if (actionB) {
      mask |= NES_INPUT_B;
      virtualButtons.push('b');
    }
    if (btnX) {
      mask |= NES_INPUT_A;
      virtualButtons.push('x');
    }
    if (btnY) {
      mask |= NES_INPUT_B;
      virtualButtons.push('y');
    }
    if (shoulderL) {
      virtualButtons.push('l');
    }
    if (shoulderR) {
      virtualButtons.push('r');
    }
    if (selectPressed) {
      mask |= NES_INPUT_SELECT;
      if (!isCelesteSprint) {
        virtualButtons.push('select');
      }
    }
    if (startPressed) {
      mask |= NES_INPUT_START;
      if (!isCelesteSprint) {
        virtualButtons.push('start');
      }
    }

    const rawId = activePad.id || 'Gamepad';
    const cleanLabel = rawId.replace(/\s*\([^)]*(?:standard gamepad|vendor:)[^)]*\)/gi, '').trim();
    return {
      connected: true,
      controllerLabel: (cleanLabel || rawId).slice(0, 48),
      shortBrandLabel: detectControllerShortBrand(rawId),
      buttonsMask: mask,
      virtualButtons,
      anyActionOrDirPressed:
        right || left || down || up || jumpA || actionB || btnX || btnY || shoulderL || shoulderR,
      aJustPressed,
      bJustPressed,
      startJustPressed,
      selectJustPressed,
      prevSegmentJustPressed,
      nextSegmentJustPressed,
    };
  }

  /**
   * Triggers non-blocking W3C dual-rumble haptic feedback on the active hardware controller
   * (only if the player has actively used the controller during this session).
   */
  pulseRumble(preset: GamepadRumblePreset): void {
    if (!this.usedInSession || this.lastActivePadIndex < 0) return;
    if (typeof navigator === 'undefined' || typeof navigator.getGamepads !== 'function') return;

    try {
      const pad = navigator.getGamepads()[this.lastActivePadIndex] as ExtendedGamepad | null;
      const actuator = pad?.vibrationActuator;
      if (!pad || !pad.connected || !actuator) return;

      const specs: Record<
        GamepadRumblePreset,
        { duration: number; strongMagnitude: number; weakMagnitude: number }
      > = {
        step: { duration: 24, strongMagnitude: 0, weakMagnitude: 0.2 },
        start: { duration: 36, strongMagnitude: 0.1, weakMagnitude: 0.28 },
        overtake: { duration: 68, strongMagnitude: 0.22, weakMagnitude: 0.5 },
        death: { duration: 95, strongMagnitude: 0.65, weakMagnitude: 0.35 },
        victory: { duration: 145, strongMagnitude: 0.55, weakMagnitude: 0.8 },
      };

      const spec = specs[preset];
      if (typeof actuator.playEffect === 'function') {
        void actuator.playEffect('dual-rumble', spec).catch(() => {});
      } else if (typeof actuator.pulse === 'function') {
        void actuator.pulse(Math.max(spec.strongMagnitude, spec.weakMagnitude), spec.duration).catch(
          () => {}
        );
      }
    } catch {
      // Ignore browsers/controllers without haptic actuator support
    }
  }
}
