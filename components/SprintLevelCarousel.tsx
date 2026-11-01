'use client';

import React, { useMemo, useState, useSyncExternalStore } from 'react';
import { CELESTE_CHAMPION_REPLAYS } from '@/lib/celesteDemoReplays';
import {
  CELESTE_SPRINT_COURSES,
  DailySprintChallenge,
  getDailySprintForDate,
  getLocalDailyPbMs,
  getLocalSprintPbMs,
} from '@/lib/dailySprints';
import { findBuiltinCartridgeByRomId } from '@/lib/homebrewCatalog';
import { CELESTE_ROM_ID } from '@/lib/romProfiles';
import { CustomRomSegment, RomProfile } from '@/lib/types';

export type SegmentCreatorStep = 'idle' | 'mark-start' | 'mark-finish';

export interface CelesteCarouselSlot {
  id: string;
  kind: 'daily' | 'course' | 'custom';
  sprintId: string;
  courseSprintId: string;
  courseIndex: number;
  dailyNumber?: number;
  dailyBadgeText?: string;
  code: string;
  shortName: string;
  fullTitle: string;
  badgeBg: string;
  previewSrc: string;
  defaultTopMs: number;
  customSegment?: CustomRomSegment;
}

const COURSE_PREVIEW_BY_INDEX: Readonly<Record<number, string>> = {
  0: '/previews/celeste-1a.png',
  1: '/previews/celeste-1b.png',
  2: '/previews/celeste-1c.png',
  3: '/previews/celeste-2a.png',
  4: '/previews/celeste-2b.png',
  5: '/previews/celeste-01.png',
};

const CUSTOM_FALLBACK_PREVIEW_SVG =
  "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='64' height='60' viewBox='0 0 64 60'><rect width='64' height='60' fill='%23181722'/><rect x='6' y='44' width='52' height='10' fill='%237FD1AE'/><rect x='14' y='30' width='10' height='14' fill='%23FFE74C'/><rect x='42' y='20' width='4' height='24' fill='%23EC6553'/><rect x='46' y='20' width='10' height='8' fill='%23FFFDF7'/></svg>";

function getCourseBadgeBg(worldIndex: number): string {
  if (worldIndex === 2) return '#E2A4FF';
  if (worldIndex === 0) return '#FFE74C';
  return '#7DD3FC';
}

export function buildCelesteCarouselSlots(
  todayDaily: DailySprintChallenge = getDailySprintForDate()
): CelesteCarouselSlot[] {
  return CELESTE_SPRINT_COURSES.map((course) => {
    const courseSprintId =
      course.courseIndex === 0 ? CELESTE_ROM_ID : `${CELESTE_ROM_ID}:c${course.courseIndex}`;
    const isTodayDaily =
      todayDaily.romId === CELESTE_ROM_ID && course.courseIndex === todayDaily.course.courseIndex;
    const defaultTopMs = CELESTE_CHAMPION_REPLAYS[course.courseIndex]?.timeMs ?? 18000;

    return {
      id: `segment-${course.courseIndex}`,
      kind: isTodayDaily ? 'daily' : 'course',
      sprintId: isTodayDaily ? todayDaily.sprintId : courseSprintId,
      courseSprintId,
      courseIndex: course.courseIndex,
      dailyNumber: isTodayDaily ? todayDaily.dailyNumber : undefined,
      dailyBadgeText: isTodayDaily ? todayDaily.badgeText : undefined,
      code: course.code,
      shortName: course.name,
      fullTitle: isTodayDaily
        ? `Today's Daily ${todayDaily.badgeText} • Celeste ${course.code} (${course.name})`
        : `Celeste ${course.code} • ${course.name}`,
      badgeBg: getCourseBadgeBg(course.worldIndex),
      previewSrc: COURSE_PREVIEW_BY_INDEX[course.courseIndex] ?? '/previews/celeste-1a.png',
      defaultTopMs,
    };
  });
}

