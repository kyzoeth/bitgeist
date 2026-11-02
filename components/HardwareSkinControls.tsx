'use client';

import React from 'react';
import {
  NES_INPUT_A,
  NES_INPUT_B,
  NES_INPUT_DOWN,
  NES_INPUT_LEFT,
  NES_INPUT_RIGHT,
  NES_INPUT_SELECT,
  NES_INPUT_START,
  NES_INPUT_UP,
} from '@/lib/inputReplay';
import { ConsoleSystemId, RaceStatus } from '@/lib/types';

const RAINBOW_SEGMENTS = [
  '#EC6553',
  '#F28C38',
  '#F5C342',
  '#D9E04B',
  '#6BCB77',
  '#4ECDC4',
  '#45B7D1',
  '#5E81F4',
  '#9B5DE5',
  '#F15BB5',
];

function RainbowSprintProgress({ activeSegments }: { activeSegments: number }) {
  return (
    <div className="flex items-center gap-2 flex-1 min-w-0">
      <span className="text-[10px] font-black tracking-wider text-white/75 shrink-0">START</span>
      <div className="flex-1 grid grid-cols-11 gap-0.5 bg-[#16151C] border border-white/15 p-0.5 rounded">
        {RAINBOW_SEGMENTS.map((hex, idx) => (
          <div
            key={hex}
            style={{
              backgroundColor: hex,
              opacity: idx < activeSegments ? 1 : 0.22,
            }}
            className="h-3 transition-opacity duration-100 rounded-[1.5px]"
          />
        ))}
        <div className="h-3 text-[10px] bg-white flex items-center justify-center leading-none rounded-[1.5px]">
          🏁
        </div>
      </div>
      <span className="text-[10px] font-black tracking-wider text-white/75 shrink-0">GOAL</span>
    </div>
  );
}

interface SprintBottomBannerTrackProps {
  raceStatus: RaceStatus;
  activeSegments: number;
  gamepadConnected?: boolean;
  countdownStep?: '3' | '2' | '1' | 'GO!' | null;
  onStartRace?: () => void;
}

export function SprintBottomBannerTrack({
  raceStatus,
  activeSegments,
  gamepadConnected = false,
  countdownStep = null,
  onStartRace,
}: SprintBottomBannerTrackProps) {
  if (raceStatus === 'pregame') {
    return (
      <div
        aria-label="Pre-Game Story and Menu Sync Bar"
        className="h-[24px] flex-1 min-w-0 bg-[#17161D] text-[#FFE74C] border border-[#7FD1AE]/75 rounded px-2.5 flex items-center justify-center gap-1.5 font-black text-[10px] uppercase tracking-tight whitespace-nowrap overflow-hidden"
      >
        <span className="truncate flex items-center gap-1.5 min-w-0">
          <span
            aria-hidden="true"
            className="w-2 h-2 rounded-full bg-[#7FD1AE] shadow-[0_0_5px_#7FD1AE] animate-pulse shrink-0"
          />
          <span className="truncate">
            <span className="hidden sm:inline">INTRO / MENU • </span>ENTER STAGE TO AUTO-SYNC 00.00s
          </span>
        </span>
      </div>
    );
  }
  if (raceStatus === 'countdown') {
    const isGo = countdownStep === 'GO!';
    const litCount =
      countdownStep === '3'
        ? 1
        : countdownStep === '2'
          ? 2
          : countdownStep === '1' || isGo
            ? 3
            : 0;
    return (
      <div
        aria-label="Pre-Race Starting Lights"
        className="h-[24px] flex-1 min-w-0 bg-[#17161D] text-[#FFE74C] border border-[#F5C342]/70 rounded px-2.5 flex items-center justify-center gap-2 font-black text-[10.5px] uppercase tracking-wider whitespace-nowrap overflow-hidden"
      >
        <span className="flex items-center gap-1.5" aria-hidden="true">
          <span
            className={`w-2.5 h-2.5 rounded-full border border-black/60 transition-colors ${
              isGo
                ? 'bg-[#6BCB77] shadow-[0_0_6px_#6BCB77]'
                : litCount >= 1
                  ? 'bg-[#EC6553] shadow-[0_0_6px_#EC6553]'
                  : 'bg-white/15'
            }`}
          />
          <span
            className={`w-2.5 h-2.5 rounded-full border border-black/60 transition-colors ${
              isGo
                ? 'bg-[#6BCB77] shadow-[0_0_6px_#6BCB77]'
                : litCount >= 2
                  ? 'bg-[#F5C342] shadow-[0_0_6px_#F5C342]'
                  : 'bg-white/15'
            }`}
          />
          <span
            className={`w-2.5 h-2.5 rounded-full border border-black/60 transition-colors ${
              isGo
                ? 'bg-[#6BCB77] shadow-[0_0_6px_#6BCB77]'
                : litCount >= 3
                  ? 'bg-[#FFE74C] shadow-[0_0_6px_#FFE74C]'
                  : 'bg-white/15'
            }`}
          />
        </span>
        <span>
          {isGo
            ? 'LAUNCH!'
            : gamepadConnected
              ? 'HOLD STICK OR → TO LAUNCH ON GO!'
              : 'HOLD → TO LAUNCH ON GO!'}
        </span>
      </div>
    );
  }

  if (raceStatus === 'waiting') {
    return (
      <button
        type="button"
        onClick={onStartRace}
        className="h-[24px] flex-1 min-w-0 bg-[#F5C342] hover:bg-[#FFE74C] text-[#111111] border border-[#111111] rounded px-2.5 flex items-center justify-center gap-1.5 font-black text-[10.5px] uppercase tracking-tight cursor-pointer transition-colors whitespace-nowrap overflow-hidden"
      >
        <span aria-hidden="true" className="text-[#D93829] text-[10px] leading-none">
          ▶
        </span>
        <span>{gamepadConnected ? 'PRESS PAD OR' : 'PRESS'}</span>
        <span className="bg-[#FFFDF7] border border-[#111111] rounded px-1 py-px text-[10px] leading-none">
          →
        </span>
        <span className="hidden sm:inline">OR CLICK</span>
        <span>TO RACE!</span>
      </button>
    );
  }

  return (
    <div className="h-[24px] flex items-center flex-1 min-w-0">
      <RainbowSprintProgress activeSegments={activeSegments} />
    </div>
  );
}

export function MusicStatusIcon({
  muted,
  size = 16,
}: {
  muted: boolean;
  size?: number;
}) {
  return muted ? (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M11 5L6 9H2v6h4l5 4V5z" />
      <line x1="22" y1="9" x2="16" y2="15" />
      <line x1="16" y1="9" x2="22" y2="15" />
    </svg>
  ) : (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M11 5L6 9H2v6h4l5 4V5z" />
      <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
      <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
    </svg>
  );
}

