import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="h-[100dvh] w-full bg-[#F4ECD8] text-[#111111] font-mono flex items-center justify-center p-4 select-none">
      <div className="bg-[#FFF9E6] border-4 border-[#111111] rounded-2xl shadow-[8px_8px_0px_#111111] max-w-md w-full overflow-hidden">
        <div className="bg-[#EC6553] border-b-4 border-[#111111] px-4 py-3 flex items-center justify-between text-white">
          <span className="font-black text-sm uppercase tracking-wider">CARTRIDGE NOT FOUND</span>
          <span className="bg-[#111111] text-[#FFE74C] px-2 py-0.5 rounded text-xs font-black">
            404
          </span>
        </div>

        <div className="p-6 text-center space-y-4">
          <div className="bg-[#25242B] text-[#FFFDF7] border-[3px] border-[#111111] rounded-xl py-6 px-4 space-y-2">
            <div className="text-3xl font-black text-[#FFE74C] tracking-tight">NO SIGNAL</div>
            <p className="text-xs font-bold text-white/80">
              This ghost link or cartridge slot does not exist. Blow into the cartridge and jump
              back into today&apos;s #1 ghost sprint!
            </p>
          </div>

          <Link
            href="/"
            className="retro-btn inline-flex items-center justify-center w-full bg-[#F5C342] hover:bg-[#FFE74C] py-3 px-4 text-sm uppercase"
          >
            ▶ RACE TODAY&apos;S #1 GHOST
          </Link>
        </div>
      </div>
    </main>
  );
}
