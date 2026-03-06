import type { FeatureList } from '../config/types.js';

export function formatPostRunReport(data: FeatureList): string[] {
  const lines: string[] = [];
  const total = data.features.length;
  const complete = data.features.filter(f => f.status === 'complete');
  const blocked = data.features.filter(f => f.status === 'blocked');
  const inProgress = data.features.filter(f => f.status === 'in_progress');
  const pending = data.features.filter(f => f.status === 'pending');

  const percent = total > 0 ? Math.floor((complete.length / total) * 100) : 0;

  lines.push('');
  lines.push('================================================================');
  lines.push('  POST-RUN REPORT');
  lines.push('================================================================');
  lines.push('');
  lines.push(`  Summary: ${complete.length} complete | ${inProgress.length} in-progress | ${pending.length} pending | ${blocked.length} blocked  (${percent}% done)`);
  lines.push('');

  if (complete.length > 0) {
    lines.push(`  COMPLETED (${complete.length})`);
    for (const f of complete) {
      const claimedBy = f.claimed_by ?? '-';
      const attempts = f.attempts || 1;
      lines.push(`    ${f.id}: ${f.description}  [by: ${claimedBy}, attempts: ${attempts}]`);
    }
    lines.push('');
  }

  if (blocked.length > 0) {
    lines.push(`  BLOCKED (${blocked.length})`);
    for (const f of blocked) {
      const claimedBy = f.claimed_by ?? '-';
      let lastError = f.last_error ?? '-';
      if (lastError.length > 80) lastError = lastError.substring(0, 77) + '...';
      lines.push(`    ${f.id}: ${f.description}`);
      lines.push(`      by: ${claimedBy} | error: ${lastError}`);
    }
    lines.push('');
  }

  if (inProgress.length > 0) {
    lines.push(`  IN-PROGRESS (${inProgress.length}) - may indicate crashed teammates`);
    for (const f of inProgress) {
      const claimedBy = f.claimed_by ?? '-';
      lines.push(`    ${f.id}: ${f.description}  [claimed by: ${claimedBy}]`);
    }
    lines.push('');
  }

  lines.push('================================================================');
  lines.push('');

  return lines;
}
