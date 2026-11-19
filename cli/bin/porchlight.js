#!/usr/bin/env node
// Runs the TypeScript sources directly; Node strips the types at load time.
import { main } from "../src/main.ts";

process.exitCode = await main(process.argv.slice(2));
