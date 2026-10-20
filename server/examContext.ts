import type { PreguntaExamen } from '../shared/examenes';

/** Keep exact selected questions and shared inputs; omit unrelated grading prose. */
export function selectExamAdaptationContext(questions: PreguntaExamen[], selectedIds: string[]) {
  const requested = new Set(selectedIds);
  if (!requested.size || requested.size !== selectedIds.length
    || new Set(questions.map((question) => question.id)).size !== questions.length
    || selectedIds.some((id) => !questions.some((question) => question.id === id))) {
    throw new Error('Invalid exam context selection');
  }
  const selectedQuestions = questions.filter((question) => requested.has(question.id));
  const referenceQuestions = questions.filter((question) => !requested.has(question.id)).map((question) => {
    const { solucion: _solution, explicacion: _explanation, rubrica: _rubric, errores: _errors, ...reference } = question;
    return reference;
  });
  return { selectedQuestions, referenceQuestions };
}
