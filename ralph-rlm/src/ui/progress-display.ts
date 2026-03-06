import type { Feature, FeatureList } from '../config/types.js';

export function formatProgressBar(percent: number, width = 40): string {
  const filled = Math.floor(width * percent / 100);
  const empty = width - filled;
  return '#'.repeat(filled) + '-'.repeat(empty);
}

export function formatFeatureTable(features: Feature[]): string[] {
  const lines: string[] = [];
  lines.push('  ID       Status        Claimed By       Attempts  Description');
  lines.push('  ------   -----------   --------------   --------  -----------');

  for (const f of features) {
    const id = f.id.padEnd(6);
    const status = f.status.padEnd(11);
    const claimedBy = (f.claimed_by ?? '-').padEnd(14);
    const attempts = String(f.attempts).padEnd(8);
    let desc = f.description;
    if (desc.length > 40) desc = desc.substring(0, 37) + '...';
    lines.push(`  ${id}   ${status}   ${claimedBy}   ${attempts}  ${desc}`);
  }

  return lines;
}

export function formatProgressSnapshot(data: FeatureList): string {
  const total = data.features.length;
  const complete = data.features.filter(f => f.status === 'complete').length;
  const inProgress = data.features.filter(f => f.status === 'in_progress');
  const pending = data.features.filter(f => f.status === 'pending').length;
  const blocked = data.features.filter(f => f.status === 'blocked').length;

  const percent = total > 0 ? Math.floor((complete / total) * 100) : 0;

  let workers = '';
  if (inProgress.length > 0) {
    const parts = inProgress.map(f => {
      const who = f.claimed_by ?? '?';
      return `${who}:${f.id}`;
    });
    workers = ` | active: ${parts.join(', ')}`;
  }

  return `${complete}/${total} complete (${percent}%) | ${inProgress.length} in-progress | ${pending} pending | ${blocked} blocked${workers}`;
}
