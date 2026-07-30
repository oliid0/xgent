import { describe, expect, it } from "vitest";

import { collectCloudArtifacts } from "./cloudArtifacts";
import type { UiRound } from "./uiMessages";

function artifactRound(details: Record<string, unknown>, isError = false): UiRound {
  return {
    round: 0,
    key: "r0",
    blocks: [
      {
        kind: "tool",
        item: {
          toolCall: {
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

describe("collectCloudArtifacts", () => {
  it("collects a successful downloaded artifact", () => {
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

    expect(artifacts).toEqual([
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

  it("ignores failed and incomplete download results", () => {
    expect(
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
    ).toEqual([]);
  });
});
