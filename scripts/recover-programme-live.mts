/** Reprocess retained real-model artifacts through current production validation; never launches a model. */
import fs from 'node:fs/promises'; import path from 'node:path'; import os from 'node:os';
import { Almacen } from '../server/store'; import { Cola } from '../server/agents/cola'; import { Flujo } from '../server/flujo';
import { programmeIssues } from '../shared/teachingProgramme'; import { exportProgramme } from '../server/exportProgramme';
const output=path.resolve(process.argv.find(value=>value.startsWith('--output='))?.slice(9)||'output/programme-live-validation-2026-10-19');
const receipt=JSON.parse(await fs.readFile(path.join(output,'live-receipt.json'),'utf8'));
const directory=await fs.realpath(receipt.directory), temporary=await fs.realpath(os.tmpdir());
if(path.dirname(directory)!==temporary||!path.basename(directory).startsWith('apuntes-live-programmes-'))throw Error('Refusing to modify a non-validation workspace.');
const storage=new Almacen(path.join(directory,'data'));await storage.iniciar();const queue=new Cola(1,path.join(directory,'qa-recovery'));
const flow=new Flujo({almacen:()=>storage,cola:queue,ajustes:()=>({carpetaDatos:storage.raiz,maxSimultaneos:1,motorPorDefecto:'claude',asistenteCompletado:true,agentes:{}}),motoresListos:()=>new Set()});
const results=[];
try {
 for(const entry of receipt.cases){
  if(!entry.generationJob)continue;
  const record=JSON.parse(await fs.readFile(path.join(directory,'jobs',entry.generationJob.id+'.json'),'utf8'));
  try {
   const message=await (flow as any).postprocesar(record.trabajo,record.peticion.post);
   const store=await flow.programmeStore(entry.subjectId,entry.projectId),state=await store.read(),curriculum=await store.curriculum(state.draft!.curriculumVersionId);
   const research=await(await flow.programmeProjects(entry.subjectId).research(entry.projectId)).read();
   const issues=programmeIssues(state.draft!,curriculum),contentIds=new Set(state.draft!.units.flatMap(unit=>unit.contentIds));
   const missingKnowledge=curriculum.elements.filter(element=>element.kind==='knowledge'&&!contentIds.has(element.id)).map(element=>element.id);
   await fs.writeFile(path.join(output,`${entry.key}-recovered-programme.json`),JSON.stringify({state,curriculum,research},null,2));
   for(const format of ['md','pdf','docx','odt'] as const){const exported=await exportProgramme(storage,entry.subjectId,state.draft!,curriculum,format,{dirBin:path.resolve('resources-bin',process.platform==='win32'?'win':'linux'),research:research.result});await fs.writeFile(path.join(output,`${entry.key}-programme.${format}`),exported.content);}
   const result={case:entry.key,message,revision:state.revision,issues,missingKnowledge,units:state.draft!.units.length,activities:state.draft!.units.reduce((count,unit)=>count+(unit.activityPlan?.length||0),0),researchStatus:research.result?.status};results.push(result);console.log(JSON.stringify(result));
  }catch(error){const result={case:entry.key,error:String(error)};results.push(result);console.log(JSON.stringify(result))}
 }
}finally{await queue.flush();await fs.writeFile(path.join(output,'reprocessing-receipt.json'),JSON.stringify({checkedAt:new Date().toISOString(),results},null,2));}
