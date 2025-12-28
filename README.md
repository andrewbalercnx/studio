# Firebase Studio

This is a NextJS starter in Firebase Studio.

To get started, take a look at src/app/page.tsx.

## Development Workflow

**Local environment** is the single source of truth for code changes.

| Environment | Purpose |
|-------------|---------|
| Local (VSCode + Claude Code) | All code editing and commits |
| Firebase Studio | Deploy, test, and preview only |

### Sync Process

**After making changes locally:**
```bash
git add . && git commit -m "Your message" && git push origin main
```

**In Firebase Studio (to get latest):**
```bash
git pull origin main
```

**Never edit code in Firebase Studio** - always make changes locally and push.