export function SfxStatusIcon({
  muted,
  size = 15,
}: {
  muted: boolean;
  size?: number;
}) {
  return muted ? (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
      <line x1="3" y1="3" x2="21" y2="21" />
    </svg>
  ) : (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  );
}

export function RestartIcon({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
      <path d="M3 3v5h5" />
    </svg>
  );
}

function useSvgButtonBinder(onPadInput?: (button: string, pressed: boolean) => void) {
  return (btn: string) =>
    onPadInput
      ? {
          onPointerDown: (e: React.PointerEvent<SVGElement>) => {
            e.preventDefault();
            onPadInput(btn, true);
          },
          onPointerUp: () => onPadInput(btn, false),
          onPointerCancel: () => onPadInput(btn, false),
          onPointerLeave: () => onPadInput(btn, false),
        }
      : {};
}

/**
 * Tactile 3D Neo-Brutalist NES-004 Controller (144x58, 1:1 pixel SVG coordinate grid).
 * Features a two-tone molded Famicom/NES putty shell with 3D front lip, bold #111111 ink outlines,
 * unified 12-vertex cross D-Pad with molded directional arrows & concave pivot dimple,
 * 4-rib silver center stack + Select/Start rubber capsule tray, and twin square wells
 * housing glossy 3D domed red B & A buttons that physically depress & illuminate at 60Hz.
 */
