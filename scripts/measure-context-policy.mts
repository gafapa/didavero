// Measure actual production context builders with synthetic data; no inference calls.
import fs from 'node:fs/promises';
import path from 'node:path';
import { AGENTES, construirPrompt } from '../server/agents/agentes';
import { selectExamAdaptationContext } from '../server/examContext';
import type { PreguntaExamen } from '../shared/examenes';

const context = { asignatura: { nombre: 'Synthetic subject', contexto: '', idioma: 'español' } as any };
const roles = ['investigador', 'arquitecto', 'examinador', 'glosario', 'diagnostico', 'director-visual'];
const prompts = roles.map((role) => {
  const full = construirPrompt(AGENTES[role].instrucciones, context, 'Synthetic output task');
  const compact = construirPrompt(AGENTES[role].instrucciones, context, 'Synthetic output task', undefined, 'structured');
  return { role, fullSystemCharacters: full.sistema.length, compactSystemCharacters: compact.sistema.length,
    reduction: 1 - compact.sistema.length / full.sistema.length };
});
const questions: PreguntaExamen[] = Array.from({ length: 20 }, (_, index) => ({
  id: `q${index}`, tipo: 'desarrollo', puntos: 5, enunciado: `Explain synthetic concept ${index}.`,
  solucion: 'Exact synthetic model answer with negations and exceptions. '.repeat(12),
  explicacion: 'Synthetic explanation. '.repeat(8),
  rubrica: [{ criterio: 'Observable evidence. '.repeat(8), puntos: 5, niveles: [
    { nivel: 'Complete', descripcion: 'Complete explanation of the requested concept. '.repeat(5), puntos: 5 },
    { nivel: 'Absent', descripcion: 'No evidence.', puntos: 0 },
  ] }], errores: ['Synthetic frequent mistake. '.repeat(10)],
}));
const packet = selectExamAdaptationContext(questions, ['q1', 'q19']);
const before = JSON.stringify({ instrucciones: 'Synthetic instructions', preguntas: questions }).length;
const after = JSON.stringify({ instrucciones: 'Synthetic instructions', preguntas: packet.selectedQuestions }).length + JSON.stringify(packet.referenceQuestions).length;
const result = { syntheticOnly: true, modelCalls: 0, unit: 'characters, not tokens', prompts,
  exam: { totalQuestions: 20, selectedQuestions: 2, beforePayloadCharacters: before, afterPayloadCharacters: after, reduction: 1 - after / before },
  caveats: ['Source payload measurements exclude task wording and snapshot pointer overhead.', 'Repeated synthetic rubric prose is not representative of every exam.', 'No application-wide token-saving percentage is inferred.'] };
const directory = path.resolve('output/context-policy-2026-10-18');
await fs.mkdir(directory, { recursive: true });
await fs.writeFile(path.join(directory, 'measurements.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
