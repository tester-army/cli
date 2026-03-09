# Validation Report Template

Use this exact shape in final updates.

Agent default: prefer `--json`. Add `--output` when another step will read the file.

```md
Validation:
- Command: ta run tests/01-landing-page.md --json --output .testerarmy/latest.json
- Result: PASS
- Exit code: 0
- Artifact: .testerarmy/2026-03-09T12-10-10-123Z/result.json
```

If failed:

```md
Validation:
- Command: ta run tests/03-create-project.md --json
- Result: FAILED
- Exit code: 1
- Failure: "Create Project CTA disabled after submit"
- Artifact: .testerarmy/2026-03-09T12-10-10-123Z/
```