function MiniNesController({
  visualInputMask,
  onPadInput,
}: {
  visualInputMask: number;
  onPadInput?: (button: string, pressed: boolean) => void;
}) {
  const up = (visualInputMask & NES_INPUT_UP) !== 0;
  const down = (visualInputMask & NES_INPUT_DOWN) !== 0;
  const left = (visualInputMask & NES_INPUT_LEFT) !== 0;
  const right = (visualInputMask & NES_INPUT_RIGHT) !== 0;
  const select = (visualInputMask & NES_INPUT_SELECT) !== 0;
  const start = (visualInputMask & NES_INPUT_START) !== 0;
  const bBtn = (visualInputMask & NES_INPUT_B) !== 0;
  const aBtn = (visualInputMask & NES_INPUT_A) !== 0;

  const bindBtn = useSvgButtonBinder(onPadInput);
  const interactiveClass = onPadInput ? 'cursor-pointer' : undefined;

  return (
    <div
      role="img"
      aria-label="Live NES Controller Input Display"
      title="Live NES-004 Controller (D-Pad, Select, Start, B, A)"
      className="w-[144px] h-[58px] shrink-0 select-none"
    >
      <svg viewBox="0 0 144 58" className="w-full h-full block">
        <defs>
          <clipPath id="nesShellClip">
            <rect x="1.5" y="1.5" width="138" height="51.5" rx="4.8" />
          </clipPath>
        </defs>

        {/* Hard 3D Offset Drop Shadow */}
        <rect x="4.5" y="5" width="138" height="51.5" rx="4.8" fill="#111111" />

        {/* Clipped Two-Tone 3D NES-004 Outer Putty Shell + Lower Front Lip */}
        <g clipPath="url(#nesShellClip)">
          <rect x="1.5" y="1.5" width="138" height="45.7" fill="#EDE6D6" />
          <rect x="1.5" y="47.2" width="138" height="6" fill="#C7BEB0" />
          {/* Top Specular Bevel Highlight */}
          <line
            x1="5"
            y1="3.6"
            x2="136"
            y2="3.6"
            stroke="#FCF9F0"
            strokeWidth="1.3"
            strokeLinecap="round"
          />
          {/* Crisp 3D Front-Edge Seam Line */}
          <line x1="1.5" y1="47.2" x2="139.5" y2="47.2" stroke="#111111" strokeWidth="1.8" />
        </g>

        {/* Bold #111111 Outer Shell Ink Outline */}
        <rect
          x="1.5"
          y="1.5"
          width="138"
          height="51.5"
          rx="4.8"
          fill="none"
          stroke="#111111"
          strokeWidth="2.5"
        />

        {/* Dark Charcoal NES-004 Inner Faceplate */}
        <rect
          x="6.8"
          y="6.4"
          width="127.4"
          height="36.8"
          rx="2.4"
          fill="#2B2A32"
          stroke="#111111"
          strokeWidth="1.8"
        />

        {/* ================================================================= */}
        {/* 1. LEFT ZONE: Unified 12-Vertex Molded NES Cross D-Pad            */}
        {/* ================================================================= */}
        {/* Recessed Ivory Cross Rim (Authentic NES-004 D-Pad Border) */}
        <path
          d="M 19.6 9.6 H 33.4 V 18.1 H 41.9 V 31.9 H 33.4 V 40.4 H 19.6 V 31.9 H 11.1 V 18.1 H 19.6 Z"
          fill="#EDE6D6"
          stroke="#111111"
          strokeWidth="1.2"
          strokeLinejoin="round"
        />

        {/* D-Pad 3D Drop Base */}
        <path
          d="M 22.1 13.4 H 30.9 V 21.6 H 39.1 V 30.4 H 30.9 V 38.6 H 22.1 V 30.4 H 13.9 V 21.6 H 22.1 Z"
          fill="#111111"
          strokeLinejoin="round"
        />

        {/* Unified Matte-Black Cross Body */}
        <path
          d="M 22.1 12.2 H 30.9 V 20.6 H 39.1 V 29.4 H 30.9 V 37.8 H 22.1 V 29.4 H 13.9 V 20.6 H 22.1 Z"
          fill="#222129"
          stroke="#111111"
          strokeWidth="1.4"
          strokeLinejoin="round"
        />

        {/* UP Arm + Molded Arrow */}
        <rect
          x="22.8"
          y="12.9"
          width="7.4"
          height="7.7"
          rx="0.8"
          fill={up ? '#FFE74C' : 'transparent'}
          className={interactiveClass}
          {...bindBtn('up')}
        />
        <path
          d="M 26.5 14.5 L 28.8 18.1 H 24.2 Z"
          fill={up ? '#111111' : '#858092'}
          pointerEvents="none"
        />

        {/* DOWN Arm + Molded Arrow */}
        <rect
          x="22.8"
          y="29.4"
          width="7.4"
          height="7.7"
          rx="0.8"
          fill={down ? '#FFE74C' : 'transparent'}
          className={interactiveClass}
          {...bindBtn('down')}
        />
        <path
          d="M 26.5 35.5 L 28.8 31.9 H 24.2 Z"
          fill={down ? '#111111' : '#858092'}
          pointerEvents="none"
        />

        {/* LEFT Arm + Molded Arrow */}
        <rect
          x="14.6"
          y="21.3"
          width="7.5"
          height="7.4"
          rx="0.8"
          fill={left ? '#FFE74C' : 'transparent'}
          className={interactiveClass}
          {...bindBtn('left')}
        />
        <path
          d="M 16.2 25 L 19.8 22.7 V 27.3 Z"
          fill={left ? '#111111' : '#858092'}
          pointerEvents="none"
        />

        {/* RIGHT Arm + Molded Arrow */}
        <rect
          x="30.9"
          y="21.3"
          width="7.5"
          height="7.4"
          rx="0.8"
          fill={right ? '#FFE74C' : 'transparent'}
          className={interactiveClass}
          {...bindBtn('right')}
        />
        <path
          d="M 36.8 25 L 33.2 22.7 V 27.3 Z"
          fill={right ? '#111111' : '#858092'}
          pointerEvents="none"
        />

        {/* D-Pad Concave Center Pivot Dimple */}
        <circle
          cx="26.5"
          cy="25"
          r="2.5"
          fill="#15141A"
          stroke="#3E3B4A"
          strokeWidth="0.8"
          pointerEvents="none"
        />

        {/* ================================================================= */}
        {/* 2. CENTER ZONE: 4 Silver Ribs + Recessed Select/Start Pill Tray   */}
        {/* ================================================================= */}
        <rect
          x="48"
          y="7.8"
          width="36"
          height="3.8"
          rx="1.2"
          fill="#9E978B"
          stroke="#111111"
          strokeWidth="1.2"
        />
        <rect
          x="48"
          y="13.2"
          width="36"
          height="3.8"
          rx="1.2"
          fill="#9E978B"
          stroke="#111111"
          strokeWidth="1.2"
        />
        <rect
          x="48"
          y="18.2"
          width="36"
          height="4.6"
          rx="1.2"
          fill="#B3ACA0"
          stroke="#111111"
          strokeWidth="1.2"
        />
        <text
          x="56.9"
          y="21.6"
          textAnchor="middle"
          fontSize="3.1"
          fontWeight="900"
          fontFamily="monospace"
          fill="#B92E22"
          pointerEvents="none"
        >
          SELECT
        </text>
        <text
          x="75.1"
          y="21.6"
          textAnchor="middle"
          fontSize="3.1"
          fontWeight="900"
          fontFamily="monospace"
          fill="#B92E22"
          pointerEvents="none"
        >
          START
        </text>

        {/* Recessed Putty Pill Tray */}
        <rect
          x="46.8"
          y="24.4"
          width="38.4"
          height="11.6"
          rx="2.8"
          fill="#E7E0D0"
          stroke="#111111"
          strokeWidth="1.5"
        />

        {/* SELECT 3D Rubber Pill */}
        <rect x="50.8" y="28.6" width="12.2" height="5" rx="2.5" fill="#111111" />
        <rect
          x="50.8"
          y={select ? 28.4 : 27.5}
          width="12.2"
          height="5"
          rx="2.5"
          fill={select ? '#7FD1AE' : '#2E2D36'}
          stroke="#111111"
          strokeWidth="1.3"
          className={interactiveClass}
          {...bindBtn('select')}
        />
        <line
          x1="53.6"
          y1={select ? 29.7 : 28.8}
          x2="60.2"
          y2={select ? 29.7 : 28.8}
          stroke="#FFFFFF"
          strokeOpacity="0.32"
          strokeWidth="0.9"
          strokeLinecap="round"
          pointerEvents="none"
        />

        {/* START 3D Rubber Pill */}
        <rect x="69" y="28.6" width="12.2" height="5" rx="2.5" fill="#111111" />
        <rect
          x="69"
          y={start ? 28.4 : 27.5}
          width="12.2"
          height="5"
          rx="2.5"
          fill={start ? '#7FD1AE' : '#2E2D36'}
          stroke="#111111"
          strokeWidth="1.3"
          className={interactiveClass}
          {...bindBtn('start')}
        />
        <line
          x1="71.8"
          y1={start ? 29.7 : 28.8}
          x2="78.4"
          y2={start ? 29.7 : 28.8}
          stroke="#FFFFFF"
          strokeOpacity="0.32"
          strokeWidth="0.9"
          strokeLinecap="round"
          pointerEvents="none"
        />

        {/* Bottom 4th Rib */}
        <rect
          x="48"
          y="38.0"
          width="36"
          height="3.8"
          rx="1.2"
          fill="#9E978B"
          stroke="#111111"
          strokeWidth="1.2"
        />

        {/* ================================================================= */}
        {/* 3. RIGHT ZONE: Twin Putty Wells + Glossy 3D Domed Red B & A Caps  */}
        {/* ================================================================= */}
        {/* Crimson Brand Bar Accent */}
        <rect
          x="92"
          y="10.5"
          width="21"
          height="2.8"
          rx="1.2"
          fill="#E24638"
          stroke="#111111"
          strokeWidth="1"
        />

        {/* B Button Square Bezel */}
        <rect
          x="91"
          y="18.2"
          width="17.8"
          height="17.8"
          rx="3"
          fill="#E7E0D0"
          stroke="#111111"
          strokeWidth="1.5"
        />
        {bBtn && <circle cx="99.9" cy="27.1" r="8.2" fill="#FFE74C" opacity="0.42" />}
        {/* B 3D Base Shadow */}
        <circle cx="99.9" cy="28.3" r="6.1" fill="#111111" />
        {/* B Glossy Red Cap */}
        <circle
          cx="99.9"
          cy={bBtn ? 28.0 : 26.8}
          r="6.1"
          fill={bBtn ? '#FFE74C' : '#E63B2E'}
          stroke="#111111"
          strokeWidth="1.5"
          className={interactiveClass}
          {...bindBtn('b')}
        />
        {/* B Glossy Specular Highlight Crescent */}
        <path
          d={
            bBtn
              ? 'M 96.6 26.1 A 4.0 4.0 0 0 1 101.4 24.4'
              : 'M 96.6 24.9 A 4.0 4.0 0 0 1 101.4 23.2'
          }
          fill="none"
          stroke={bBtn ? '#FFFFFF' : '#FFD6CE'}
          strokeWidth="1.3"
          strokeLinecap="round"
          pointerEvents="none"
        />

        {/* A Button Square Bezel */}
        <rect
          x="111.8"
          y="18.2"
          width="17.8"
          height="17.8"
          rx="3"
          fill="#E7E0D0"
          stroke="#111111"
          strokeWidth="1.5"
        />
        {aBtn && <circle cx="120.7" cy="27.1" r="8.2" fill="#FFE74C" opacity="0.42" />}
        {/* A 3D Base Shadow */}
        <circle cx="120.7" cy="28.3" r="6.1" fill="#111111" />
        {/* A Glossy Red Cap */}
        <circle
          cx="120.7"
          cy={aBtn ? 28.0 : 26.8}
          r="6.1"
          fill={aBtn ? '#FFE74C' : '#E63B2E'}
          stroke="#111111"
          strokeWidth="1.5"
          className={interactiveClass}
          {...bindBtn('a')}
        />
        {/* A Glossy Specular Highlight Crescent */}
        <path
          d={
            aBtn
              ? 'M 117.4 26.1 A 4.0 4.0 0 0 1 122.2 24.4'
              : 'M 117.4 24.9 A 4.0 4.0 0 0 1 122.2 23.2'
          }
          fill="none"
          stroke={aBtn ? '#FFFFFF' : '#FFD6CE'}
          strokeWidth="1.3"
          strokeLinecap="round"
          pointerEvents="none"
        />

        {/* Crisp B / A Faceplate Legends */}
        <text
          x="103.5"
          y="41.4"
          fontSize="5.2"
          fontWeight="900"
          fontFamily="monospace"
          fill="#F25C4D"
          pointerEvents="none"
        >
          B
        </text>
        <text
          x="124.3"
          y="41.4"
          fontSize="5.2"
          fontWeight="900"
          fontFamily="monospace"
          fill="#F25C4D"
          pointerEvents="none"
        >
          A
        </text>
      </svg>
    </div>
  );
}

