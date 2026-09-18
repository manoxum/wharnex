# Threat Model

## Primary threats

- prompt injection embedded in source/docs;
- model hallucination producing destructive commands;
- path traversal in patches/cwd;
- symlink escape from workspace;
- credential exfiltration;
- network-based payload download;
- privilege escalation;
- fork bombs / resource exhaustion;
- host Docker socket abuse;
- unsafe command composition;
- applying unverified patches to the real project.

## V1 mitigations

- repository content is explicitly labeled untrusted;
- structured argv only;
- dangerous executables denied;
- relative cwd validation;
- patch path scanning plus `git apply --check`;
- network none by default;
- resource-limited runner;
- isolated copy;
- informed execution approval before the Protected run, with host integration permitted only after successful verification and no second Apply approval;
- secret/path filtering before context export.

## Residual risks

Docker is not a perfect security boundary. Supply-chain behavior of build/test tooling may also be hostile. High-assurance deployments should use a dedicated VM/rootless daemon and stronger filesystem/network mediation.


## Desktop-specific threats and mitigations (v1.2)

Additional threats include remote ChatGPT renderer compromise, privilege leakage through preload/IPC, arbitrary local URL fetch through clipboard actions, remote permission abuse, native-view click interception, and persistence of sensitive web-session cookies.

Mitigations: no preload or Node integration in the ChatGPT view; sandbox/context isolation/web security enabled; dedicated partition; deny-by-default remote permissions; trusted local frontend origin enforcement; IPC sender validation; session-ID allowlisting; backend URL derived in main process; context bundle size/signature checks; native view hidden outside its reserved tab; no DOM/cookie/output extraction.

Residual risk: ChatGPT and third-party login providers may change their web flows or reject embedded browser user agents. The desktop shell must fail visibly and retain the browser/manual or API-provider fallback rather than weakening isolation settings.

## Interactive v2 threats and mitigations

Interactive v2 adds deliberate host/runtime inspection surfaces and therefore treats every capability as a separate trust boundary. Arbitrary shell composition, SQL credential disclosure, filesystem symlink escape, process signalling, container/service control, network reachability and secret-bearing logs are mitigated with typed payloads, closed capability declaration, explicit scope, runtime scope revalidation, exact-script temporary files instead of shell interpolation, engine-owned database handles, read-only SQL defaults with limits, allowlisted signals/actions, bounded/redacted output, and Policy-gated consent. Modify operations require high-risk one-shot approval tied to the exact plan/digest; outputs remain untrusted and cannot widen subsequent authority.
