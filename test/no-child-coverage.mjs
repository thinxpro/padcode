// Loaded into every test process with --import. Child processes started by the code under test
// (fake helpers, transcribers, PTY harnesses) are often killed on purpose; if they inherited
// NODE_V8_COVERAGE they could leave truncated coverage files that break the report. The test
// process itself keeps collecting coverage: Node reads the variable at startup.
delete process.env.NODE_V8_COVERAGE;
