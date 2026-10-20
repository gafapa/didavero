import { useState } from 'react';
import { partesPregunta } from '../../../shared/actividades';
import { fmtPuntos, rubricaAMarkdown, solucionarioAMarkdown, type Examen, type PreguntaExamen } from '../../../shared/examenes';
import { urlDatos } from '../lib/api';
import { VistaPrevia } from './VistaPrevia';

type ComparisonContent = 'question' | 'answers' | 'rubric';

function questionMarkdown(exam: Examen, question: PreguntaExamen, content: ComparisonContent): string {
  const singleQuestion: Examen = {
    ...exam,
    preguntas: [question],
    opciones: { ...exam.opciones, elegir: undefined, total: question.puntos },
  };
  if (content === 'answers') return solucionarioAMarkdown(singleQuestion);
  if (content === 'rubric') return rubricaAMarkdown(singleQuestion);
  const { enunciado, resto } = partesPregunta(question, question.tipo, question.id);
  return [`*(${fmtPuntos(question.puntos)} p)* ${enunciado}`, '', ...resto].join('\n');
}

/** Compare against the saved snapshot even if the source exam changes or is deleted. */
export function ExamAdaptationComparison({ subjectId, exam }: { subjectId: string; exam: Examen }) {
  const [selectedId, setSelectedId] = useState(exam.adaptation?.questionIds[0]);
  const [content, setContent] = useState<ComparisonContent>('question');
  const adaptation = exam.adaptation;
  if (!adaptation?.completedAt) return null;
  const original = adaptation.originalQuestions.find((question) => question.id === selectedId) ?? adaptation.originalQuestions[0];
  if (!original) return null;
  const current = exam.preguntas.find((question) => question.id === original.id);
  const base = urlDatos(subjectId, 'examenes', exam.id);
  return (
    <details className="rounded-lg border border-borde px-3 py-2">
      <summary className="min-h-8 cursor-pointer text-sm font-medium focus-visible:outline-2 focus-visible:outline-acento">Comparar con el original</summary>
      <div className="space-y-4 pt-3">
        <p className="text-xs text-texto-2">El original corresponde al momento de crear la copia. La versión actual incluye tus cambios posteriores.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-sm font-medium">Pregunta
            <select className="mt-1 min-h-11 w-full rounded-lg border border-borde bg-panel px-2 text-sm text-texto focus-visible:outline-2 focus-visible:outline-acento" value={original.id} onChange={(event) => setSelectedId(event.target.value)}>
              {adaptation.originalQuestions.map((question, index) => <option key={question.id} value={question.id}>
                {index + 1}. {question.enunciado.slice(0, 100)}{adaptation.questionIds.includes(question.id) ? ' · Seleccionada para adaptar' : ' · Sin adaptar'}
              </option>)}
            </select>
          </label>
          <label className="block text-sm font-medium">Contenido que se compara
            <select className="mt-1 min-h-11 w-full rounded-lg border border-borde bg-panel px-2 text-sm text-texto focus-visible:outline-2 focus-visible:outline-acento" value={content} onChange={(event) => setContent(event.target.value as ComparisonContent)}>
              <option value="question">Enunciado y opciones</option>
              <option value="answers">Solucionario</option>
              <option value="rubric">Rúbrica de corrección</option>
            </select>
          </label>
        </div>
        <div className="grid gap-4 xl:grid-cols-2">
          <section className="min-w-0 overflow-x-auto">
            <h4 className="mb-2 text-sm font-semibold">Original guardado</h4>
            <VistaPrevia texto={questionMarkdown(exam, original, content)} base={base} />
          </section>
          <section className="min-w-0 overflow-x-auto">
            <h4 className="mb-2 text-sm font-semibold">Versión actual</h4>
            {current ? <VistaPrevia texto={questionMarkdown(exam, current, content)} base={base} />
              : <p role="status" className="text-sm text-texto-2">Esta pregunta se ha eliminado de la versión actual.</p>}
          </section>
        </div>
      </div>
    </details>
  );
}
