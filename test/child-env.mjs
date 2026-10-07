// Subprocess environment for PTY harnesses. They start and deliberately kill many Node processes;
// a process killed while writing V8 coverage leaves a truncated file that breaks the coverage report.
export function childEnv(extra = {}) {
  const env = { ...process.env, ...extra };
  delete env.NODE_V8_COVERAGE;
  return env;
}
