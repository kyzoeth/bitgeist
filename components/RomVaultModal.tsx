'use client';

import React, { useState } from 'react';
import { findBuiltinCartridgeByRomId } from '@/lib/homebrewCatalog';
import { CONSOLE_SYSTEM_LABELS, SUPPORTED_ROM_EXTENSIONS } from '@/lib/romVault';
import { RomProfile, StoredRomEntry } from '@/lib/types';

interface RomVaultModalProps {
  isOpen: boolean;
  activeProfile: RomProfile;
  vaultRoms: StoredRomEntry[];
  missingDareCartTitle?: string | null;
  externalError?: string | null;
  onSelectBuiltinCeleste?: () => void;
  onSelectVaultRom: (entry: StoredRomEntry) => void;
  onDeleteVaultRom?: (entry: StoredRomEntry) => void;
  onDropNewRomFile: (file: File) => Promise<void>;
  onStartSegmentCreator?: () => void;
  onClose: () => void;
}

const SUPPORTED_CONSOLES = ['NES', 'SNES', 'GENESIS', 'GAME BOY', 'GBA'];

export default function RomVaultModal({
  isOpen,
  activeProfile,
  vaultRoms,
  missingDareCartTitle,
  externalError,
  onSelectBuiltinCeleste,
  onSelectVaultRom,
  onDeleteVaultRom,
  onDropNewRomFile,
  onStartSegmentCreator,
  onClose,
}: RomVaultModalProps) {
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  if (!isOpen) return null;

  const displayError = errorMsg || externalError || null;
  const isBuiltinCartridge = Boolean(findBuiltinCartridgeByRomId(activeProfile.romId));

  const handleFileInput = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setErrorMsg(null);
    try {
      await onDropNewRomFile(file);
      onClose();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unsupported ROM file');
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Play Your Own ROM"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="modal-backdrop-fade fixed inset-0 z-50 bg-[#111111]/70 flex items-center justify-center p-4 overflow-y-auto font-mono"
    >
      <div className="modal-card-pop bg-[#FFF9E6] border-4 border-[#111111] rounded-2xl shadow-[9px_9px_0px_#111111] max-w-sm w-full overflow-hidden my-auto text-[#111111]">
        <div className="bg-[#7FD1AE] border-b-4 border-[#111111] px-4 py-3 flex items-center justify-between">
          <span className="font-black text-sm uppercase">📼 PLAY YOUR OWN ROM</span>
          <button
            type="button"
            onClick={onClose}
            className="retro-btn bg-white px-2.5 py-0.5 text-sm"
            aria-label="Close Play Any ROM"
          >
            ✕
          </button>
        </div>

        <div className="p-4 space-y-3.5">
          {missingDareCartTitle && (
            <div className="bg-[#FFE74C] border-2 border-[#111111] rounded-xl px-3 py-2 text-xs font-black">
              ⚔️ Drop <span className="underline">{missingDareCartTitle}</span> to race this
              friend&apos;s dare!
            </div>
          )}

          {/* Single Hero Action: Choose or Drop Any ROM File or .IPS/.BPS Patch */}
          <label className="flex flex-col items-center justify-center gap-2.5 bg-[#FFFDF7] border-[3px] border-dashed border-[#111111] rounded-2xl py-6 px-4 cursor-pointer hover:bg-[#F7EED7] transition text-center">
            <span className="retro-btn bg-[#F5C342] px-4 py-2 text-xs uppercase pointer-events-none">
              CHOOSE .NES / .ZIP / .IPS / .BPS
            </span>
            <span className="text-xs font-black uppercase">or drag &amp; drop ROM or patch anywhere</span>

            <div className="flex flex-wrap items-center justify-center gap-1 pt-0.5">
              {SUPPORTED_CONSOLES.map((sys) => (
                <span
                  key={sys}
                  className="bg-[#EAE2C8] border border-[#111111] rounded px-1.5 py-0.5 text-[10px] font-black"
                >
                  {sys}
                </span>
              ))}
              <span className="bg-[#7FD1AE] border border-[#111111] rounded px-1.5 py-0.5 text-[10px] font-black">
                .IPS / .BPS PATCH
              </span>
            </div>

            <span className="text-[11px] font-bold text-[#111111]/70">
              100% local in your browser • Your ROMs are never uploaded
            </span>

            <input
              type="file"
              accept={SUPPORTED_ROM_EXTENSIONS}
              className="hidden"
              onChange={(e) => void handleFileInput(e)}
            />
          </label>

          {displayError && (
            <div className="bg-[#EC6553] text-white border-2 border-[#111111] rounded-xl px-3 py-2 text-xs font-black">
              {displayError}
            </div>
          )}

          {/* Recent Games (Only shown once the user has dropped at least 1 ROM) */}
          {vaultRoms.length > 0 && (
            <div className="space-y-1.5">
              <div className="text-[11px] font-black uppercase opacity-75">RECENT GAMES</div>
              <div className="max-h-36 overflow-y-auto space-y-1.5 pr-0.5">
                {vaultRoms.map((entry) => {
                  const isActive = activeProfile.romId === entry.romId;
                  const sysLabel = CONSOLE_SYSTEM_LABELS[entry.consoleSystem ?? 'nes'] || 'NES';
                  return (
                    <div key={entry.romId} className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => {
                          onSelectVaultRom(entry);
                          onClose();
                        }}
                        className={`flex-1 min-w-0 text-left px-3 py-2 rounded-xl border-2 border-[#111111] font-black text-xs flex items-center justify-between gap-2 transition cursor-pointer ${
                          isActive
                            ? 'bg-[#F5C342] shadow-[2px_2px_0px_#111111]'
                            : 'bg-white hover:bg-[#F7EED7]'
                        }`}
                      >
                        <span className="truncate">{entry.title}</span>
                        <span className="flex items-center gap-1.5 shrink-0">
                          <span className="px-1.5 py-0.5 rounded border border-[#111111] bg-[#EAE2C8] text-[10px]">
                            {sysLabel}
                          </span>
                          <span className="uppercase">{isActive ? 'PLAYING' : 'PLAY ▶'}</span>
                        </span>
                      </button>

                      {onDeleteVaultRom && (
                        <button
                          type="button"
                          onClick={() => onDeleteVaultRom(entry)}
                          title={`Remove ${entry.title}`}
                          aria-label={`Remove ${entry.title}`}
                          className="w-8 h-8 shrink-0 rounded-lg border-2 border-[#111111] bg-white hover:bg-[#EC6553] hover:text-white font-black text-xs flex items-center justify-center cursor-pointer transition-colors"
                        >
                          ✕
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Custom Vault ROM Actions: Mark Custom Sprint or Return to Celeste */}
          {!isBuiltinCartridge && (
            <div className="pt-0.5 space-y-2">
              {onStartSegmentCreator && (
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onStartSegmentCreator();
                  }}
                  className="w-full retro-btn bg-[#FFE74C] py-2 px-3 text-xs uppercase"
                >
                  ✂️ MARK CUSTOM SPRINT (START → FINISH)
                </button>
              )}
              {onSelectBuiltinCeleste && (
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onSelectBuiltinCeleste();
                  }}
                  className="w-full retro-btn bg-[#F2545B] text-white py-2 px-3 text-xs uppercase"
                >
                  ← RETURN TO CELESTE
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
