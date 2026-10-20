import type { CurriculumProfile } from './curriculum';
import type { ProgrammePurpose } from './teachingProgramme';

export interface ProgrammeResearchSource {
  id: string; title: string; url: string; kind: 'official' | 'example'; publishedOn: string; locator: string; excerpt?: string;
  excerptCheck?: { status: 'matched' | 'notMatched' | 'unavailable'; checkedAt: string };
}
export interface ProgrammeResearchFinding { text: string; sourceIds: string[] }
export interface ProgrammeResearchOutline {
  id: string; title: string; description: string; mandatory: boolean; sourceIds: string[];
}
export interface ProgrammeResearchResult {
  status: 'ready' | 'needsInformation'; summary: string; contextSummary: string;
  outline: ProgrammeResearchOutline[];
  requirements: ProgrammeResearchFinding[];
  sources: ProgrammeResearchSource[];
  questions: string[];
}
export interface ProgrammeResearch extends ProgrammeResearchResult {
  researchedAt: string; curriculumVersionId: string; purpose: ProgrammePurpose; profile: CurriculumProfile; contextFingerprint: string;
}
export interface ProgrammeResearchState {
  schemaVersion: 1; revision: number; result?: ProgrammeResearch; appliedJobs: string[];
}

export function programmeResearchPrompt(result: ProgrammeResearch): string {
  return `INVESTIGACIÓN DE LA ESTRUCTURA (${result.researchedAt}, ${result.status}):
${result.summary}
ADAPTACIÓN AL CONTEXTO:
${result.contextSummary}
ESTRUCTURA PROPUESTA:
${result.outline.map((item, index) => `${index + 1}. ${item.title}: ${item.description} [${item.mandatory ? 'Requisito documentado' : 'Propuesta didáctica'}; fuentes: ${item.sourceIds.join(', ')}]`).join('\n')}
REQUISITOS DOCUMENTADOS:
${result.requirements.map(item => `- ${item.text} [${item.sourceIds.join(', ')}]`).join('\n')}
FUENTES:
${result.sources.map(source => `[${source.id}] ${source.title} (${source.kind}): ${source.url}; ${source.locator}; ${source.publishedOn}${source.excerpt ? `; fragmento literal: ${source.excerpt}` : ''}`).join('\n')}
CUESTIONES PENDIENTES:
${result.questions.map(question => `- ${question}`).join('\n')}
Usa esta investigación para organizar la programación. Distingue requisitos documentados y recomendaciones. Mantén pendientes las cuestiones no resueltas; no inventes requisitos ni vuelvas a investigar fuentes ya consultadas.`;
}
