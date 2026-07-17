#!/usr/bin/env node
import { Command, InvalidArgumentError } from "commander";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { copyFileSync, existsSync, mkdirSync, unlinkSync } from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import qrcode from "qrcode-terminal";
import { SkipTheVoiceApplication, JobRunner, SelfHostedWhisperProvider, databaseStatus, getConfig, getDatabase, initializeConfig, maskSecret, publicError, seedDatabase, safeFilename } from "@skipthevoice/core";
import { runConversations } from "./conversations.js";
import { configurePackagedMediaTools } from "./runtime.js";
import { launchUi } from "./ui.js";

type Globals={json?:boolean;quiet?:boolean;verbose?:boolean;userId?:string;config?:string};
const program=new Command(); let app:SkipTheVoiceApplication; let globals:Globals={};
const output=(value:unknown,message?:string)=>{ if(globals.quiet&&!globals.json)return; if(globals.json) console.log(JSON.stringify(value)); else if(message) console.log(message); else if(Array.isArray(value)) console.table(value); else console.log(value); };
const fail=(error:unknown):never=>{if((error as{exitCode?:number})?.exitCode===0)process.exit(0); const safe=publicError(error); if(globals.json) console.error(JSON.stringify({error:{code:safe.code,message:safe.message}})); else console.error(`Error: ${error instanceof Error&&error.message?error.message:safe.message}`); const exits:Record<string,number>={FORBIDDEN:3,USER_NOT_FOUND:3,VALIDATION_ERROR:2,WHISPER_WORKER_UNAVAILABLE:9,TRANSCRIPTION_FAILED:6,AUDIO_FILE_MISSING:7,AUDIO_FILE_INVALID:7,DATABASE_BUSY:8};const commanderCode=(error as {code?:string})?.code?.startsWith("commander.")?2:undefined; process.exit(commanderCode??exits[safe.code]??1); };
const context=()=>app.context(globals.userId??getConfig().defaultUserId);
const positive=(value:string)=>{const number=Number(value);if(!Number.isInteger(number)||number<0)throw new InvalidArgumentError("Expected a non-negative integer.");return number;};
async function confirm(prompt:string){ if(!stdout.isTTY)return false; const reader=createInterface({input:stdin,output:stdout}); const answer=await reader.question(`${prompt} Type "yes" to continue: `); reader.close(); return answer.trim().toLowerCase()==="yes"; }
const optionValue=(command:Command)=>({...command.parent?.optsWithGlobals(),...command.optsWithGlobals()});

const rootHelp=`SkipTheVoice

Read WhatsApp voice messages as text.

Usage:
  skipthevoice                     Start the local UI
  skipthevoice conversations
  skipthevoice conversations <conversation>
  skipthevoice conversations <conversation> <message>
  skipthevoice conversations <conversation> <message> --output
  skipthevoice conversations <conversation> <message> --markdown

Options:
  --output              Print the transcript
  --markdown            Print the transcript as Markdown
  --download-audio      Download the original audio file
  --force               Create a new transcription
  --language <language> Set the transcription language
  --json                Return machine-readable JSON
  --help                Show help
  --version             Show the installed version
`;

program.name("skipthevoice").description("Read WhatsApp voice messages as text.").version("0.1.2").exitOverride()
  .option("--json","Print machine-readable JSON or newline-delimited JSON events.").option("--quiet","Suppress non-essential output.")
  .option("--verbose","Print additional diagnostics without secrets.").option("--user-id <user-id>","Select a local development user.").option("--config <path>","Load another configuration file.")
  .hook("preAction",(_,command)=>{ globals=optionValue(command);configurePackagedMediaTools(); initializeConfig(globals.config); app=new SkipTheVoiceApplication(); });
program.action(()=>launchUi(app));
program.helpInformation=()=>rootHelp;

