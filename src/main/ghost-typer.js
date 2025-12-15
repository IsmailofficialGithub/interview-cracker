const { clipboard } = require('electron');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

// QWERTY neighbor map for "fat finger" simulation
const neighborMap = {
    'q': 'w', 'w': 'e', 'e': 'r', 'r': 't', 't': 'y', 'y': 'u', 'u': 'i', 'i': 'o', 'o': 'p', 'p': 'o',
    'a': 's', 's': 'd', 'd': 'f', 'f': 'g', 'g': 'h', 'h': 'j', 'j': 'k', 'k': 'l', 'l': 'k',
    'z': 'x', 'x': 'c', 'c': 'v', 'v': 'b', 'b': 'n', 'n': 'm', 'm': 'n',
    // Caps
    'Q': 'W', 'W': 'E', 'E': 'R', 'R': 'T', 'T': 'Y', 'Y': 'U', 'U': 'I', 'I': 'O', 'O': 'P', 'P': 'O',
    'A': 'S', 'S': 'D', 'D': 'F', 'F': 'G', 'G': 'H', 'H': 'J', 'J': 'K', 'K': 'L', 'L': 'K',
    'Z': 'X', 'X': 'C', 'C': 'V', 'V': 'B', 'B': 'N', 'N': 'M', 'M': 'N'
};

class GhostTyper {
    constructor() {
        this.isTyping = false;
        this.process = null;
    }

    async typeClipboard() {
        if (this.isTyping) {
            console.log('GhostTyper: Already typing, ignoring request.');
            return;
        }

        const text = clipboard.readText();
        if (!text) {
            console.log('GhostTyper: Clipboard empty.');
            return;
        }

        this.isTyping = true;
        console.log(`GhostTyper: Starting to type ${text.length} chars...`);

        try {
            await this.runPowerShellTyper(text);
        } catch (error) {
            console.error('GhostTyper error:', error);
        } finally {
            this.isTyping = false;
        }
    }

    stop() {
        if (this.process) {
            console.log('GhostTyper: Stopping...');
            this.process.kill();
            this.process = null;
            this.isTyping = false;
        }
    }

    async runPowerShellTyper(text, wpm = 50) {
        // Escape text for PowerShell string
        // We will write the text to a temporary file instead of passing as arg to avoid escaping issues
        const tempFile = path.join(os.tmpdir(), `ghost-type-${Date.now()}.txt`);
        fs.writeFileSync(tempFile, text, 'utf8');

        // Calculate delay based on WPM
        // Average word is 5 chars. WPM = (Chars/5) / Minute
        // Chars/Minute = WPM * 5
        // ms/Char = 60000 / (WPM * 5)
        // Example: 60 WPM -> 300 CPM -> 200ms per char
        // We want a base delay slightly faster because of overhead, say 0.7 factor
        const msPerChar = Math.round(60000 / (wpm * 5));
        const baseDelay = Math.max(10, Math.round(msPerChar * 0.7));

        // PowerShell script to simulate human typing
        const psScript = `
      Add-Type -AssemblyName System.Windows.Forms
      
      # P/Invoke to check ESC key state asynchronously
      $code = @'
      using System;
      using System.Runtime.InteropServices;
      public class KeyTools {
        [DllImport("user32.dll")]
        public static extern short GetAsyncKeyState(int vKey);
      }
'@
      Add-Type -TypeDefinition $code -Language CSharp

      $text = Get-Content -Path "${tempFile}" -Raw
      
      # Cleanup temp file instantly
      Remove-Item -Path "${tempFile}"

      if (-not $text) { exit }

      # Config
      $baseDelay = ${baseDelay}
      $errorRate = 5 # 5% chance
      $rng = New-Object Random

      # Neighbor map (simplified inline)
      $neighbors = @{
        'a'='s'; 'b'='n'; 'c'='v'; 'd'='f'; 'e'='r'; 'f'='g'; 'g'='h'; 'h'='j'; 'i'='o'; 
        'j'='k'; 'k'='l'; 'l'='k'; 'm'='n'; 'n'='m'; 'o'='p'; 'p'='o'; 'q'='w'; 'r'='t'; 
        's'='d'; 't'='y'; 'u'='i'; 'v'='b'; 'w'='e'; 'x'='c'; 'y'='u'; 'z'='x'
      }

      # Helper for SendWait with escaping
      function Send-Key($char) {
        $special = "{}+^%~()[]"
        if ($special.IndexOf($char) -ge 0) {
          $char = "{$char}"
        }
        # Handle newlines
        if ($char -eq "\r") { return } 
        if ($char -eq "\n") { $char = "{ENTER}" }
        
        [System.Windows.Forms.SendKeys]::SendWait($char)
      }

      $chars = $text.ToCharArray()
      
      foreach ($c in $chars) {
        # Check ESC key (VK_ESCAPE = 0x1B)
        if ([KeyTools]::GetAsyncKeyState(0x1B) -ne 0) {
            Write-Host "ESC detected, stopping..."
            exit
        }

        $charStr = $c.ToString()
        
        # 1. Mistake Logic (Scaled by speed: mistakes are rarer if typing very fast to keep flow)
        if ($rng.Next(0, 100) -lt $errorRate -and $charStr -match "[a-zA-Z]") {
            $lower = $charStr.ToLower()
            if ($neighbors.ContainsKey($lower)) {
                $wrong = $neighbors[$lower]
                Send-Key $wrong
                Start-Sleep -Milliseconds ($rng.Next(150, 400)) # Realization pause
                [System.Windows.Forms.SendKeys]::SendWait("{BACKSPACE}")
                Start-Sleep -Milliseconds ($rng.Next(50, 150)) # Correction pause
            }
        }

        # 2. Type Correct Key
        Send-Key $charStr

        # 3. Random Delay based on Calculated Speed
        # Variance is +/- 40% of base delay
        $variance = [math]::Round($baseDelay * 0.4)
        $delay = $baseDelay + $rng.Next(-$variance, $variance)
        
        # Slower on spaces or punctuation
        if ($charStr -match "[ .,\n]") { $delay += [math]::Round($baseDelay * 0.5) }
        
        # Clamp min delay
        if ($delay -lt 5) { $delay = 5 }

        Start-Sleep -Milliseconds $delay
      }
    `;

        // Write PS script to temp file
        const psFile = path.join(os.tmpdir(), `ghost-script-${Date.now()}.ps1`);
        fs.writeFileSync(psFile, psScript, 'utf8');

        return new Promise((resolve, reject) => {
            // Spawn PowerShell
            // -WindowStyle Hidden to avoid popping up a terminal window
            this.process = spawn('powershell.exe', [
                '-NoProfile',
                '-ExecutionPolicy', 'Bypass',
                '-WindowStyle', 'Hidden',
                '-File', psFile
            ]);

            this.process.on('close', (code) => {
                // Cleanup script file
                try { fs.unlinkSync(psFile); } catch (e) { } // ignore

                if (code === 0) resolve();
                else reject(new Error(`PowerShell exited with code ${code}`));
            });

            this.process.on('error', (err) => {
                try { fs.unlinkSync(psFile); } catch (e) { }
                reject(err);
            });
        });
    }
}

module.exports = new GhostTyper();
