// Summarize persisted measurements without making any model calls.
import fs from 'node:fs/promises';
import path from 'node:path';
const directory = path.resolve(process.argv[2] ?? 'output/context-evaluation-2026-10-18');
const offline = JSON.parse(await fs.readFile(path.join(directory, 'offline-results.json'), 'utf8'));
const live = JSON.parse(await fs.readFile(path.join(directory, 'live-results-codex.json'), 'utf8'));
const lookupFamilies = new Set(['research', 'drafting', 'version-filter', 'ordinary-lookup']);
const selectedOffline = offline.rows.filter((row: any) => row.strategy === (lookupFamilies.has(row.family) ? 'scoped-bm25' : 'scoped-structure'));
const rows = live.results.filter((row: any) => !row.error);
const totals = (items: any[]) => ({ calls: items.length,
  inputTokens: items.reduce((sum, row) => sum + row.actualInputTokens, 0),
  outputTokens: items.reduce((sum, row) => sum + row.actualOutputTokens, 0),
  cacheReadTokens: items.reduce((sum, row) => sum + row.cacheReadTokens, 0),
  correct: items.reduce((sum, row) => sum + row.correct, 0), required: items.reduce((sum, row) => sum + row.required, 0),
  completeCases: items.filter((row) => row.complete).length,
  totalMilliseconds: items.reduce((sum, row) => sum + row.milliseconds, 0),
});
const byStrategy = ['full', 'scoped-bm25', 'scoped-structure'].map((strategy) => ({ strategy, ...totals(rows.filter((row: any) => row.strategy === strategy)) }));
const selectedLive = rows.filter((row: any) => row.strategy === (row.family === 'research' ? 'scoped-bm25' : 'scoped-structure'));
const baseline = byStrategy.find((row) => row.strategy === 'full')!;
const chosen = totals(selectedLive);
const paired = rows.filter((row: any) => row.strategy === 'scoped-structure').map((row: any) => {
  const full = rows.find((item: any) => item.family === row.family && item.strategy === 'full');
  return { family: row.family, fullInputTokens: full.actualInputTokens, selectedInputTokens: row.actualInputTokens,
    reduction: 1 - row.actualInputTokens / full.actualInputTokens, complete: row.complete, correct: row.correct, required: row.required };
});
const mean = (items: any[], key: string) => items.reduce((sum, row) => sum + row[key], 0) / items.length;
const summary = { syntheticOnly: true, liveScope: 'Exact fact fidelity under fixed-context injection; no pedagogical quality or multi-step tools tested.',
  offline: { evaluations: offline.rows.length, distinctScenarios: selectedOffline.length,
    recommendedCompleteCases: selectedOffline.filter((row: any) => row.complete).length,
    recommendedMeanCharacters: mean(selectedOffline, 'characters'),
    fullMeanCharacters: mean(offline.rows.filter((row: any) => row.strategy === 'full'), 'characters') },
  live: { measuredCalls: rows.length, ...totals(rows), byStrategy, paired,
    recommended: { ...chosen, inputReduction: 1 - chosen.inputTokens / baseline.inputTokens } },
  cachePrototype: offline.cacheChecks, productionRuntimeChanged: false,
  caveats: ['One model/effort configuration; one sample per task/strategy.', 'Holdout seeds vary numbers, not document structures.',
    'No actual embedding, neural compressor, GraphRAG or multi-agent comparison.', 'Cache prototype checks exact identities only; it does not qualify a production cache.',
    'Provider token telemetry includes fixed CLI overhead; characters are reported separately.', 'Claude calls were blocked by a usage limit before inference.'] };
if (rows.length !== 18 || !byStrategy.find((row) => row.strategy === 'scoped-structure' && row.completeCases === 6)
  || selectedOffline.length !== 88 || selectedOffline.some((row: any) => !row.complete)) throw new Error('Evaluation completeness gate failed');
await fs.writeFile(path.join(directory, 'decision-summary.json'), JSON.stringify(summary, null, 2));
const csv = ['family,strategy,input_tokens,output_tokens,correct,required,complete,milliseconds',
  ...rows.map((row: any) => [row.family, row.strategy, row.actualInputTokens, row.actualOutputTokens, row.correct, row.required, row.complete, Math.round(row.milliseconds)].join(','))].join('\n') + '\n';
await fs.writeFile(path.join(directory, 'live-metrics.csv'), csv);
console.log(JSON.stringify(summary, null, 2));