/**
 * Console-specific 144x58 3D Neo-Brutalist Live Mini Controller HUD for the CRT TV Chin Panel.
 * Automatically renders NES-004, SNES-005, Sega Genesis 3-Button, or Game Boy / GBA
 * with identical 144x58px dimensions (0.00px layout shift).
 */
function MiniConsoleController({
  consoleSystem = 'nes',
  visualInputMask,
  onPadInput,
}: {
  consoleSystem?: ConsoleSystemId;
  visualInputMask: number;
  onPadInput?: (button: string, pressed: boolean) => void;
}) {
  const bindBtn = useSvgButtonBinder(onPadInput);

  if (consoleSystem === 'nes') {
    return <MiniNesController visualInputMask={visualInputMask} onPadInput={onPadInput} />;
  }

  const up = (visualInputMask & NES_INPUT_UP) !== 0;
  const down = (visualInputMask & NES_INPUT_DOWN) !== 0;
  const left = (visualInputMask & NES_INPUT_LEFT) !== 0;
  const right = (visualInputMask & NES_INPUT_RIGHT) !== 0;
  const select = (visualInputMask & NES_INPUT_SELECT) !== 0;
  const start = (visualInputMask & NES_INPUT_START) !== 0;
  const bBtn = (visualInputMask & NES_INPUT_B) !== 0;
  const aBtn = (visualInputMask & NES_INPUT_A) !== 0;

  if (consoleSystem === 'snes') {
    return (
      <div
        role="img"
        aria-label="Live SNES Controller Input Display"
        title="Live SNES-005 Controller Inputs"
        className="w-[144px] h-[58px] shrink-0 select-none"
      >
        <svg viewBox="0 0 144 58" className="w-full h-full block">
          <rect x="4.5" y="5" width="138" height="51.5" rx="25" fill="#111111" />
          <rect
            x="1.5"
            y="1.5"
            width="138"
            height="51.5"
            rx="25"
            fill="#BDB7AC"
            stroke="#111111"
            strokeWidth="2.5"
          />
          <rect x="3" y="3" width="135" height="44" rx="22" fill="#DFDAD0" />
          <circle cx="28" cy="25" r="19" fill="#CCC6BA" stroke="#111111" strokeWidth="1.5" />
          <circle cx="113" cy="25" r="19" fill="#9E9990" stroke="#111111" strokeWidth="1.5" />

          {/* Unified SNES Cross D-Pad */}
          <path
            d="M 23.6 12.6 H 32.4 V 20.6 H 40.4 V 29.4 H 32.4 V 37.4 H 23.6 V 29.4 H 15.6 V 20.6 H 23.6 Z"
            fill="#282730"
            stroke="#111111"
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
          <rect x="24.4" y="13.4" width="7.2" height="7.2" fill={up ? '#FFE74C' : 'transparent'} {...bindBtn('up')} />
          <rect x="24.4" y="29.4" width="7.2" height="7.2" fill={down ? '#FFE74C' : 'transparent'} {...bindBtn('down')} />
          <rect x="16.4" y="21.4" width="7.2" height="7.2" fill={left ? '#FFE74C' : 'transparent'} {...bindBtn('left')} />
          <rect x="32.4" y="21.4" width="7.2" height="7.2" fill={right ? '#FFE74C' : 'transparent'} {...bindBtn('right')} />
          <circle cx="28" cy="25" r="2.2" fill="#18171E" pointerEvents="none" />

          {/* Diagonal Select / Start Pills */}
          <rect
            x="56"
            y="27"
            width="11.5"
            height="4.6"
            rx="2.3"
            transform="rotate(-24 61 29)"
            fill={select ? '#7FD1AE' : '#4E4C56'}
            stroke="#111111"
            strokeWidth="1.3"
            {...bindBtn('select')}
          />
          <rect
            x="72"
            y="27"
            width="11.5"
            height="4.6"
            rx="2.3"
            transform="rotate(-24 77 29)"
            fill={start ? '#7FD1AE' : '#4E4C56'}
            stroke="#111111"
            strokeWidth="1.3"
            {...bindBtn('start')}
          />

          {/* 4-Color Super Famicom Diamond */}
          <circle cx="113" cy="14" r="5" fill="#45B7D1" stroke="#111111" strokeWidth="1.5" {...bindBtn('a')} />
          <circle cx="102" cy="25" r="5" fill={bBtn ? '#FFE74C' : '#6BCB77'} stroke="#111111" strokeWidth="1.5" {...bindBtn('b')} />
          <circle cx="124" cy="25" r="5" fill={aBtn ? '#FFE74C' : '#E63B2E'} stroke="#111111" strokeWidth="1.5" {...bindBtn('a')} />
          <circle cx="113" cy="36" r="5" fill={bBtn ? '#FFFFFF' : '#F5C342'} stroke="#111111" strokeWidth="1.5" {...bindBtn('b')} />
        </svg>
      </div>
    );
  }

  if (consoleSystem === 'genesis') {
    return (
      <div
        role="img"
        aria-label="Live Sega Genesis Controller Input Display"
        title="Live Sega Genesis 3-Button Controller Inputs"
        className="w-[144px] h-[58px] shrink-0 select-none"
      >
        <svg viewBox="0 0 144 58" className="w-full h-full block">
          <rect x="4.5" y="5" width="138" height="51.5" rx="22" fill="#111111" />
          <rect
            x="1.5"
            y="1.5"
            width="138"
            height="51.5"
            rx="22"
            fill="#1D1C24"
            stroke="#111111"
            strokeWidth="2.5"
          />
          <rect x="3" y="3" width="135" height="44" rx="19" fill="#2A2934" />

          <circle cx="28" cy="25" r="17" fill="#373544" stroke="#111111" strokeWidth="1.6" />
          <path
            d="M 23.8 13.5 H 32.2 V 20.8 H 39.5 V 29.2 H 32.2 V 36.5 H 23.8 V 29.2 H 16.5 V 20.8 H 23.8 Z"
            fill="#191820"
            stroke="#111111"
            strokeWidth="1.4"
            strokeLinejoin="round"
          />
          <rect x="24.5" y="14.2" width="7" height="6.6" fill={up ? '#FFE74C' : 'transparent'} {...bindBtn('up')} />
          <rect x="24.5" y="29.2" width="7" height="6.6" fill={down ? '#FFE74C' : 'transparent'} {...bindBtn('down')} />
          <rect x="17.2" y="21.5" width="6.6" height="7" fill={left ? '#FFE74C' : 'transparent'} {...bindBtn('left')} />
          <rect x="32.2" y="21.5" width="6.6" height="7" fill={right ? '#FFE74C' : 'transparent'} {...bindBtn('right')} />

          <rect
            x="60"
            y="18"
            width="15"
            height="5.5"
            rx="2.7"
            fill={start ? '#FFE74C' : '#E03C31'}
            stroke="#111111"
            strokeWidth="1.4"
            {...bindBtn('start')}
          />

          <circle cx="93" cy="33" r="6" fill={bBtn ? '#FFE74C' : '#3C3A4A'} stroke="#111111" strokeWidth="1.6" {...bindBtn('b')} />
          <circle cx="109" cy="27" r="6" fill={aBtn ? '#FFE74C' : '#3C3A4A'} stroke="#111111" strokeWidth="1.6" {...bindBtn('a')} />
          <circle cx="125" cy="21" r="6" fill={aBtn ? '#7FD1AE' : '#3C3A4A'} stroke="#111111" strokeWidth="1.6" {...bindBtn('a')} />
          <text x="91.2" y="34.8" fontSize="5.4" fontWeight="900" fontFamily="monospace" fill={bBtn ? '#111111' : '#F25C4D'} pointerEvents="none">A</text>
          <text x="107.2" y="28.8" fontSize="5.4" fontWeight="900" fontFamily="monospace" fill={aBtn ? '#111111' : '#F25C4D'} pointerEvents="none">B</text>
          <text x="123.2" y="22.8" fontSize="5.4" fontWeight="900" fontFamily="monospace" fill={aBtn ? '#111111' : '#F25C4D'} pointerEvents="none">C</text>
        </svg>
      </div>
    );
  }

  const isGba = consoleSystem === 'gba';
  return (
    <div
      role="img"
      aria-label={`Live ${isGba ? 'Game Boy Advance' : 'Game Boy'} Input Display`}
      title={`Live ${isGba ? 'GBA' : 'Game Boy'} Inputs`}
      className="w-[144px] h-[58px] shrink-0 select-none"
    >
      <svg viewBox="0 0 144 58" className="w-full h-full block">
        <rect x="4.5" y="5" width="138" height="51.5" rx="12" fill="#111111" />
        <rect
          x="1.5"
          y="1.5"
          width="138"
          height="51.5"
          rx="12"
          fill={isGba ? '#4C4378' : '#B8B2A4'}
          stroke="#111111"
          strokeWidth="2.5"
        />
        <rect
          x="3"
          y="3"
          width="135"
          height="44"
          rx="9.5"
          fill={isGba ? '#675B9E' : '#DAD4C6'}
        />

        <path
          d="M 22.6 12.6 H 31.4 V 20.6 H 39.4 V 29.4 H 31.4 V 37.4 H 22.6 V 29.4 H 14.6 V 20.6 H 22.6 Z"
          fill="#24232C"
          stroke="#111111"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
        <rect x="23.4" y="13.4" width="7.2" height="7.2" fill={up ? '#FFE74C' : 'transparent'} {...bindBtn('up')} />
        <rect x="23.4" y="29.4" width="7.2" height="7.2" fill={down ? '#FFE74C' : 'transparent'} {...bindBtn('down')} />
        <rect x="15.4" y="21.4" width="7.2" height="7.2" fill={left ? '#FFE74C' : 'transparent'} {...bindBtn('left')} />
        <rect x="31.4" y="21.4" width="7.2" height="7.2" fill={right ? '#FFE74C' : 'transparent'} {...bindBtn('right')} />

        <rect
          x="55"
          y="29"
          width="11"
          height="4.4"
          rx="2.2"
          transform="rotate(-24 60 31)"
          fill={select ? '#7FD1AE' : isGba ? '#DFDAD0' : '#6A6760'}
          stroke="#111111"
          strokeWidth="1.3"
          {...bindBtn('select')}
        />
        <rect
          x="70"
          y="29"
          width="11"
          height="4.4"
          rx="2.2"
          transform="rotate(-24 75 31)"
          fill={start ? '#7FD1AE' : isGba ? '#DFDAD0' : '#6A6760'}
          stroke="#111111"
          strokeWidth="1.3"
          {...bindBtn('start')}
        />

        <circle
          cx="102"
          cy="29"
          r="6.2"
          fill={bBtn ? '#FFE74C' : isGba ? '#E5E0D5' : '#A6234F'}
          stroke="#111111"
          strokeWidth="1.6"
          {...bindBtn('b')}
        />
        <circle
          cx="121"
          cy="20"
          r="6.2"
          fill={aBtn ? '#FFE74C' : isGba ? '#E5E0D5' : '#A6234F'}
          stroke="#111111"
          strokeWidth="1.6"
          {...bindBtn('a')}
        />
      </svg>
    </div>
  );
}

