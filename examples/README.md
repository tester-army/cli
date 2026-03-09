# Examples

Starter examples for real `ta` usage.

## Layout

```text
examples/
├── TESTER.md
├── prompts/
│   └── ad-hoc-regression.md
└── tests/
    ├── 01-landing-page.md
    ├── 02-auth-smoke.md
    └── 03-project-create.md
```

## Run

```bash
export TESTERARMY_TARGET_URL="http://localhost:3000"

# one test
ta run examples/tests/01-landing-page.md

# whole directory
ta run examples/tests/ --parallel 3

# ad hoc prompt
ta run "$(cat examples/prompts/ad-hoc-regression.md)" --url "$TESTERARMY_TARGET_URL"
```
