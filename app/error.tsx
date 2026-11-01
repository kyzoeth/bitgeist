'use client';

import React, { useEffect } from 'react';
import Link from 'next/link';

export default function GlobalRouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[Bitgeist] Route error:', error);
  }, [error]);

  return (
    <main className="h-[100dvh] w-full bg-[#F4ECD8] text-[#111111] font-mono flex items-center justify-center p-4 select-none">
      <div className="bg-[#FFF9E6] border-4 border-[#111111] rounded-2xl shadow-[8px_8px_0px_#111111] max-w-md w-full overflow-hidden">
        <div className="bg-[#EC6553] border-b-4 border-[#111111] px-4 py-3 flex items-center justify-between text-white">
          <span className="font-black text-sm uppercase tracking-wider">CRT GLITCH DETECTED</span>
          <span className="bg-[#111111] text-[#FFE74C] px-2 py-0.5 rounded text-xs font-black">
            ERR
          </span>
        </div>

        <div className="p-6 text-center space-y-4">
          <div className="bg-[#25242B] text-[#FFFDF7] border-[3px] border-[#111111] rounded-xl py-5 px-4 space-y-2">
            <div className="text-2xl font-black text-[#FFE74C] tracking-tight">
              REBOOTING CONSOLE
            </div>
            <p className="text-xs font-bold text-white/80">
              Something glitched while loading the arena. Hit reset below to snap right back to the
              starting line.
            </p>
          </div>

          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={reset}
              className="retro-btn flex-1 bg-[#F5C342] hover:bg-[#FFE74C] py-2.5 px-4 text-xs uppercase"
            >
              ↻ RESET CONSOLE
            </button>
            <Link
              href="/"
              className="retro-btn flex-1 bg-[#7FD1AE] py-2.5 px-4 text-xs uppercase text-center"
            >
              HOME ARENA
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