interface TactileKeycapButtonProps {
  label: string;
  badge?: string;
  active?: boolean;
  rivalActive?: boolean;
  title?: string;
  className?: string;
  ariaLabel: string;
  onPressChange?: (pressed: boolean) => void;
  onClick?: () => void;
}

function TactileKeycapButton({
  label,
  badge,
  active = false,
  rivalActive = false,
  title,
  className = '',
  ariaLabel,
  onPressChange,
  onClick,
}: TactileKeycapButtonProps) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      title={title}
      onClick={onClick}
      onPointerDown={
        onPressChange
          ? (e) => {
              e.preventDefault();
              onPressChange(true);
            }
          : undefined
      }
      onPointerUp={onPressChange ? () => onPressChange(false) : undefined}
      onPointerCancel={onPressChange ? () => onPressChange(false) : undefined}
      onPointerLeave={onPressChange ? () => onPressChange(false) : undefined}
      className={`h-[29px] rounded-[7px] border-2 border-[#111111] font-black text-[11px] leading-none flex items-center justify-center gap-1.5 select-none cursor-pointer transition-all duration-75 ${
        active
          ? 'bg-[#FFE74C] text-[#111111] translate-y-[1.5px] shadow-[0_1px_0_#111111]'
          : rivalActive
            ? 'bg-[#E6F9FF] text-[#111111] ring-2 ring-[#4CC9F0] -translate-y-[0.5px] shadow-[0_3px_0_#111111]'
            : 'bg-[#FFFDF7] hover:bg-[#FFF8DF] text-[#111111] -translate-y-[0.5px] shadow-[0_3px_0_#111111] active:bg-[#FFE74C] active:translate-y-[1.5px] active:shadow-[0_1px_0_#111111]'
      } ${className}`}
    >
      <span>{label}</span>
      {badge && (
        <span className="w-[14px] h-[14px] rounded-full bg-[#E63B2E] text-white border border-[#111111] text-[8.5px] font-black flex items-center justify-center leading-none shrink-0">
          {badge}
        </span>
      )}
    </button>
  );
}