const connections=program.command("connections").description("Manage messenger connections.");
connections.command("list").action(()=>output(app.listConnections(context())));
connections.command("add <provider>").option("--name <name>","Connection display name","WhatsApp").action((provider,options)=>output(app.addConnection(context(),provider,options.name),"Connection added."));
connections.command("status <connection-id>").action((id)=>output(app.repositories.getConnection(context(),id)));
connections.command("connect <connection-id>").option("--qr","Use QR-code login.").option("--pairing-code","Use phone-number pairing.").option("--phone-number <number>").action(async(connectionId,options)=>{ await app.connect(context(),connectionId,{qr:options.qr,pairingCode:options.pairingCode,phoneNumber:options.phoneNumber,onQr:(qr)=>{if(!globals.json){console.log("Waiting for WhatsApp authentication.\nScan the QR code using WhatsApp.");qrcode.generate(qr,{small:true});}},onPairingCode:(code)=>output({pairingCode:code},`WhatsApp pairing code: ${code}`)}); output({connectionId,status:"connecting"},"WhatsApp connection started. Keep this process running until authentication completes."); if(stdout.isTTY) await new Promise(resolve=>setTimeout(resolve,60_000)); });
connections.command("disconnect <connection-id>").action(async(id)=>{await app.disconnect(context(),id);output({id,status:"disconnected"},"Connection disconnected.");});
connections.command("remove <connection-id>").option("--delete-data","Also delete imported records and files.").option("--yes","Skip confirmation.").action(async(connectionId,options)=>{if(!options.yes&&!await confirm(options.deleteData?"This removes the connection and all imported data.":"Remove this connection?"))throw new Error("Operation cancelled.");output(await app.removeConnection(context(),connectionId,options.deleteData),"Connection removed.");});

program.command("sync").option("--connection <id>").option("--all").option("--wait").action(async(options)=>{const ctx=context();const selected=options.connection?[{id:options.connection}]:app.listConnections(ctx) as any[];const results=[];for(const item of selected)results.push(await app.sync(ctx,item.id));output(results);});
const contacts=program.command("contacts"); contacts.command("list").option("--connection <id>").action(()=>output(app.listContacts(context()))); contacts.command("search <query>").action(query=>output(app.listContacts(context(),query))); contacts.command("show <id>").action(id=>{const row=app.listContacts(context()).find((r:any)=>r.id===id);if(!row)throw new Error("Contact not found.");output(row);});
program.command("conversations [conversation] [message]")
  .description("Browse conversations and voice messages.")
  .option("--output", "Print the transcript")
  .option("--markdown", "Print the transcript as Markdown")
  .option("--download-audio", "Download the original audio file")
  .option("--force", "Create a new transcription")
  .option("--language <language>", "Set the transcription language")
  .action((conversation,message,options)=>runConversations(app,context(),conversation,message,{...options,json:globals.json}));

const audios=program.command("audios");
const addAudioFilters=(command:Command)=>command.option("--limit <number>","Maximum results",positive,20).option("--offset <number>","Results to skip",positive,0).option("--last <number>","Alias for limit",positive).option("--contact <id>").option("--conversation <id>").option("--connection <id>").option("--status <status>").option("--oldest-first").option("--newest-first");
addAudioFilters(audios.command("list")).action(options=>output(app.listVoiceMessages(context(),{limit:options.last??options.limit,offset:options.offset,contactId:options.contact,conversationId:options.conversation,connectionId:options.connection,status:options.status,oldestFirst:options.oldestFirst})));
audios.command("show <voice-message-id>").action(id=>output(app.listVoiceMessages(context(),{limit:100}).find((r:any)=>r.id===id)??app.repositories.getVoiceMessage(context(),id)));
audios.command("play <voice-message-id>").action(id=>{const audio=app.audio(context(),id),command=process.platform==="darwin"?"afplay":process.platform==="win32"?"powershell":"ffplay",args=process.platform==="win32"?["-c",`(New-Object Media.SoundPlayer '${audio.path}').PlaySync()`]:process.platform==="darwin"?[audio.path]:["-nodisp","-autoexit",audio.path];const child=spawn(command,args,{stdio:"inherit",shell:false});child.on("error",fail);});
audios.command("download <voice-message-id>").option("--output <path>").option("--force").action((id,options)=>{const audio=app.audio(context(),id),destination=path.resolve(options.output??audio.filename);if(existsSync(destination)&&!options.force)throw new Error("The output file already exists. Use --force to overwrite it.");copyFileSync(audio.path,destination);output({path:destination},`Audio exported to ${destination}`);});
audios.command("delete <voice-message-id>").option("--yes").action(async(id,options)=>{if(!options.yes&&!await confirm("Delete this voice message and all associated data?"))throw new Error("Operation cancelled.");output(await app.deleteVoiceMessage(context(),id),"Voice message deleted.");});

