import { createTuiApp } from "./tui/app";

const command = process.argv[2];

if (!command) {
  await createTuiApp();
} else {
  console.error("Non-interactive commands are not implemented yet in Phase 1.");
  console.error("Available command:");
  console.error("  tester-army" );
  process.exit(2);
}
