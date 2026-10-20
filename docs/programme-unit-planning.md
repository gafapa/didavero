# Curriculum-linked units and activities

## Research basis

Reviewed on 2026-10-19 using national regulations and official Galicia guidance. These sources establish the implementation's baseline; the programme's own research still identifies the applicable community, subject/module, academic year and selection call. Galicia's application conventions are not treated as national requirements.

| Teaching context | Planning model used in the editor |
| --- | --- |
| Primary | Units and contextualised learning situations: specific competences, assessment criteria, knowledge/content and any explicitly documented competence/descriptor relationships. Respect cycle-level references and the global approach. |
| ESO | Units and learning situations connected to subject-specific competences, criteria and knowledge/content for the captured course. |
| Bachillerato | The same competence/criterion/knowledge relationships, adapted to the subject and course. No invented basic-education exit-profile requirement. |
| Professional VET modules | Work units and professional activities linked to learning outcomes (RA), assessment criteria (CA/CE), content blocks (BC) and individual contents (C). RA → criterion and BC → content are independent hierarchies. |
| Basic VET | Use the captured module/domain model: professional modules can use RA; general domains may use specific competences. The stage name alone does not select the curriculum model. |

Primary national baseline: [RD 157/2022](https://www.boe.es/eli/es/rd/2022/03/01/157), article 10 and annex III. ESO: [RD 217/2022](https://www.boe.es/eli/es/rd/2022/03/29/217), article 12 and annex III. Bachillerato: [RD 243/2022](https://www.boe.es/eli/es/rd/2022/04/05/243), article 17 and annex III. VET: [RD 659/2023](https://www.boe.es/eli/es/rd/2023/07/18/659), especially the learning-outcome/criterion assessment framework. These regulations do not prescribe the application's JSON fields.

The [official PROENS home page](https://www.edu.xunta.gal/proens/PaxinaInicio.action) currently links the [VET manual v2.10.0 dated 2026-10-13](https://www.edu.xunta.gal/axudaplicacion/DescargarFicheiro.do?_nome=Manual_Proens_FP_v2.10.0_20261013.pdf&_carpeta=proens&_ext=PDF). Printed pages 17–23 describe unit sequencing, unit-curriculum assignments, activity sequencing and activity-curriculum assignments. Printed pages 21–23 distinguish the unit's selected criteria/contents from their distribution across activities. Sessions are separately planned, and activity sessions are checked against unit sessions. Many pages are graphical: relevant pages were rendered and visually inspected because text extraction omitted their content.

The [general PROENS authoring manual](https://www.edu.xunta.gal/axudaplicacion/DescargarFicheiro.do?_nome=Manual%20de%20axuda%20elaboracion%20programacions%20didactica_V1.0.1_20230606.pdf&_carpeta=proens&_ext=PDF) explains Galicia's terminology and the relationship between subject objectives, criteria, content blocks and teaching units. Official curriculum codes are preserved verbatim; their terminology is not replaced by invented national codes.

## Authoring and compatibility

Units retain their existing title, period, hours, criterion/content IDs and legacy prose. Optional additions are explicit RA/specific-competence references, a professional/learning situation, sessions and an ordered structured activity plan. Every activity has its own title, duration, tasks, didactic objectives, evidence, assessment instrument, resources and curriculum references. Sessions never implicitly equal hours.

The editor shows RA or competences and blocks implied by selected child criteria/contents. Explicitly documented official descriptor/key-competence links can be displayed; matching numbers never imply an RA–BC relationship. Assignments are teacher planning decisions and never alter the immutable curriculum. The same criterion can occur in multiple units/activities; that does not automatically create assessment weights.

Activities select from their unit's captured curriculum. Elements already used by an activity cannot be unchecked at unit level until removed from that activity. New activity plans report missing descriptions, criteria, evidence/instruments, hour/session mismatches and unassigned unit criteria/content through the existing grouped checklist. Old units without structured activities remain readable and preserve their text; no destructive migration is performed. Markdown preview/export includes the new activities and exact curriculum references.

## AI assistance

**Ayuda con IA: unidades y actividades** proposes a full unit sequence. **Ayuda con IA para esta unidad** develops one selected unit. Both use the existing architect role and configured engine, the pinned curriculum, saved research and teaching context, without new web research. Subject sources are available when the subject's source permission allows them; private sources belonging to individual Notes are excluded. When an existing unit has both criteria and content selected, its prompt includes those references and known ancestors/official competence links instead of the entire curriculum. An unlinked unit receives the full captured curriculum so it can propose a suitable selection.

The source index is refreshed locally before authoring. A task-specific query includes teacher instructions, the subject and the target unit's curricular references. At most six relevant fragments are included through the existing lexical retrieval path; configured source tools also let the agent search and read relevant pages on demand. Full source files are not automatically injected into the prompt. The prompt requests filename/page citations, treats source content as evidence rather than instructions, and gives precedence to the captured curriculum, researched structure and explicit teacher decisions. Teaching materials cannot establish legal or selection-call requirements. Empty sources or no useful matches do not prevent authoring. This applies to both full programme generation and unit/activity assistance; **Investigar** remains a separate public normative research job without access to indexed teaching files.

Proposals are stored separately in `unit-proposal-<purpose>.json`. The current draft and reviewed copy remain unchanged until the teacher selects **Aplicar propuesta**. Single-unit proposals retain the selected unit's identity, hours, sessions, existing curriculum selections and legacy activity prose. Applying updates that unit only; full-sequence help updates units only. Researched sections, other programme fields and protected reviewed copies are preserved.

Application requires the exact captured programme revision and proposal identity. Late proposals remain available to inspect but cannot overwrite newer edits. Store writes use the existing atomic, revision-checked persistence path; repeated application is idempotent. JSON parsing rejects foreign curriculum IDs, wrong element kinds, activity references outside the unit and duplicate activity IDs. The programme's general AI-generation action also receives the structured unit/activity instructions.

## Validation scope

Synthetic tests cover all six supported stage labels, VET hierarchy separation, exact IDs in exports, legacy data compatibility, malformed activities, hours/sessions, scoped AI prompts, proposal preview storage, selective application, protected reviews, stale/concurrent requests and HTTP routes. They do not establish pedagogical quality of a real generated programme, legal certification or PROENS import compatibility.
