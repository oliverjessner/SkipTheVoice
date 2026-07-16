#!/usr/bin/env node
import { getDatabase, initializeDatabaseSchema } from "../database/connection.js";
import { Repositories } from "../database/repositories.js";
import { SelfHostedWhisperProvider } from "./whisper-provider.js";
import { JobRunner } from "./runner.js";
import { logger } from "../logger.js";

const database=getDatabase(); initializeDatabaseSchema(database.sqlite); const runner=new JobRunner(new Repositories(database.sqlite),new SelfHostedWhisperProvider());
for(const signal of ["SIGINT","SIGTERM"] as const) process.on(signal,()=>{ logger.info({signal},"Stopping job runner"); runner.stop(); });
await runner.run();