/**
 * Unified 590px Console Control Deck:
 * Harmonizes the live 144x58 3D Console Controller on the left with height-matched
 * 3D mechanical keycap modules on the right that physically depress and illuminate at 60Hz,
 * plus Stage 11 Rival Input-Diff glow and Stage 14 Practice Save-Pin controls.
 */
export function ConsoleControlDeck({
  consoleSystem = 'nes',
  visualInputMask,
  rivalInputMask = 0,
  isCelesteCourse = true,
  gamepadConnected = false,
  gamepadBrand = null,
  gamepadLabel = null,
  practicePinActive = false,
  onPadInput,
  onRetry,
  onDropPracticePin,
  onWarpPracticePin,
}: {
  consoleSystem?: ConsoleSystemId;
  visualInputMask: number;
  rivalInputMask?: number;
  isCelesteCourse?: boolean;
  gamepadConnected?: boolean;
  gamepadBrand?: string | null;
  gamepadLabel?: string | null;
  practicePinActive?: boolean;
  onPadInput?: (button: string, pressed: boolean) => void;
  onRetry?: () => void;
  onDropPracticePin?: () => void;
  onWarpPracticePin?: () => void;
}) {
  const up = (visualInputMask & NES_INPUT_UP) !== 0;
  const left = (visualInputMask & NES_INPUT_LEFT) !== 0;
  const right = (visualInputMask & NES_INPUT_RIGHT) !== 0;
  const bBtn = (visualInputMask & NES_INPUT_B) !== 0;
  const aBtn = (visualInputMask & NES_INPUT_A) !== 0;

  const rivalUp = (rivalInputMask & NES_INPUT_UP) !== 0;
  const rivalLeft = (rivalInputMask & NES_INPUT_LEFT) !== 0;
  const rivalRight = (rivalInputMask & NES_INPUT_RIGHT) !== 0;
  const rivalB = (rivalInputMask & NES_INPUT_B) !== 0;
  const rivalA = (rivalInputMask & NES_INPUT_A) !== 0;

  return (
    <section
      aria-label="Controller and Keyboard Controls Deck"
      className="hidden sm:flex w-full mt-[12px] bg-[#EFE6CE] border-[3.5px] border-[#111111] rounded-2xl px-3 lg:px-4 py-2 shadow-[inset_0_2px_0_#FFFDF7,inset_0_-4px_0_#D8CEB4,4px_5px_0px_#111111] items-center justify-between gap-2.5 lg:gap-3.5"
    >
      {/* Left Dock: Live 60Hz 3D Console Controller */}
      <div className="relative shrink-0">
        <MiniConsoleController
          consoleSystem={consoleSystem}
          visualInputMask={visualInputMask}
          onPadInput={onPadInput}
        />
        {gamepadConnected && (
          <span
            aria-label="Hardware Controller Connected"
            title={
              gamepadLabel
                ? `${gamepadLabel} Connected — Stick/D-Pad: Move • A: Jump • X/B: Dash • LB/RB: Switch Segment • Select: Retry`
                : 'USB / Bluetooth Gamepad Connected'
            }
            className="absolute -top-1.5 -right-1.5 bg-[#7FD1AE] border-[1.5px] border-[#111111] rounded-full px-1.5 py-0.5 text-[8px] font-black uppercase leading-none shadow-[1px_1px_0_#111111] flex items-center gap-1 whitespace-nowrap"
          >
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-[#111111] animate-pulse" />
            <span>{gamepadBrand || 'PAD'}</span>
          </span>
        )}
      </div>

      {/* Recessed Console Deck Seam */}
      <div aria-hidden="true" className="w-[2px] h-11 bg-[#111111]/15 rounded-full shrink-0" />

      {/* Right Zone: Live-Reactive 3D Mechanical Keycap Modules + Practice Pin */}
      <div className="flex-1 min-w-0 flex items-center justify-around gap-1.5 lg:gap-2">
        {/* 1. RUN / MOVE (Left & Right Arrows) */}
        <div className="flex flex-col items-center gap-1.5">
          <div className="flex items-center gap-1">
            <TactileKeycapButton
              label="←"
              active={left}
              rivalActive={rivalLeft}
              ariaLabel="Move Left (Left Arrow)"
              className="w-[28px]"
              onPressChange={onPadInput ? (p) => onPadInput('left', p) : undefined}
            />
            <TactileKeycapButton
              label="→"
              active={right}
              rivalActive={rivalRight}
              ariaLabel="Move Right (Right Arrow)"
              className="w-[28px]"
              onPressChange={onPadInput ? (p) => onPadInput('right', p) : undefined}
            />
          </div>
          <span className="text-[10px] font-black uppercase tracking-tight text-[#111111]/85 leading-none">
            {isCelesteCourse ? 'RUN' : 'MOVE'}
          </span>
        </div>

        {/* 2. CLIMB / UP (Up Arrow) */}
        <div className="flex flex-col items-center gap-1.5">
          <TactileKeycapButton
            label="↑"
            active={up}
            rivalActive={rivalUp}
            ariaLabel={isCelesteCourse ? 'Climb Wall (Up Arrow)' : 'D-Pad Up (Up Arrow)'}
            className="w-[31px]"
            onPressChange={onPadInput ? (p) => onPadInput('up', p) : undefined}
          />
          <span className="text-[10px] font-black uppercase tracking-tight text-[#111111]/85 leading-none">
            {isCelesteCourse ? 'CLIMB' : 'UP'}
          </span>
        </div>

        {/* 3. DASH / B ACTION (Z Key -> NES B) */}
        <div className="flex flex-col items-center gap-1.5">
          <TactileKeycapButton
            label="Z"
            badge="B"
            active={bBtn}
            rivalActive={rivalB}
            ariaLabel={isCelesteCourse ? 'Air-Dash (Z or B Button)' : 'Action B (Z Key)'}
            className="px-2 min-w-[48px]"
            onPressChange={onPadInput ? (p) => onPadInput('b', p) : undefined}
          />
          <span className="text-[10px] font-black uppercase tracking-tight text-[#111111]/85 leading-none">
            {isCelesteCourse ? 'DASH' : 'ACTION'}
          </span>
        </div>

        {/* 4. JUMP / A ACTION (Spacebar -> NES A) */}
        <div className="flex flex-col items-center gap-1.5">
          <TactileKeycapButton
            label="SPACE"
            badge="A"
            active={aBtn}
            rivalActive={rivalA}
            ariaLabel="Jump (Spacebar or A Button)"
            className="px-2.5 min-w-[72px] lg:min-w-[80px]"
            onPressChange={onPadInput ? (p) => onPadInput('a', p) : undefined}
          />
          <span className="text-[10px] font-black uppercase tracking-tight text-[#111111]/85 leading-none">
            JUMP
          </span>
        </div>

        {/* 5. RETRY (R Key) */}
        <div className="flex flex-col items-center gap-1.5">
          <TactileKeycapButton
            label="R"
            ariaLabel="Instant Retry (R Key)"
            className="w-[31px]"
            onClick={onRetry}
          />
          <span className="text-[10px] font-black uppercase tracking-tight text-[#111111]/85 leading-none">
            RETRY
          </span>
        </div>

        {/* 6. STAGE 14 PRACTICE PIN (P / O Keys) */}
        {onDropPracticePin && (
          <div className="flex flex-col items-center gap-1.5">
            <TactileKeycapButton
              label={practicePinActive ? '📍O' : 'P'}
              active={practicePinActive}
              ariaLabel={
                practicePinActive
                  ? 'Warp to Practice Save-Pin (O Key)'
                  : 'Drop Practice Save-Pin (P Key)'
              }
              title={
                practicePinActive
                  ? 'Practice Pin Active — Click or press [O] to warp to pin, or [P] to move pin'
                  : 'Press [P] anywhere mid-room to drop a Practice Save-Pin & [O] to warp back'
              }
              className="px-1.5 min-w-[33px]"
              onClick={practicePinActive && onWarpPracticePin ? onWarpPracticePin : onDropPracticePin}
            />
            <span className="text-[10px] font-black uppercase tracking-tight text-[#111111]/85 leading-none">
              {practicePinActive ? 'WARP' : 'PIN'}
            </span>
          </div>
        )}
      </div>
    </section>
  );
}

/**
 * Mobile Multi-Touch Thumb-Slide & Chord Pad (< 640px):
 * - Left rocker pad supports continuous 8-way thumb sliding (including diagonal ↖ / ↗ air-dash directions).
 * - Right action pad supports simultaneous multi-touch OR single-thumb roll chording across DASH (B) + JUMP (A).
 */
export function MobileThumbChordControls({
  visualInputMask,
  isCelesteCourse = true,
  onPadInput,
}: {
  visualInputMask: number;
  isCelesteCourse?: boolean;
  onPadInput: (button: string, pressed: boolean) => void;
}) {
  const dpadPointersRef = React.useRef<Map<number, string[]>>(new Map());
  const dpadActiveSetRef = React.useRef<Set<string>>(new Set());
  const actionPointersRef = React.useRef<Map<number, string[]>>(new Map());
  const actionActiveSetRef = React.useRef<Set<string>>(new Set());

  const syncButtonGroup = (
    pointersMap: Map<number, string[]>,
    activeSet: Set<string>,
    candidates: readonly string[]
  ) => {
    const desired = new Set<string>();
    for (const list of pointersMap.values()) {
      for (const b of list) desired.add(b);
    }
    for (const btn of candidates) {
      const hasNow = desired.has(btn);
      const hadBefore = activeSet.has(btn);
      if (hasNow && !hadBefore) {
        activeSet.add(btn);
        onPadInput(btn, true);
      } else if (!hasNow && hadBefore) {
        activeSet.delete(btn);
        onPadInput(btn, false);
      }
    }
  };

  const resolveDpadDirections = (el: HTMLElement, clientX: number, clientY: number): string[] => {
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return [];
    const nx = (clientX - rect.left) / rect.width;
    const ny = (clientY - rect.top) / rect.height;
    const dirs: string[] = [];
    if (nx < 0.37) dirs.push('left');
    else if (nx > 0.63) dirs.push('right');
    if (ny < 0.44) dirs.push('up');
    else if (ny > 0.78) dirs.push('down');
    return dirs;
  };

  const resolveActionButtons = (el: HTMLElement, clientX: number): string[] => {
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0) return [];
    const nx = (clientX - rect.left) / rect.width;
    if (nx < 0.43) return ['b'];
    if (nx > 0.57) return ['a'];
    return ['b', 'a'];
  };

  const up = (visualInputMask & NES_INPUT_UP) !== 0;
  const down = (visualInputMask & NES_INPUT_DOWN) !== 0;
  const left = (visualInputMask & NES_INPUT_LEFT) !== 0;
  const right = (visualInputMask & NES_INPUT_RIGHT) !== 0;
  const select = (visualInputMask & NES_INPUT_SELECT) !== 0;
  const start = (visualInputMask & NES_INPUT_START) !== 0;
  const bBtn = (visualInputMask & NES_INPUT_B) !== 0;
  const aBtn = (visualInputMask & NES_INPUT_A) !== 0;

  return (
    <div
      aria-label="Mobile Multi-Touch Thumb Controls"
      className="mt-2.5 flex sm:hidden items-center justify-between gap-2 w-full select-none"
    >
      {/* Left 8-Way Thumb-Slide Rocker Pad */}
      <div
        role="group"
        aria-label="8-Way Thumb-Slide D-Pad"
        onPointerDown={(e) => {
          e.preventDefault();
          try {
            e.currentTarget.setPointerCapture(e.pointerId);
          } catch {
            // ignore synthetic events without capture support
          }
          dpadPointersRef.current.set(
            e.pointerId,
            resolveDpadDirections(e.currentTarget, e.clientX, e.clientY)
          );
          syncButtonGroup(dpadPointersRef.current, dpadActiveSetRef.current, [
            'left',
            'right',
            'up',
            'down',
          ]);
        }}
        onPointerMove={(e) => {
          if (!dpadPointersRef.current.has(e.pointerId)) return;
          e.preventDefault();
          dpadPointersRef.current.set(
            e.pointerId,
            resolveDpadDirections(e.currentTarget, e.clientX, e.clientY)
          );
          syncButtonGroup(dpadPointersRef.current, dpadActiveSetRef.current, [
            'left',
            'right',
            'up',
            'down',
          ]);
        }}
        onPointerUp={(e) => {
          if (!dpadPointersRef.current.has(e.pointerId)) return;
          dpadPointersRef.current.delete(e.pointerId);
          syncButtonGroup(dpadPointersRef.current, dpadActiveSetRef.current, [
            'left',
            'right',
            'up',
            'down',
          ]);
        }}
        onPointerCancel={(e) => {
          if (!dpadPointersRef.current.has(e.pointerId)) return;
          dpadPointersRef.current.delete(e.pointerId);
          syncButtonGroup(dpadPointersRef.current, dpadActiveSetRef.current, [
            'left',
            'right',
            'up',
            'down',
          ]);
        }}
        className="touch-none h-[46px] flex-1 max-w-[182px] rounded-xl border-[2.5px] border-[#111111] bg-[#EFE6CE] shadow-[0_3px_0_#111111] grid grid-cols-3 grid-rows-2 overflow-hidden text-[9.5px] font-black uppercase"
      >
        <div
          className={`flex items-center justify-center border-r border-b border-[#111111]/20 ${
            left && up ? 'bg-[#FFE74C]' : 'bg-[#FFF9E6]/80'
          }`}
        >
          ↖
        </div>
        <div
          className={`flex items-center justify-center border-r border-b border-[#111111]/20 ${
            up && !left && !right ? 'bg-[#FFE74C]' : 'bg-[#FFF9E6]'
          }`}
        >
          ▲ UP
        </div>
        <div
          className={`flex items-center justify-center border-b border-[#111111]/20 ${
            right && up ? 'bg-[#FFE74C]' : 'bg-[#7FD1AE]/55'
          }`}
        >
          ↗
        </div>
        <div
          className={`flex items-center justify-center border-r border-[#111111]/20 ${
            left && !up ? 'bg-[#FFE74C]' : 'bg-[#FFF9E6]'
          }`}
        >
          ◀ LEFT
        </div>
        <div
          className={`flex items-center justify-center border-r border-[#111111]/20 text-[8.5px] ${
            down ? 'bg-[#FFE74C]' : 'bg-[#EFE6CE]'
          }`}
        >
          ▼
        </div>
        <div
          className={`flex items-center justify-center ${
            right && !up ? 'bg-[#FFE74C]' : 'bg-[#7FD1AE]'
          }`}
        >
          RUN ▶
        </div>
      </div>

      {/* Compact Mobile SELECT / START Menu Stack for Custom Dropped ROMs (0px extra vertical height) */}
      {!isCelesteCourse && (
        <div
          role="group"
          aria-label="Mobile Select and Start Controls"
          className="h-[46px] flex flex-col justify-between shrink-0"
        >
          <button
            type="button"
            aria-label="Start Button"
            onPointerDown={(e) => {
              e.preventDefault();
              onPadInput('start', true);
            }}
            onPointerUp={() => onPadInput('start', false)}
            onPointerCancel={() => onPadInput('start', false)}
            onPointerLeave={() => onPadInput('start', false)}
            className={`touch-none h-[21px] px-2 rounded-md border-[2px] border-[#111111] shadow-[0_2px_0_#111111] text-[8px] font-black uppercase leading-none flex items-center justify-center ${
              start ? 'bg-[#7FD1AE] text-[#111111]' : 'bg-[#2B2A32] text-[#FFFDF7]'
            }`}
          >
            START
          </button>
          <button
            type="button"
            aria-label="Select Button"
            onPointerDown={(e) => {
              e.preventDefault();
              onPadInput('select', true);
            }}
            onPointerUp={() => onPadInput('select', false)}
            onPointerCancel={() => onPadInput('select', false)}
            onPointerLeave={() => onPadInput('select', false)}
            className={`touch-none h-[21px] px-2 rounded-md border-[2px] border-[#111111] shadow-[0_2px_0_#111111] text-[8px] font-black uppercase leading-none flex items-center justify-center ${
              select ? 'bg-[#7FD1AE] text-[#111111]' : 'bg-[#EFE6CE] text-[#111111]'
            }`}
          >
            SEL
          </button>
        </div>
      )}

      {/* Right Multi-Touch / Thumb-Chord DASH (B) + JUMP (A) Pad */}
      <div
        role="group"
        aria-label="Dash and Jump Chord Pad"
        onPointerDown={(e) => {
          e.preventDefault();
          try {
            e.currentTarget.setPointerCapture(e.pointerId);
          } catch {
            // ignore
          }
          actionPointersRef.current.set(
            e.pointerId,
            resolveActionButtons(e.currentTarget, e.clientX)
          );
          syncButtonGroup(actionPointersRef.current, actionActiveSetRef.current, ['b', 'a']);
        }}
        onPointerMove={(e) => {
          if (!actionPointersRef.current.has(e.pointerId)) return;
          e.preventDefault();
          actionPointersRef.current.set(
            e.pointerId,
            resolveActionButtons(e.currentTarget, e.clientX)
          );
          syncButtonGroup(actionPointersRef.current, actionActiveSetRef.current, ['b', 'a']);
        }}
        onPointerUp={(e) => {
          if (!actionPointersRef.current.has(e.pointerId)) return;
          actionPointersRef.current.delete(e.pointerId);
          syncButtonGroup(actionPointersRef.current, actionActiveSetRef.current, ['b', 'a']);
        }}
        onPointerCancel={(e) => {
          if (!actionPointersRef.current.has(e.pointerId)) return;
          actionPointersRef.current.delete(e.pointerId);
          syncButtonGroup(actionPointersRef.current, actionActiveSetRef.current, ['b', 'a']);
        }}
        className="touch-none h-[46px] flex-1 max-w-[172px] rounded-xl border-[2.5px] border-[#111111] shadow-[0_3px_0_#111111] grid grid-cols-[1fr_24px_1fr] overflow-hidden text-[10px] font-black uppercase"
      >
        <div
          className={`flex items-center justify-center transition-colors ${
            bBtn ? 'bg-[#FFE74C] text-[#111111]' : 'bg-[#EC6553] text-white'
          }`}
        >
          DASH ●
        </div>
        <div
          title="Slide or tap center seam to chord Dash + Jump"
          className={`flex items-center justify-center border-x border-[#111111]/35 text-[8.5px] ${
            bBtn && aBtn ? 'bg-[#7FD1AE] text-[#111111]' : 'bg-[#25242B] text-[#FFE74C]'
          }`}
        >
          B+A
        </div>
        <div
          className={`flex items-center justify-center transition-colors ${
            aBtn ? 'bg-[#FFE74C] text-[#111111]' : 'bg-[#F5C342] text-[#111111]'
          }`}
        >
          JUMP ▲
        </div>
      </div>
    </div>
  );
}
