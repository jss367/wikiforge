# Upgrade Wikiforge Plugin

Update the plugin to the latest version from GitHub.

## Instructions

1. **Find the plugin source directory** by running:
   ```bash
   find ~/.claude/plugins -name "wikiforge" -type d 2>/dev/null | head -1
   ```

2. **Pull the latest changes:**
   ```bash
   cd {plugin_directory} && git pull origin main
   ```

3. **Show what changed** by reading the git log:
   ```bash
   git log --oneline -5
   ```

4. **Tell the user to restart Claude Code** for the changes to take effect:

   > Updated to latest version. Restart Claude Code to load the new commands and hooks.
   > 
   > What's new:
   > {list the new commits since their previous version}

## If git pull fails

If the plugin was installed from marketplace (not a git clone), tell the user:
```
Run: claude plugin update wikiforge
Then restart Claude Code.
```