const transcribe=program.command("transcribe");
transcribe.command("start [voice-message-id]").option("--language <code>").option("--model <model>").option("--wait").option("--last <number>","Transcribe recent messages",positive).option("--contact <id>").option("--conversation <id>").option("--status <status>").option("--all").option("--yes").action(async(voiceId,options)=>{const ctx=context();const ids=voiceId?[voiceId]:(app.listVoiceMessages(ctx,{limit:options.all?100:options.last??20,contactId:options.contact,conversationId:options.conversation,status:options.status??"not_started"}) as any[]).map(row=>row.id);if(ids.length>20&&!options.yes&&!await confirm(`Start ${ids.length} transcriptions?`))throw new Error("Operation cancelled.");const created=ids.map((id:string)=>app.startTranscription(ctx,id,{language:options.language,model:options.model}));for(const job of created)output(job,`Queued transcription ${job.id}.`);if(options.wait){const runner=new JobRunner(app.repositories,new SelfHostedWhisperProvider(),(jobId,progress)=>output({type:"transcription.progress",jobId,...progress},globals.json?undefined:`job=${jobId} phase=${progress.phase} progress=${Math.round(progress.percent??0)}${progress.estimatedRemainingSeconds!=null?` eta_seconds=${Math.round(progress.estimatedRemainingSeconds)}`:""}`));let processed=true;while(processed)processed=await runner.processOne();for(const job of created)output({type:"transcription.result",...app.getJob(ctx,job.id)});}});
transcribe.command("status <job-id>").action(id=>output(app.getJob(context(),id)));
transcribe.command("watch <job-id>").action(async id=>{let previous="";while(true){const job=app.getJob(context(),id),signature=`${job.progressPhase}:${job.progressPercent}:${job.updatedAt}`;if(signature!==previous){output({type:"transcription.progress",...job},globals.json?undefined:`job=${job.id} phase=${job.progressPhase} progress=${Math.round(job.progressPercent??0)}${job.estimatedRemainingSeconds!=null?` eta_seconds=${Math.round(job.estimatedRemainingSeconds)}`:""}`);previous=signature;}if(["completed","failed","cancelled"].includes(job.status))break;await new Promise(resolve=>setTimeout(resolve,1000));}});
transcribe.command("cancel <job-id>").action(async id=>output(await app.cancelTranscription(context(),id),"Cancellation requested.")); transcribe.command("retry <job-id>").action(id=>output(app.retryTranscription(context(),id),"Transcription queued again."));

const transcripts=program.command("transcripts"); transcripts.command("list").action(()=>output(app.repositories.sqlite.prepare("SELECT t.voice_message_id AS voiceMessageId,t.detected_language AS language,t.model,t.created_at AS createdAt FROM transcriptions t WHERE t.user_id=? ORDER BY t.created_at DESC").all(context().userId))); transcripts.command("show <voice-message-id>").action(id=>{app.repositories.getVoiceMessage(context(),id);const row=app.repositories.sqlite.prepare("SELECT text,detected_language AS language,model,created_at AS createdAt FROM transcriptions WHERE voice_message_id=? AND user_id=? ORDER BY created_at DESC LIMIT 1").get(id,context().userId);if(!row)throw new Error("No completed transcript was found.");output(row);}); transcripts.command("copy <voice-message-id>").action(id=>{const row=app.repositories.sqlite.prepare("SELECT text FROM transcriptions WHERE voice_message_id=? AND user_id=? ORDER BY created_at DESC LIMIT 1").get(id,context().userId) as any;if(!row)throw new Error("No completed transcript was found.");const tools=process.platform==="darwin"?[["pbcopy",[]]]:process.platform==="win32"?[["clip",[]]]:[["wl-copy",[]],["xclip",["-selection","clipboard"]]];for(const [tool,args] of tools as [string,string[]][]){const result=spawnSync(tool,args,{input:row.text,shell:false});if(result.status===0){output({copied:true},"Transcript copied to the clipboard.");return;}}output({copied:false,text:row.text},"Clipboard integration is unavailable. The transcript follows:\n"+row.text);}); transcripts.command("search <query>").action(query=>output(app.repositories.sqlite.prepare("SELECT voice_message_id AS voiceMessageId,text FROM transcriptions WHERE user_id=? AND text LIKE ? ORDER BY created_at DESC").all(context().userId,`%${query}%`)));