export function buildCartridgeCarouselSlots(
  activeProfile: Pick<RomProfile, 'romId' | 'title' | 'sprintId' | 'startWorldX' | 'goalWorldX'>,
  customSegments: readonly CustomRomSegment[] = [],
  todayDaily: DailySprintChallenge = getDailySprintForDate()
): CelesteCarouselSlot[] {
  if (activeProfile.romId === CELESTE_ROM_ID) {
    return buildCelesteCarouselSlots(todayDaily);
  }

  // Custom BYO Vault ROM: render user-created segments (or default base sprint if none saved yet)
  if (customSegments.length > 0) {
    const customBadges = ['#7FD1AE', '#FFE74C', '#7DD3FC', '#E2A4FF', '#FFAD87'];
    return customSegments.map((seg, idx) => ({
      id: seg.id,
      kind: 'custom',
      sprintId: seg.sprintId,
      courseSprintId: seg.sprintId,
      courseIndex: idx,
      code: seg.code,
      shortName: seg.name,
      fullTitle: `${activeProfile.title} • ${seg.code} ${seg.name}`,
      badgeBg: customBadges[idx % customBadges.length],
      previewSrc: seg.previewDataUrl || CUSTOM_FALLBACK_PREVIEW_SVG,
      defaultTopMs: 14800,
      customSegment: seg,
    }));
  }

  return [
    {
      id: `custom-base-${activeProfile.romId}`,
      kind: 'custom',
      sprintId: activeProfile.sprintId || activeProfile.romId,
      courseSprintId: activeProfile.sprintId || activeProfile.romId,
      courseIndex: 0,
      code: 'S1',
      shortName: 'OPEN SPRINT',
      fullTitle: `${activeProfile.title} • Open Sprint`,
      badgeBg: '#7FD1AE',
      previewSrc: CUSTOM_FALLBACK_PREVIEW_SVG,
      defaultTopMs: 14800,
    },
  ];
}

export function findActiveCelesteSlotIndex(
  slots: readonly CelesteCarouselSlot[],
  activeProfile: Pick<RomProfile, 'sprintId' | 'courseIndex'>
): number {
  const sprintMatch = slots.findIndex(
    (s) => s.sprintId === activeProfile.sprintId || s.courseSprintId === activeProfile.sprintId
  );
  if (sprintMatch >= 0) return sprintMatch;
  const cIdx = activeProfile.courseIndex ?? 0;
  const courseMatch = slots.findIndex((s) => s.courseIndex === cIdx);
  return courseMatch >= 0 ? courseMatch : 0;
}

function subscribeLocalPbStorage(onStoreChange: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  window.addEventListener('storage', onStoreChange);
  return () => window.removeEventListener('storage', onStoreChange);
}

interface SprintLevelCarouselProps {
  activeProfile: RomProfile;
  isAttractMode: boolean;
  topTimesBySprintId: Readonly<Record<string, number>>;
  pbRevision: number;
  customSegments?: readonly CustomRomSegment[];
  segmentCreatorStep?: SegmentCreatorStep;
  segmentDraftDistancePx?: number;
  layout?: 'vertical' | 'horizontal';
  onSelectDaily: () => void;
  onSelectCourse: (courseIndex: number) => void;
  onSelectCustomSegment?: (segment: CustomRomSegment | null) => void;
  onDeleteCustomSegment?: (segment: CustomRomSegment) => void;
  onStartSegmentCreator?: () => void;
  onConfirmSegmentStart?: () => void;
  onConfirmSegmentFinish?: () => void;
  onCancelSegmentCreator?: () => void;
  onStepLevel: (direction: -1 | 1) => void;
}

