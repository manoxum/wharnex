# Error Model SoT

Errors crossing the HTTP boundary use:

```json
{"error":{"code":"stable_code","message":"human readable message"}}
```

Do not return raw secrets, environment dumps, provider authorization headers, or full internal stack traces.
