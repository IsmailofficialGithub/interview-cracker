# Window Resize Implementation Guide

## Step-by-Step Implementation

### Step 1: Disable Window Resizing (Prevent Cursor Changes)

**File:** `src/main/main.js`  
**Location:** `createWindow()` function, BrowserWindow options (around line 32)

**Action:**
1. Open `src/main/main.js`
2. Find the `BrowserWindow` constructor call (line 32)
3. Add `resizable: false` to the options object
4. This will prevent:
   - Window resizing by dragging edges/corners
   - Cursor changes when hovering over window borders

**Code Change:**
```javascript
mainWindow = new BrowserWindow({
  width: 800,
  height: 600,
  minWidth: 600,
  minHeight: 400,
  resizable: false,  // ADD THIS LINE - Prevents drag resizing and cursor changes
  backgroundColor: '#1a1a1a',
  alwaysOnTop: true,
  // ... rest of options
});
```

---

### Step 2: Add Window Resize Functions

**File:** `src/main/main.js`  
**Location:** After `registerGlobalShortcut()` function (around line 416)

**Action:**
1. Create helper functions to handle window resizing and positioning
2. These functions will be called by keyboard shortcuts

**Code to Add:**
```javascript
/**
 * Resize window by a fixed amount
 * @param {number} deltaWidth - Change in width (positive = increase, negative = decrease)
 * @param {number} deltaHeight - Change in height (positive = increase, negative = decrease)
 */
function resizeWindow(deltaWidth, deltaHeight) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  
  const bounds = mainWindow.getBounds();
  const newWidth = Math.max(400, bounds.width + deltaWidth);  // Minimum 400px
  const newHeight = Math.max(300, bounds.height + deltaHeight);  // Minimum 300px
  
  mainWindow.setSize(newWidth, newHeight);
}

/**
 * Move window to a specific position
 * @param {string} direction - 'left', 'right', 'top', 'bottom'
 */
function moveWindow(direction) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  
  const { screen } = require('electron');
  const display = screen.getPrimaryDisplay();
  const workArea = display.workArea;  // Work area excludes taskbar
  const bounds = mainWindow.getBounds();
  
  let newX = bounds.x;
  let newY = bounds.y;
  
  switch (direction) {
    case 'left':
      newX = workArea.x;
      break;
    case 'right':
      newX = workArea.x + workArea.width - bounds.width;
      break;
    case 'top':
      newY = workArea.y;
      break;
    case 'bottom':
      newY = workArea.y + workArea.height - bounds.height;
      break;
  }
  
  mainWindow.setPosition(newX, newY);
}
```

---

### Step 3: Register Keyboard Shortcuts for Resize

**File:** `src/main/main.js`  
**Location:** Inside `registerGlobalShortcut()` function (around line 368)

**Action:**
1. Add shortcuts for increasing/decreasing window size
2. Use `Ctrl+Alt+Plus` and `Ctrl+Alt+Minus` (or `Ctrl+Alt+=` and `Ctrl+Alt+-`)

**Code to Add (inside registerGlobalShortcut function, after quit shortcut):**
```javascript
// Resize Window Shortcuts
const resizeStep = 50;  // Resize by 50px each time

// Increase size: Ctrl+Alt+Plus or Ctrl+Alt+=
const retResizePlus = globalShortcut.register('CommandOrControl+Alt+Plus', () => {
  resizeWindow(resizeStep, resizeStep);
});

if (!retResizePlus) {
  // Try alternative: Ctrl+Alt+=
  globalShortcut.register('CommandOrControl+Alt+=', () => {
    resizeWindow(resizeStep, resizeStep);
  });
}

// Decrease size: Ctrl+Alt+Minus
const retResizeMinus = globalShortcut.register('CommandOrControl+Alt+-', () => {
  resizeWindow(-resizeStep, -resizeStep);
});

if (!retResizeMinus) {
  console.error('Registration failed for resize minus shortcut');
} else {
  console.log('Resize shortcuts registered');
}
```

---

### Step 4: Register Keyboard Shortcuts for Position

