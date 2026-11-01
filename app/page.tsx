import { connection } from 'next/server';
import BitgeistArena from '@/components/BitgeistArena';
import { getDailySprintForDate } from '@/lib/dailySprints';
import { getGhostsForRom } from '@/lib/ghostStore';

export default async function HomePage() {
  await connection();
  const daily = getDailySprintForDate();
  const { targetGhost } = await getGhostsForRom(daily.romId, undefined, {
    sprintId: daily.sprintId,
    startWorldX: daily.course.startWorldX,
    goalWorldX: daily.course.goalWorldX,
    romTitle: daily.headerStageLabel,
    dailyNumber: daily.dailyNumber,
    courseIndex: daily.course.courseIndex,
    consoleSystem: daily.consoleSystem,
  });

  return (
    <BitgeistArena
      initialTargetGhost={targetGhost}
      initialDailyNumber={daily.dailyNumber}
    />
  );
}
