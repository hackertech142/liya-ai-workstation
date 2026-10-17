# Skill: Terminal_Nexus
## Description:
Direct system access via sandboxed command execution and filesystem tools. This allows Liya to run scripts, manipulate files, and inspect system environments safely.

## Tools to Use:
1. **`run_command`**: Execute a shell command:
   - `command`: The exact command string (e.g. `npm run build`, `python test.py`, `dir`)
   - `cwd`: (Optional) Working directory path
2. **`read_file`**: Read content of a file (`filePath`)
3. **`write_file`**: Create or edit a file (`targetPath`, `content`)
4. **`list_directory`**: List directory files and folders (`dirPath`)

## Safety Rules:
1. **Scope Limit**: Only perform actions within the project workspace unless explicitly authorized.
2. **Prohibited Commands**: Never run destructive system-level commands like `rm -rf /` or formatted disk wipes.
3. **Verbose Output**: Always inspect output to verify execution success.
4. **Citability**: Reference created files clearly for the user.