const exportCommand=program.command("export"); exportCommand.command("markdown <voice-message-id>").option("--output <path>").option("--force").action((id,options)=>{const result=app.exportMarkdown(context(),id),destination=path.resolve(options.output??result.filename);if(existsSync(destination)&&!options.force)throw new Error("The output file already exists. Use --force to overwrite it.");mkdirSync(path.dirname(destination),{recursive:true});requireWrite(destination,result.content);output({path:destination},`Markdown exported to ${destination}`);}); exportCommand.command("audio <voice-message-id>").option("--output <path>").action((id,options)=>{const audio=app.audio(context(),id),destination=path.resolve(options.output??safeFilename(id,path.extname(audio.filename)));copyFileSync(audio.path,destination);output({path:destination});});
import { writeFileSync as requireWrite } from "node:fs";

const configCommand=program.command("config"); configCommand.command("show").action(()=>{const c=getConfig();output({database:c.databasePath,whisperWorker:c.whisperWorkerUrl,whisperModel:c.whisperModel,whisperDevice:c.whisperDevice,internalToken:maskSecret(c.whisperInternalToken),maximumAudioSizeBytes:c.maxAudioFileSizeBytes,maximumAudioDurationSeconds:c.maxAudioDurationSeconds});}); configCommand.command("validate").action(async()=>{const c=getConfig(),health=await app.whisper.healthCheck();output({valid:true,databaseDirectory:existsSync(path.dirname(c.databasePath)),ffmpeg:spawnSync(c.ffmpegPath,["-version"]).status===0,ffprobe:spawnSync(c.ffprobePath,["-version"]).status===0,whisperWorker:health});}); configCommand.command("path").action(()=>output({path:getConfig().configPath},getConfig().configPath)); configCommand.command("providers").action(()=>output([{type:"whatsapp",enabled:true},{type:"self_hosted_whisper",enabled:true}]));

const db=program.command("db"); db.command("status").action(()=>output(databaseStatus()));db.command("seed").action(()=>output(seedDatabase(app.repositories),"Development data seeded."));db.command("backup").option("--output <path>").action(async options=>{const destination=path.resolve(options.output??`skipthevoice-${new Date().toISOString().slice(0,10)}.db`);await getDatabase().sqlite.backup(destination);output({path:destination},`Database backed up to ${destination}`);});db.command("integrity-check").action(()=>output({result:getDatabase().sqlite.pragma("integrity_check",{simple:true})}));db.command("reset").option("--yes").action(async options=>{if(!options.yes&&!await confirm("Reset the local database and delete all records?"))throw new Error("Operation cancelled.");const filename=getDatabase().sqlite.name;getDatabase().sqlite.close();for(const suffix of ["","-wal","-shm"])if(existsSync(filename+suffix))unlinkSync(filename+suffix);output({reset:true},"Database reset. The final schema will be created automatically on the next start.");});

const worker=program.command("worker");worker.command("status").action(async()=>output({nodeRunner:{queued:(app.repositories.sqlite.prepare("SELECT COUNT(*) count FROM transcription_jobs WHERE status='queued'").get() as any).count},whisperWorker:await app.whisper.healthCheck()}));worker.command("health").action(async()=>output(await app.whisper.healthCheck()));worker.command("jobs").action(()=>output(app.repositories.listJobs(context())));worker.command("recover").action(()=>output({recovered:new JobRunner(app.repositories,app.whisper).recoverStale()}));worker.command("run").option("--once").action(async options=>new JobRunner(app.repositories,app.whisper).run({once:options.once}));

program.parseAsync().catch(fail);
