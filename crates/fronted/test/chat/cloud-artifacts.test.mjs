import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const loader = createTsModuleLoader();
const { collectCloudArtifacts } = loader.loadModule("src/lib/chat/messages/cloudArtifacts.ts");

function artifactRound(details, isError = false) {
  return {
    round: 0,
    key: "r0",
    blocks: [
      {
        kind: "tool",
        item: {
          toolCall: {
            type: "toolCall",
            id: "cloud-1",
            name: "CloudTaskManager",
            arguments: { action: "download_artifact" },
          },
          toolResult: {
            role: "toolResult",
            toolCallId: "cloud-1",
            toolName: "CloudTaskManager",
            content: [{ type: "text", text: "downloaded" }],
            details,
            isError,
            timestamp: 1,
          },
        },
      },
    ],
  };
}

test("collectCloudArtifacts returns successful downloaded artifacts", () => {
  const artifacts = collectCloudArtifacts([
    artifactRound({
      kind: "cloud_task_manager",
      action: "download_artifact",
      taskId: "task-1",
      artifactId: 42,
      artifactName: "xagent-task-1",
      localPath: "C:\\workspace\\xagent-task-1.zip",
      sizeBytes: 2048,
    }),
  ]);

  assert.deepEqual(artifacts, [
    {
      taskId: "task-1",
      artifactId: 42,
      artifactName: "xagent-task-1",
      localPath: "C:\\workspace\\xagent-task-1.zip",
      sizeBytes: 2048,
      toolCallId: "cloud-1",
    },
  ]);
});

test("collectCloudArtifacts ignores failed and incomplete downloads", () => {
  assert.deepEqual(
    collectCloudArtifacts([
      artifactRound(
        {
          action: "download_artifact",
          taskId: "task-1",
          artifactId: 42,
          artifactName: "xagent-task-1",
          localPath: "artifact.zip",
          sizeBytes: 10,
        },
        true,
      ),
      artifactRound({ action: "download_artifact", taskId: "task-2" }),
    ]),
    [],
  );
});
