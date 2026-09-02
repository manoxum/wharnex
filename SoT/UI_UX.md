# UI/UX SoT

Wharness is an engineering workspace, not a chatbot skin.

- two-column desktop workspace with chat on the left and execution intelligence on the right;
- information-dense but calm visual hierarchy;
- no decorative gradients/glow-heavy "AI" styling;
- keyboard-accessible controls, visible focus, semantic labels;
- execution state must be understandable without relying only on color;
- destructive/apply actions are visually distinct and require explicit intent;
- mobile layout stacks panels without hiding execution state.

## Workspace modes (v1.1)

The workspace has two first-class modes:

- **Editor**: safe project Explorer, text editor, and persistent Docker-sandbox terminal.
- **Agent**: harness chat, plan/policy inspector, execution logs, and ChatGPT/OpenAI provider panel.

The active workspace, project path, mode, recent workspaces, and local chat transcript are remembered in browser local storage. On reload the frontend first resumes the live session; if the backend was restarted and the in-memory session disappeared, it reopens the remembered project and creates a fresh session automatically.


## Desktop ChatGPT composition (v1.2)

Wharness Desktop composes the real ChatGPT web surface inside the Agent inspector using a native Electron `WebContentsView`. The ChatGPT tab must preserve the same engineering-workspace identity as the rest of Wharness and provide compact browser controls plus a three-step manual handoff: copy context ZIP, copy prompt, import response JSON.

The native ChatGPT view occupies only the explicitly reserved viewport. It must be hidden when the tab is not active so that remote content never overlays Editor, plan, terminal, or other Wharness controls.

## Multi-chat conversation model (v1.2.6)

The Agent surface supports multiple Harness chats within the same workspace. A compact chat switcher must expose the active chat, create a new chat, and indicate whether each Harness chat already has a linked ChatGPT conversation. Each chat keeps its own Harness transcript and orchestration session.

The ChatGPT panel has one-to-one conversation affinity with the active Harness chat. Selecting a linked Harness chat automatically restores its `chatgpt.com/c/...` conversation. An unlinked chat opens the ChatGPT new-chat surface and binds the first concrete conversation URL created for it. Existing bindings are not silently replaced when the user browses another ChatGPT conversation; the UI exposes an explicit rebind action.