**File:** `src/main/main.js`  
**Location:** Inside `registerGlobalShortcut()` function (after resize shortcuts)

**Action:**
1. Add shortcuts for moving window to edges
2. Use `Ctrl+Alt+Left`, `Ctrl+Alt+Right`, `Ctrl+Alt+T`, `Ctrl+Alt+B`

**Code to Add (inside registerGlobalShortcut function, after resize shortcuts):**
```javascript
// Position Window Shortcuts
// Move left: Ctrl+Alt+Left
const retMoveLeft = globalShortcut.register('CommandOrControl+Alt+Left', () => {
  moveWindow('left');
});

// Move right: Ctrl+Alt+Right
const retMoveRight = globalShortcut.register('CommandOrControl+Alt+Right', () => {
  moveWindow('right');
});

// Move top: Ctrl+Alt+T
const retMoveTop = globalShortcut.register('CommandOrControl+Alt+T', () => {
  moveWindow('top');
});

// Move bottom: Ctrl+Alt+B
const retMoveBottom = globalShortcut.register('CommandOrControl+Alt+B', () => {
  moveWindow('bottom');
});

if (!retMoveLeft || !retMoveRight || !retMoveTop || !retMoveBottom) {
  console.error('Some position shortcuts failed to register');
} else {
  console.log('Position shortcuts registered');
}
```

---

### Step 5: Temporarily Enable Resizing for Programmatic Changes

**File:** `src/main/main.js`  
**Location:** Inside `resizeWindow()` and `moveWindow()` functions

**Action:**
1. Temporarily enable resizing when programmatically changing size
2. Disable it again after the change
3. This ensures programmatic resizing works even when `resizable: false`

**Code Update for `resizeWindow()` function:**
```javascript
function resizeWindow(deltaWidth, deltaHeight) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  
  // Temporarily enable resizing for programmatic changes
  mainWindow.setResizable(true);
  
  const bounds = mainWindow.getBounds();
  const newWidth = Math.max(400, bounds.width + deltaWidth);
  const newHeight = Math.max(300, bounds.height + deltaHeight);
  
  mainWindow.setSize(newWidth, newHeight);
  
  // Disable resizing again after change
  mainWindow.setResizable(false);
}
```

**Note:** `moveWindow()` doesn't need this since moving doesn't require resizable to be enabled.

---

### Step 6: Test the Implementation

**Testing Checklist:**
1. ✅ Window cannot be resized by dragging edges/corners
2. ✅ Cursor does NOT change when hovering over window borders
3. ✅ `Ctrl+Alt+Plus` increases window size
4. ✅ `Ctrl+Alt+Minus` decreases window size
5. ✅ `Ctrl+Alt+Left` moves window to left edge
6. ✅ `Ctrl+Alt+Right` moves window to right edge
7. ✅ `Ctrl+Alt+T` moves window to top edge
8. ✅ `Ctrl+Alt+B` moves window to bottom edge
9. ✅ Window stays hidden from taskbar (already working)

---

## Complete Code Structure

### Summary of Changes:

1. **Line ~35:** Add `resizable: false` to BrowserWindow options
2. **After line 416:** Add `resizeWindow()` and `moveWindow()` helper functions
3. **Inside `registerGlobalShortcut()` function:** Add resize and position shortcut registrations

### Files to Modify:
- `src/main/main.js` (all changes in this file)

### Dependencies:
- No new dependencies required
- Uses existing Electron APIs: `globalShortcut`, `screen`, `BrowserWindow.setSize()`, `BrowserWindow.setPosition()`, `BrowserWindow.setResizable()`

---

## Notes:

- **Resize Step Size:** Currently set to 50px. You can adjust the `resizeStep` variable if needed.
- **Minimum Size:** Window cannot be resized below 400x300px (adjustable in `resizeWindow()` function).
- **Work Area:** Position shortcuts use `workArea` which excludes taskbar, so window won't overlap with taskbar.
- **Cross-Platform:** Uses `CommandOrControl` which works on both Windows (`Ctrl`) and macOS (`Cmd`).
