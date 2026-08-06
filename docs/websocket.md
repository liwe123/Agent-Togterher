# Workspace WebSocket

Connect to one workspace at:

```text
ws://localhost:8000/ws/workspaces/{workspace_id}
```

Every server event has the same envelope:

```json
{
  "type": "message.created",
  "payload": {}
}
```

Supported event types are `message.created`, `agent.status_changed`,
`task.status_changed`, `task.step_changed`, `model.call_finished`, and `error`.
An `error` payload always contains a `message` string. `task.step_changed`
contains the persisted step id, task/Agent ids, step name, input/output, status,
and start/finish timestamps.

A successful user-message POST emits `message.created` first, followed by
`task.status_changed` for the automatically created `pending` task. Both events
are sent only to clients subscribed to that conversation's workspace.

Running that task through `POST /api/tasks/{task_id}/run` emits Agent and task
`running` status events, `task.step_changed` for every running/completed or
failed stage, a `model.call_finished` event for every model call, terminal task
and Agent status events, and the generated `message.created` events. Manager
tasks display plan, Worker results, review, and final summary as separate chat
messages. A failed run ends with task/Agent `failed`, an Agent error message,
and an `error` event.

## React / TypeScript example

```tsx
import { useEffect } from "react";

type WorkspaceEvent =
  | { type: "message.created"; payload: Record<string, unknown> }
  | { type: "agent.status_changed"; payload: Record<string, unknown> }
  | { type: "task.status_changed"; payload: Record<string, unknown> }
  | { type: "task.step_changed"; payload: Record<string, unknown> }
  | { type: "model.call_finished"; payload: Record<string, unknown> }
  | { type: "error"; payload: { message: string } };

export function useWorkspaceEvents(workspaceId: number) {
  useEffect(() => {
    const socket = new WebSocket(
      `ws://localhost:8000/ws/workspaces/${workspaceId}`,
    );

    socket.onmessage = (message) => {
      const event = JSON.parse(message.data) as WorkspaceEvent;

      switch (event.type) {
        case "message.created":
          console.log("new message", event.payload);
          break;
        case "agent.status_changed":
          console.log("agent status", event.payload);
          break;
        case "task.status_changed":
          console.log("task status", event.payload);
          break;
        case "task.step_changed":
          console.log("task step", event.payload);
          break;
        case "model.call_finished":
          console.log("model result", event.payload);
          break;
        case "error":
          console.error(event.payload.message);
          break;
      }
    };

    socket.onerror = () => console.error("WebSocket connection failed");
    return () => socket.close();
  }, [workspaceId]);
}
```

For a deployed HTTPS frontend, use `wss://` and the deployed backend host.
`POST /api/models/test` only broadcasts model result/error events when its JSON
body includes the target `workspace_id`; calls without it remain valid but do
not emit a workspace event.