export default function SprintLevelCarousel({
  activeProfile,
  isAttractMode,
  topTimesBySprintId,
  pbRevision,
  customSegments = [],
  segmentCreatorStep = 'idle',
  segmentDraftDistancePx = 0,
  layout = 'vertical',
  onSelectDaily,
  onSelectCourse,
  onSelectCustomSegment,
  onDeleteCustomSegment,
  onStartSegmentCreator,
  onConfirmSegmentStart,
  onConfirmSegmentFinish,
  onCancelSegmentCreator,
  onStepLevel,
}: SprintLevelCarouselProps) {
  const [hoveredSlotId, setHoveredSlotId] = useState<string | null>(null);
  const isBuiltin = Boolean(findBuiltinCartridgeByRomId(activeProfile.romId));

  const slots = useMemo(
    () => buildCartridgeCarouselSlots(activeProfile, customSegments, getDailySprintForDate()),
    [activeProfile, customSegments]
  );
  const activeIdx = findActiveCelesteSlotIndex(slots, activeProfile);
  const activeSlot = slots[activeIdx] ?? slots[0];

  // Hydration-safe subscription to localStorage Personal Bests + in-tab pbRevision updates
  const pbStorageSnapshot = useSyncExternalStore(
    subscribeLocalPbStorage,
    () => {
      try {
        const d = localStorage.getItem('bitgeist_daily_pb_celeste_v1') || '';
        const s = localStorage.getItem('bitgeist_sprint_pb_v1') || '';
        return `${pbRevision}|${d}|${s}`;
      } catch {
        return String(pbRevision);
      }
    },
    () => ''
  );

  const canReadLocalPb = pbStorageSnapshot.length > 0;

  const getSlotStats = (slot: CelesteCarouselSlot) => {
    const liveDailyTop = topTimesBySprintId[slot.sprintId];
    const liveCourseTop = topTimesBySprintId[slot.courseSprintId];
    const bestLiveTop =
      typeof liveDailyTop === 'number' && liveDailyTop >= 1000
        ? liveDailyTop
        : typeof liveCourseTop === 'number' && liveCourseTop >= 1000
          ? liveCourseTop
          : undefined;

    const topMs =
      typeof bestLiveTop === 'number'
        ? slot.kind === 'custom'
          ? bestLiveTop
          : Math.min(bestLiveTop, slot.defaultTopMs)
        : slot.defaultTopMs;

    let pbMs: number | null = null;
    if (canReadLocalPb) {
      const dailyPb =
        slot.kind === 'daily' && typeof slot.dailyNumber === 'number'
          ? getLocalDailyPbMs(slot.dailyNumber)
          : null;
      const coursePb = getLocalSprintPbMs(slot.courseSprintId);
      const sprintPb = getLocalSprintPbMs(slot.sprintId);
      const bestSprintPb =
        coursePb !== null && sprintPb !== null
          ? Math.min(coursePb, sprintPb)
          : (coursePb ?? sprintPb);
      if (dailyPb !== null && bestSprintPb !== null) {
        pbMs = Math.min(dailyPb, bestSprintPb);
      } else {
        pbMs = dailyPb ?? bestSprintPb;
      }
    }
    const beatTop = pbMs !== null && pbMs <= topMs;
    return { topMs, pbMs, beatTop };
  };

  const hoveredSlot = hoveredSlotId ? slots.find((s) => s.id === hoveredSlotId) ?? null : null;
  const displaySlot = hoveredSlot ?? activeSlot;
  const isDisplayingActive = displaySlot.id === activeSlot.id;
  const displayStats = getSlotStats(displaySlot);

  const handleSelectSlot = (slot: CelesteCarouselSlot, isActive: boolean) => {
    if (slot.kind === 'custom') {
      if (slot.customSegment && onSelectCustomSegment) {
        onSelectCustomSegment(slot.customSegment);
      } else if (!slot.customSegment && onSelectCustomSegment) {
        onSelectCustomSegment(null);
      }
      return;
    }
    if (isActive) {
      if (
        slot.kind === 'daily' &&
        typeof slot.dailyNumber === 'number' &&
        activeProfile.dailyNumber !== slot.dailyNumber
      ) {
        onSelectDaily();
      }
      return;
    }
    if (slot.kind === 'daily') {
      onSelectDaily();
    } else {
      onSelectCourse(slot.courseIndex);
    }
  };

  const showCreatorSlot =
    !isBuiltin &&
    Boolean(onStartSegmentCreator) &&
    (customSegments.length < 5 || segmentCreatorStep !== 'idle');
  const totalVerticalRows = Math.max(1, slots.length + (showCreatorSlot ? 1 : 0));

  const renderCreatorCardVertical = () => {
    if (!showCreatorSlot) return null;
    if (segmentCreatorStep === 'mark-start') {
      return (
        <div className="h-full min-h-0 w-full rounded-xl border-2 border-[#111111] bg-[#FFE74C] shadow-[2.5px_2.5px_0px_#111111] px-1.5 py-1 flex items-center justify-between gap-1">
          <button
            type="button"
            onClick={onConfirmSegmentStart}
            className="flex-1 min-w-0 text-left cursor-pointer focus:outline-none"
          >
            <div className="text-[8.5px] font-black uppercase leading-none text-[#111111]">
              📍 [1] SET START HERE
            </div>
            <div className="text-[7.5px] font-bold uppercase text-[#111111]/75 truncate mt-0.5 leading-none">
              Play to spot &amp; click
            </div>
          </button>
          {onCancelSegmentCreator && (
            <button
              type="button"
              onClick={onCancelSegmentCreator}
              aria-label="Cancel Segment Creator"
              className="w-5 h-5 rounded border border-[#111111] bg-white hover:bg-[#EC6553] hover:text-white text-[9px] font-black flex items-center justify-center cursor-pointer shrink-0"
            >
              ✕
            </button>
          )}
        </div>
      );
    }
    if (segmentCreatorStep === 'mark-finish') {
      const distLabel = Math.max(240, Math.round(segmentDraftDistancePx));
      return (
        <div className="h-full min-h-0 w-full rounded-xl border-2 border-[#111111] bg-[#7FD1AE] shadow-[2.5px_2.5px_0px_#111111] px-1.5 py-1 flex items-center justify-between gap-1">
          <button
            type="button"
            onClick={onConfirmSegmentFinish}
            className="flex-1 min-w-0 text-left cursor-pointer focus:outline-none"
          >
            <div className="text-[8.5px] font-black uppercase leading-none text-[#111111]">
              🏁 [2] SET FINISH HERE
            </div>
            <div className="text-[7.5px] font-bold uppercase text-[#111111]/80 truncate mt-0.5 leading-none">
              +{distLabel}PX • Save segment
            </div>
          </button>
          {onCancelSegmentCreator && (
            <button
              type="button"
              onClick={onCancelSegmentCreator}
              aria-label="Cancel Segment Creator"
              className="w-5 h-5 rounded border border-[#111111] bg-white hover:bg-[#EC6553] hover:text-white text-[9px] font-black flex items-center justify-center cursor-pointer shrink-0"
            >
              ✕
            </button>
          )}
        </div>
      );
    }

    return (
      <button
        type="button"
        onClick={onStartSegmentCreator}
        className="h-full min-h-0 w-full rounded-xl border-2 border-dashed border-[#111111] bg-[#FFFDF7] hover:bg-[#FFE74C] px-2 py-1 flex items-center justify-center gap-1.5 text-center cursor-pointer select-none transition-colors"
      >
        <span className="text-[11px] leading-none">✂️</span>
        <div className="min-w-0 text-left">
          <div className="text-[8.5px] font-black uppercase leading-none text-[#111111]">
            + NEW SEGMENT
          </div>
          <div className="text-[7.5px] font-bold uppercase text-[#111111]/70 truncate mt-0.5 leading-none">
            Mark Start → Finish
          </div>
        </div>
      </button>
    );
  };

  if (layout === 'vertical') {
    return (
      <nav
        aria-label="Speedrun Segment Selector"
        onMouseLeave={() => setHoveredSlotId(null)}
        className="w-full max-h-full bg-[#EFE6CE] border-[3px] border-[#111111] rounded-2xl p-2 shadow-[inset_0_2px_0_#FFFDF7,inset_0_-3px_0_#D8CEB4,4px_5px_0px_#111111] flex flex-col gap-1.5"
      >
        {/* Top Rack Header: Clear Purpose + Tactile ◀ / ▶ Stepper Buttons */}
        <div className="shrink-0 h-[23px] flex items-center justify-between gap-1.5 pb-1 border-b-2 border-[#111111]/15">
          <span className="text-[9px] font-black uppercase tracking-wider text-[#111111]/85 leading-none whitespace-nowrap">
            PICK A SEGMENT
          </span>
          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={() => onStepLevel(-1)}
              aria-label="Previous Level"
              title="Previous Segment (Shortcut: [ or Controller LB)"
              className="w-[20px] h-[17px] rounded-[4px] border-[1.5px] border-[#111111] bg-[#FFFDF7] hover:bg-[#FFE74C] text-[#111111] font-black text-[8px] flex items-center justify-center cursor-pointer select-none shadow-[0_1.5px_0_#111111] active:translate-y-[1px] active:shadow-none transition-all duration-75"
            >
              ◀
            </button>
            <button
              type="button"
              onClick={() => onStepLevel(1)}
              aria-label="Next Level"
              title="Next Segment (Shortcut: ] or Controller RB)"
              className="w-[20px] h-[17px] rounded-[4px] border-[1.5px] border-[#111111] bg-[#FFFDF7] hover:bg-[#FFE74C] text-[#111111] font-black text-[8px] flex items-center justify-center cursor-pointer select-none shadow-[0_1.5px_0_#111111] active:translate-y-[1px] active:shadow-none transition-all duration-75"
            >
              ▶
            </button>
          </div>
        </div>

        {/* Compact Segment Cards With Crisp Pixel-Art Preview Squares + Room Details */}
        <div
          className="flex-1 min-h-0 grid gap-1"
          style={{ gridTemplateRows: `repeat(${totalVerticalRows}, minmax(0, 51px))` }}
        >
          {slots.map((slot, idx) => {
            const isActive = idx === activeIdx;
            const { topMs, pbMs, beatTop } = getSlotStats(slot);

            return (
              <div key={slot.id} className="relative h-full min-h-0 w-full group">
                <button
                  type="button"
                  aria-current={isActive ? 'true' : undefined}
                  aria-label={`Select ${slot.fullTitle} (#1 Time ${(topMs / 1000).toFixed(2)}s)`}
                  title={`${slot.fullTitle} — #1 Time: ${(topMs / 1000).toFixed(2)}s${
                    pbMs !== null ? ` • Your PB: ${(pbMs / 1000).toFixed(2)}s` : ''
                  }`}
                  onMouseEnter={() => setHoveredSlotId(slot.id)}
                  onFocus={() => setHoveredSlotId(slot.id)}
                  onBlur={() => setHoveredSlotId(null)}
                  onClick={() => handleSelectSlot(slot, isActive)}
                  className={`h-full min-h-0 w-full rounded-xl border-2 border-[#111111] px-1.5 py-1 flex items-center gap-1.5 text-left cursor-pointer select-none focus:outline-none transition-all duration-100 ${
                    isActive
                      ? 'bg-[#FFE74C] shadow-[2.5px_2.5px_0px_#111111] -translate-x-[0.5px] -translate-y-[0.5px]'
                      : 'bg-[#FFFDF7] hover:bg-[#FFF7DC] shadow-[0_1.5px_0_#111111] hover:-translate-y-[0.5px] active:translate-y-[1px] active:shadow-none'
                  }`}
                >
                  {/* Framed Mini-CRT Pixel-Art Preview Square */}
                  <div
                    className={`h-[42px] max-h-full aspect-[16/15] shrink-0 rounded-[6px] border-[1.5px] border-[#111111] p-[1.5px] transition-colors ${
                      isActive
                        ? 'bg-[#111111]'
                        : 'bg-[#EFE6CE] group-hover:bg-[#7FD1AE]'
                    }`}
                  >
                    <div className="relative w-full h-full rounded-[4px] bg-[#000000] overflow-hidden">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={slot.previewSrc}
                        alt={`${slot.code} ${slot.shortName} room preview`}
                        draggable={false}
                        className="w-full h-full block object-cover"
                        style={{ imageRendering: 'pixelated' }}
                      />
                      {beatTop && (
                        <span
                          title="You Beat the #1 Time!"
                          className="absolute top-[1.5px] right-[1.5px] bg-[#7FD1AE] text-[#111111] border border-[#111111] rounded-[2.5px] px-[2px] py-[0.5px] text-[6px] font-black leading-none"
                        >
                          ✓
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Right Room Metadata: Stage Code + Daily Tag, Room Title, #1 Time & PB */}
                  <div className="flex-1 min-w-0 flex flex-col justify-center gap-[3px]">
                    <div className="flex items-center gap-1 min-w-0 leading-none">
                      <span
                        style={{ backgroundColor: slot.badgeBg }}
                        className="px-1 py-[1px] rounded border border-[#111111] text-[8px] font-black uppercase leading-none text-[#111111] shrink-0"
                      >
                        {slot.code}
                      </span>
                      {slot.kind === 'daily' && (
                        <span className="bg-[#EC6553] text-white border border-[#111111] rounded px-1 py-[1px] text-[6.5px] font-black uppercase leading-none shrink-0">
                          DAILY
                        </span>
                      )}
                    </div>

                    <div className="text-[9.5px] font-black uppercase tracking-tight text-[#111111] truncate leading-tight">
                      {slot.shortName}
                    </div>

                    <div className="flex items-center gap-1 text-[8.5px] font-black uppercase tabular-nums leading-none">
                      <span className={isActive ? 'text-[#111111]' : 'text-[#111111]/75'}>
                        👑 {(topMs / 1000).toFixed(2)}s
                      </span>
                      {pbMs !== null && (
                        <span
                          className={`truncate ${
                            beatTop ? 'text-[#0B5D3B]' : 'text-[#111111]/60'
                          }`}
                        >
                          {beatTop ? '★' : 'PB'} {(pbMs / 1000).toFixed(2)}s
                        </span>
                      )}
                    </div>
                  </div>
                </button>

                {slot.customSegment && onDeleteCustomSegment && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (slot.customSegment) onDeleteCustomSegment(slot.customSegment);
                    }}
                    title={`Delete segment ${slot.code}`}
                    aria-label={`Delete segment ${slot.code}`}
                    className="opacity-0 group-hover:opacity-100 focus:opacity-100 absolute -top-1 -right-1 w-4 h-4 rounded-full border border-[#111111] bg-white hover:bg-[#EC6553] hover:text-white text-[8px] font-black flex items-center justify-center cursor-pointer transition-opacity"
                  >
                    ✕
                  </button>
                )}
              </div>
            );
          })}

          {renderCreatorCardVertical()}
        </div>
      </nav>
    );
  }

  return (
    <nav
      aria-label="Speedrun Segment Selector"
      onMouseLeave={() => setHoveredSlotId(null)}
      className="@container w-full mb-2 bg-[#EFE6CE] border-[3.5px] border-[#111111] rounded-2xl px-3 @[620px]:px-4 py-1.5 shadow-[inset_0_2px_0_#FFFDF7,inset_0_-3px_0_#D8CEB4,4px_4px_0px_#111111] flex flex-col min-[540px]:flex-row min-[540px]:items-center justify-between gap-1.5 min-[540px]:gap-2.5 @[620px]:gap-4"
    >
      {/* Left Dock: Clear Purpose Header + Active/Hovered Segment Details + Prev/Next Steppers */}
      <div className="min-[540px]:w-[144px] shrink-0 flex flex-row min-[540px]:flex-col items-center min-[540px]:items-stretch justify-between gap-2">
        <div className="flex items-center justify-between gap-1.5">
          <span className="text-[9px] font-black uppercase tracking-wider text-[#111111]/65 leading-none whitespace-nowrap">
            PICK A SEGMENT
          </span>
          <div className="hidden min-[540px]:flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={() => onStepLevel(-1)}
              aria-label="Previous Level"
              title="Previous Segment (Shortcut: [ or Controller LB)"
              className="w-[19px] h-[17px] rounded-[5px] border-[1.5px] border-[#111111] bg-[#FFFDF7] hover:bg-[#FFE74C] text-[#111111] font-black text-[8px] flex items-center justify-center cursor-pointer select-none shadow-[0_1.5px_0_#111111] active:translate-y-[1px] active:shadow-none transition-all duration-75"
            >
              ◀
            </button>
            <button
              type="button"
              onClick={() => onStepLevel(1)}
              aria-label="Next Level"
              title="Next Segment (Shortcut: ] or Controller RB)"
              className="w-[19px] h-[17px] rounded-[5px] border-[1.5px] border-[#111111] bg-[#FFFDF7] hover:bg-[#FFE74C] text-[#111111] font-black text-[8px] flex items-center justify-center cursor-pointer select-none shadow-[0_1.5px_0_#111111] active:translate-y-[1px] active:shadow-none transition-all duration-75"
            >
              ▶
            </button>
          </div>
        </div>

        <div className="flex items-center gap-1 min-w-0 leading-none min-[540px]:mt-1">
          <span
            style={{ backgroundColor: displaySlot.badgeBg }}
            className="px-1 py-[1.5px] rounded border-[1.5px] border-[#111111] text-[8.5px] font-black uppercase leading-none text-[#111111] shrink-0"
          >
            {displaySlot.code}
          </span>
          <span className="text-[10.5px] font-black uppercase tracking-tight text-[#111111] truncate leading-none">
            {displaySlot.shortName}
          </span>
        </div>

        <div className="hidden min-[540px]:flex items-center gap-1.5 text-[9px] font-black uppercase tabular-nums leading-none mt-1.5">
          {displaySlot.kind === 'daily' && (
            <span className="bg-[#EC6553] text-white border border-[#111111] rounded px-1 py-[1px] text-[7.5px] leading-none shrink-0">
              DAILY
            </span>
          )}
          <span className="text-[#111111]/85 whitespace-nowrap">
            👑 {(displayStats.topMs / 1000).toFixed(2)}s
          </span>
          {displayStats.pbMs !== null ? (
            <span
              className={`whitespace-nowrap truncate ${
                displayStats.beatTop ? 'text-[#0B5D3B]' : 'text-[#111111]/65'
              }`}
            >
              {displayStats.beatTop ? '★' : 'PB'} {(displayStats.pbMs / 1000).toFixed(2)}s
            </span>
          ) : !isDisplayingActive ? (
            <span className="text-[#0B5D3B] whitespace-nowrap">PLAY ▶</span>
          ) : (
            <span className="text-[#111111]/55 whitespace-nowrap">
              {isAttractMode ? 'DEMO' : 'LIVE'}
            </span>
          )}
        </div>
      </div>

      {/* Recessed Console Deck Seam */}
      <div
        aria-hidden="true"
        className="hidden min-[540px]:block w-[2px] h-12 bg-[#111111]/15 rounded-full shrink-0"
      />

      {/* Right Zone: Small Tactile Squares With Crisp Pixel-Art Room Previews */}
      <div className="flex-1 min-w-0 flex items-center justify-between min-[660px]:justify-around gap-1.5">
        {slots.map((slot, idx) => {
          const isActive = idx === activeIdx;
          const { topMs, pbMs, beatTop } = getSlotStats(slot);

          return (
            <button
              key={slot.id}
              type="button"
              aria-current={isActive ? 'true' : undefined}
              aria-label={`Select ${slot.fullTitle} (#1 Time ${(topMs / 1000).toFixed(2)}s)`}
              title={`${slot.fullTitle} — #1 Time: ${(topMs / 1000).toFixed(2)}s${
                pbMs !== null ? ` • Your PB: ${(pbMs / 1000).toFixed(2)}s` : ''
              }`}
              onMouseEnter={() => setHoveredSlotId(slot.id)}
              onFocus={() => setHoveredSlotId(slot.id)}
              onBlur={() => setHoveredSlotId(null)}
              onClick={() => handleSelectSlot(slot, isActive)}
              className="group flex-1 max-w-[56px] flex flex-col items-center gap-[3px] cursor-pointer select-none focus:outline-none"
            >
              <div
                className={`w-full rounded-[9px] border-2 border-[#111111] p-[2px] transition-all duration-100 ${
                  isActive
                    ? 'bg-[#FFE74C] shadow-[2.5px_2.5px_0px_#111111] -translate-y-[1.5px]'
                    : 'bg-[#FFFDF7] group-hover:bg-[#7FD1AE] shadow-[0_2px_0_#111111] group-hover:-translate-y-[1px] group-active:translate-y-[1px] group-active:shadow-none'
                }`}
              >
                <div className="relative w-full aspect-[16/15] rounded-[5.5px] bg-[#000000] border border-[#111111]/80 overflow-hidden">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={slot.previewSrc}
                    alt={`${slot.code} ${slot.shortName} room preview`}
                    draggable={false}
                    className="w-full h-full block object-cover"
                    style={{ imageRendering: 'pixelated' }}
                  />
                  {slot.kind === 'daily' && (
                    <span
                      title="Today's Daily Segment"
                      className="absolute top-[2px] right-[2px] bg-[#EC6553] text-white border border-[#111111] rounded-[3px] px-[2.5px] py-[0.5px] text-[6.5px] font-black leading-none shadow-[0_1px_0_#111111]"
                    >
                      ★
                    </span>
                  )}
                  {beatTop && slot.kind !== 'daily' && (
                    <span
                      title="You Beat the #1 Time!"
                      className="absolute top-[2px] right-[2px] bg-[#7FD1AE] text-[#111111] border border-[#111111] rounded-[3px] px-[2.5px] py-[0.5px] text-[6.5px] font-black leading-none"
                    >
                      ✓
                    </span>
                  )}
                </div>
              </div>

              <span
                className={`px-1 py-[1.5px] rounded text-[8.5px] font-black uppercase leading-none tracking-tight whitespace-nowrap transition-colors ${
                  isActive
                    ? 'bg-[#FFE74C] text-[#111111] border-[1.5px] border-[#111111] shadow-[1px_1px_0_#111111]'
                    : 'text-[#111111]/80 group-hover:text-[#111111] group-hover:bg-[#FFFDF7]'
                }`}
              >
                {slot.code}
              </span>
            </button>
          );
        })}

        {showCreatorSlot && (
          <button
            type="button"
            onClick={
              segmentCreatorStep === 'mark-start'
                ? onConfirmSegmentStart
                : segmentCreatorStep === 'mark-finish'
                  ? onConfirmSegmentFinish
                  : onStartSegmentCreator
            }
            className="flex-1 max-w-[56px] flex flex-col items-center gap-[3px] cursor-pointer select-none focus:outline-none"
          >
            <div
              className={`w-full aspect-[16/15] rounded-[9px] border-2 border-[#111111] flex items-center justify-center text-sm font-black ${
                segmentCreatorStep === 'mark-start'
                  ? 'bg-[#FFE74C]'
                  : segmentCreatorStep === 'mark-finish'
                    ? 'bg-[#7FD1AE]'
                    : 'border-dashed bg-[#FFFDF7] hover:bg-[#FFE74C]'
              }`}
            >
              {segmentCreatorStep === 'mark-start'
                ? '📍'
                : segmentCreatorStep === 'mark-finish'
                  ? '🏁'
                  : '✂️'}
            </div>
            <span className="px-1 py-[1.5px] rounded text-[8px] font-black uppercase leading-none">
              {segmentCreatorStep === 'mark-start'
                ? 'START'
                : segmentCreatorStep === 'mark-finish'
                  ? 'GOAL'
                  : '+NEW'}
            </span>
          </button>
        )}
      </div>
    </nav>
  );
}
