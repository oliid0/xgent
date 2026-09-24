import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

test("Skill install jobs can be listed after leaving the store page", async () => {
  const calls = [];
  const jobs = [{ jobId: "job-1", phase: "downloading", slug: "github", ownerHandle: "acme" }];
  const loader = createTsModuleLoader({
    mocks: {
      "@xgent/runtime": {
        invoke: async (command, args) => {
          calls.push({ command, args });
          return { action: "install_jobs", rootDir: "/skills", installJobs: jobs };
        },
      },
    },
  });
  const { listSkillInstallJobs } = loader.loadModule("src/lib/skills/index.ts");

  assert.deepEqual(await listSkillInstallJobs(), jobs);
  assert.deepEqual(calls, [{ command: "system_manage_skill", args: { payload: { action: "install_jobs" } } }]);
});
