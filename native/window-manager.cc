#include <napi.h>
#include <windows.h>
#include <psapi.h>
#include <tlhelp32.h>
#include <string>
#include <vector>
#include "app-discovery.h"

// Helper function to convert std::string to Napi::String
static Napi::String StringToNapi(const Napi::Env& env, const std::string& str) {
  return Napi::String::New(env, str.c_str());
}

// Helper function to get error message from Windows error code
std::string GetLastErrorString() {
  DWORD error = GetLastError();
  if (error == 0) return "Unknown error";
  
  LPSTR messageBuffer = nullptr;
  size_t size = FormatMessageA(
    FORMAT_MESSAGE_ALLOCATE_BUFFER | FORMAT_MESSAGE_FROM_SYSTEM | FORMAT_MESSAGE_IGNORE_INSERTS,
    NULL, error, MAKELANGID(LANG_NEUTRAL, SUBLANG_DEFAULT),
    (LPSTR)&messageBuffer, 0, NULL);
  
  std::string message(messageBuffer, size);
  LocalFree(messageBuffer);
  return message;
}

// Helper function to find main window of a process
HWND FindMainWindow(DWORD processId) {
  HWND hwnd = NULL;
  struct EnumData {
    DWORD processId;
    HWND hwnd;
    HWND bestHwnd; // Fallback: any window from process
  } enumData = { processId, NULL, NULL };
  
  EnumWindows([](HWND hwnd, LPARAM lParam) -> BOOL {
    EnumData* data = (EnumData*)lParam;
    DWORD windowProcessId;
    GetWindowThreadProcessId(hwnd, &windowProcessId);
    
    if (windowProcessId == data->processId) {
      char className[256];
      GetClassNameA(hwnd, className, sizeof(className));
      
      // Skip system windows
      if (strcmp(className, "Shell_TrayWnd") == 0 ||
          strcmp(className, "Button") == 0 ||
          strcmp(className, "Progman") == 0 ||
          strcmp(className, "Shell_SecondaryTrayWnd") == 0) {
        return TRUE; // Continue
      }
      
      // Prefer visible windows with no parent (main windows)
      if (IsWindowVisible(hwnd) && GetParent(hwnd) == NULL) {
        // Check if it has a title or caption style (likely a real app window)
        char title[256];
        GetWindowTextA(hwnd, title, sizeof(title));
        LONG style = GetWindowLong(hwnd, GWL_STYLE);
        if (strlen(title) > 0 || (style & WS_CAPTION) || (style & WS_BORDER)) {
          data->hwnd = hwnd;
          return FALSE; // Stop enumeration - found good window
        }
      }
      
      // Store any window from this process as fallback (even if not visible yet)
      if (data->bestHwnd == NULL && IsWindow(hwnd)) {
        // Skip tool windows and popups
        LONG exStyle = GetWindowLong(hwnd, GWL_EXSTYLE);
        if (!(exStyle & WS_EX_TOOLWINDOW)) {
          data->bestHwnd = hwnd;
        }
      }
    }
    return TRUE; // Continue enumeration
  }, (LPARAM)&enumData);
  
  // Return best match, or fallback to any window
  return enumData.hwnd ? enumData.hwnd : enumData.bestHwnd;
}

// LaunchApplication: Launch an app and return process ID and window handle
Napi::Object LaunchApplication(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  
  if (info.Length() < 2 || !info[0].IsString() || !info[1].IsNumber()) {
    Napi::TypeError::New(env, "Expected (exePath: string, parentHWND: number)").ThrowAsJavaScriptException();
    return Napi::Object::New(env);
  }
  
  std::string exePath = info[0].As<Napi::String>().Utf8Value();
  intptr_t parentHWND = info[1].As<Napi::Number>().Int64Value();
  
  Napi::Object result = Napi::Object::New(env);
  
  // Launch process
  STARTUPINFOA si = {0};
  si.cb = sizeof(si);
  PROCESS_INFORMATION pi = {0};
  
  char* cmdLine = new char[exePath.length() + 1];
  strcpy_s(cmdLine, exePath.length() + 1, exePath.c_str());
  
  BOOL success = CreateProcessA(
    NULL,           // Application name
    cmdLine,        // Command line
    NULL,           // Process security attributes
    NULL,           // Thread security attributes
    FALSE,          // Inherit handles
    0,              // Creation flags
    NULL,           // Environment
    NULL,           // Current directory
    &si,            // Startup info
    &pi             // Process information
  );
  
  delete[] cmdLine;
  
  if (!success) {
    result.Set("success", Napi::Boolean::New(env, false));
    result.Set("error", StringToNapi(env, "Failed to launch process: " + GetLastErrorString()));
    return result;
  }
  
  CloseHandle(pi.hThread);
  
  // Return immediately - let JS handle the waiting
  result.Set("success", Napi::Boolean::New(env, true));
  result.Set("processId", Napi::Number::New(env, pi.dwProcessId));
  result.Set("processHandle", Napi::Number::New(env, (intptr_t)pi.hProcess));
  
  return result;
}

// EmbedWindow: Embed a window into parent window
Napi::Object EmbedWindow(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  
  if (info.Length() < 6 || !info[0].IsNumber() || !info[1].IsNumber() ||
      !info[2].IsNumber() || !info[3].IsNumber() || !info[4].IsNumber() || !info[5].IsNumber()) {
    Napi::TypeError::New(env, "Expected (hwnd: number, parentHWND: number, x: number, y: number, width: number, height: number)").ThrowAsJavaScriptException();
    return Napi::Object::New(env);
  }
  
  HWND hwnd = (HWND)(intptr_t)info[0].As<Napi::Number>().Int64Value();
  HWND parentHWND = (HWND)(intptr_t)info[1].As<Napi::Number>().Int64Value();
  int x = info[2].As<Napi::Number>().Int32Value();
  int y = info[3].As<Napi::Number>().Int32Value();
  int width = info[4].As<Napi::Number>().Int32Value();
  int height = info[5].As<Napi::Number>().Int32Value();
  
  Napi::Object result = Napi::Object::New(env);
  
  if (!IsWindow(hwnd)) {
    result.Set("success", Napi::Boolean::New(env, false));
    result.Set("error", StringToNapi(env, "Invalid window handle"));
    return result;
  }
  
  // First, ensure window is visible and not minimized
  ShowWindow(hwnd, SW_SHOW);
  BringWindowToTop(hwnd);
  SetForegroundWindow(hwnd);
  
  // Reparent window (this is what actually embeds it)
  HWND oldParent = SetParent(hwnd, parentHWND);
  if (oldParent == NULL && GetLastError() != 0) {
    DWORD error = GetLastError();
    // ERROR_INVALID_PARAMETER (87) might mean the app refuses embedding
    if (error == 87) {
      result.Set("success", Napi::Boolean::New(env, false));
      result.Set("error", StringToNapi(env, "Application refuses window embedding (security restriction)"));
      return result;
    }
    result.Set("success", Napi::Boolean::New(env, false));
    result.Set("error", StringToNapi(env, "Failed to set parent: " + GetLastErrorString()));
    return result;
  }
  
  // Verify window still exists after SetParent (some apps close when reparented)
  if (!IsWindow(hwnd)) {
    result.Set("success", Napi::Boolean::New(env, false));
    result.Set("error", StringToNapi(env, "Window closed immediately after embedding (app may not support embedding)"));
    return result;
  }
  
  // Modify window styles more carefully - only after successful reparenting
  // First, try minimal changes to avoid triggering app security checks
  LONG originalStyle = GetWindowLongW(hwnd, GWL_STYLE);
  LONG originalExStyle = GetWindowLongW(hwnd, GWL_EXSTYLE);
  
  // Check if window is still valid after SetParent
  if (!IsWindow(hwnd)) {
    result.Set("success", Napi::Boolean::New(env, false));
    result.Set("error", StringToNapi(env, "Window closed immediately after SetParent (app security restriction)"));
    return result;
  }
  
  // Try to modify styles gradually - some apps close if we change too much at once
  LONG style = originalStyle;
  LONG exStyle = originalExStyle;
  
  // Remove minimize/maximize buttons and system menu, but keep caption for title bar
  // Keep WS_CAPTION to show title bar
  style &= ~(WS_THICKFRAME | WS_MINIMIZEBOX | WS_MAXIMIZEBOX | WS_SYSMENU | WS_POPUP);
  style |= WS_CHILD | WS_VISIBLE;
  
  // Only add caption if it wasn't there, to preserve original look
  if (originalStyle & WS_CAPTION) {
    style |= WS_CAPTION | WS_BORDER;
  } else {
    // If no caption originally, add border for visual separation
    style |= WS_BORDER;
  }
  
  exStyle &= ~(WS_EX_DLGMODALFRAME | WS_EX_WINDOWEDGE | WS_EX_CLIENTEDGE | WS_EX_STATICEDGE);
  
  // Apply style changes
  SetWindowLongW(hwnd, GWL_STYLE, style);
  SetWindowLongW(hwnd, GWL_EXSTYLE, exStyle);
  
  // Verify window still exists after style changes
  if (!IsWindow(hwnd)) {
    result.Set("success", Napi::Boolean::New(env, false));
    result.Set("error", StringToNapi(env, "Window closed after style modification (app may not support embedding)"));
    return result;
  }
  
  // Position and resize window
  BOOL posSuccess = SetWindowPos(
    hwnd,
    HWND_TOP,
    x, y,
    width, height,
    SWP_SHOWWINDOW | SWP_FRAMECHANGED | SWP_NOZORDER
  );
  
  if (!posSuccess) {
    result.Set("success", Napi::Boolean::New(env, false));
    result.Set("error", StringToNapi(env, "Failed to position window: " + GetLastErrorString()));
    return result;
  }
  
  // Verify window is still valid after all operations
  if (!IsWindow(hwnd)) {
    result.Set("success", Napi::Boolean::New(env, false));
    result.Set("error", StringToNapi(env, "Window closed during embedding process"));
    return result;
  }
  
  // Force repaint and ensure visibility
  ShowWindow(hwnd, SW_SHOW);
  BringWindowToTop(hwnd);
  InvalidateRect(hwnd, NULL, TRUE);
  UpdateWindow(hwnd);
  RedrawWindow(hwnd, NULL, NULL, RDW_UPDATENOW | RDW_ALLCHILDREN);
  
  result.Set("success", Napi::Boolean::New(env, true));
  return result;
}

// ShowWindow: Show or hide a window
Napi::Object ShowWindowNative(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  
  if (info.Length() < 2 || !info[0].IsNumber() || !info[1].IsBoolean()) {
    Napi::TypeError::New(env, "Expected (hwnd: number, show: boolean)").ThrowAsJavaScriptException();
    return Napi::Object::New(env);
  }
  
  HWND hwnd = (HWND)(intptr_t)info[0].As<Napi::Number>().Int64Value();
  bool show = info[1].As<Napi::Boolean>().Value();
  
  Napi::Object result = Napi::Object::New(env);
  
  if (!IsWindow(hwnd)) {
    result.Set("success", Napi::Boolean::New(env, false));
    result.Set("error", StringToNapi(env, "Invalid window handle"));
    return result;
  }
  
  BOOL success = ::ShowWindow(hwnd, show ? SW_SHOW : SW_HIDE);
  
  result.Set("success", Napi::Boolean::New(env, success != FALSE));
  if (!success) {
    result.Set("error", StringToNapi(env, GetLastErrorString()));
  }
  
  return result;
}

// ResizeWindow: Resize and position a window
Napi::Object ResizeWindow(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  
  if (info.Length() < 5 || !info[0].IsNumber() || !info[1].IsNumber() ||
      !info[2].IsNumber() || !info[3].IsNumber() || !info[4].IsNumber()) {
    Napi::TypeError::New(env, "Expected (hwnd: number, x: number, y: number, width: number, height: number)").ThrowAsJavaScriptException();
    return Napi::Object::New(env);
  }
  
  HWND hwnd = (HWND)(intptr_t)info[0].As<Napi::Number>().Int64Value();
  int x = info[1].As<Napi::Number>().Int32Value();
  int y = info[2].As<Napi::Number>().Int32Value();
  int width = info[3].As<Napi::Number>().Int32Value();
  int height = info[4].As<Napi::Number>().Int32Value();
  
  Napi::Object result = Napi::Object::New(env);
  
  if (!IsWindow(hwnd)) {
    result.Set("success", Napi::Boolean::New(env, false));
    result.Set("error", StringToNapi(env, "Invalid window handle"));
    return result;
  }
  
  BOOL success = SetWindowPos(
    hwnd,
    HWND_TOP,
    x, y,
    width, height,
    SWP_SHOWWINDOW
  );
  
  result.Set("success", Napi::Boolean::New(env, success != FALSE));
  if (!success) {
    result.Set("error", StringToNapi(env, GetLastErrorString()));
  }
  
  return result;
}

// MoveWindowNative: Move a window to new position (without resizing)
Napi::Object MoveWindowNative(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  
  if (info.Length() < 3 || !info[0].IsNumber() || !info[1].IsNumber() || !info[2].IsNumber()) {
    Napi::TypeError::New(env, "Expected (hwnd: number, x: number, y: number)").ThrowAsJavaScriptException();
    return Napi::Object::New(env);
  }
  
  HWND hwnd = (HWND)(intptr_t)info[0].As<Napi::Number>().Int64Value();
  int x = info[1].As<Napi::Number>().Int32Value();
  int y = info[2].As<Napi::Number>().Int32Value();
  
  Napi::Object result = Napi::Object::New(env);
  
  if (!IsWindow(hwnd)) {
    result.Set("success", Napi::Boolean::New(env, false));
    result.Set("error", StringToNapi(env, "Invalid window handle"));
    return result;
  }
  
  // Get current window size to preserve it
  RECT rect;
  if (!GetWindowRect(hwnd, &rect)) {
    result.Set("success", Napi::Boolean::New(env, false));
    result.Set("error", StringToNapi(env, "Failed to get window size: " + GetLastErrorString()));
    return result;
  }
  
  int width = rect.right - rect.left;
  int height = rect.bottom - rect.top;
  
  BOOL success = SetWindowPos(
    hwnd,
    HWND_TOP,
    x, y,
    width, height,
    SWP_NOSIZE | SWP_SHOWWINDOW
  );
  
  result.Set("success", Napi::Boolean::New(env, success != FALSE));
  if (!success) {
    result.Set("error", StringToNapi(env, GetLastErrorString()));
  }
  
  return result;
}

// UnparentWindow: Restore window to desktop
Napi::Object UnparentWindow(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  
  if (info.Length() < 1 || !info[0].IsNumber()) {
    Napi::TypeError::New(env, "Expected (hwnd: number)").ThrowAsJavaScriptException();
    return Napi::Object::New(env);
  }
  
  HWND hwnd = (HWND)(intptr_t)info[0].As<Napi::Number>().Int64Value();
  
  Napi::Object result = Napi::Object::New(env);
  
  if (!IsWindow(hwnd)) {
    result.Set("success", Napi::Boolean::New(env, false));
    result.Set("error", StringToNapi(env, "Invalid window handle"));
    return result;
  }
  
  // Restore window styles
  LONG style = GetWindowLongW(hwnd, GWL_STYLE);
  style &= ~WS_CHILD;
  style |= (WS_CAPTION | WS_THICKFRAME | WS_MINIMIZEBOX | WS_MAXIMIZEBOX | WS_SYSMENU);
  SetWindowLongW(hwnd, GWL_STYLE, style);
  
  // Unparent
  HWND oldParent = SetParent(hwnd, NULL);
  
  // Restore window position
  SetWindowPos(hwnd, NULL, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_FRAMECHANGED);
  
  result.Set("success", Napi::Boolean::New(env, oldParent != NULL || GetLastError() == 0));
  if (oldParent == NULL && GetLastError() != 0) {
    result.Set("error", StringToNapi(env, GetLastErrorString()));
  }
  
  return result;
}

// TerminateProcess: Terminate a process
Napi::Object TerminateProcessNative(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  
  if (info.Length() < 1 || !info[0].IsNumber()) {
    Napi::TypeError::New(env, "Expected (processId: number)").ThrowAsJavaScriptException();
    return Napi::Object::New(env);
  }
  
  DWORD processId = info[0].As<Napi::Number>().Uint32Value();
  
  Napi::Object result = Napi::Object::New(env);
  
  HANDLE hProcess = OpenProcess(PROCESS_TERMINATE, FALSE, processId);
  if (hProcess == NULL) {
    result.Set("success", Napi::Boolean::New(env, false));
    result.Set("error", StringToNapi(env, "Failed to open process: " + GetLastErrorString()));
    return result;
  }
  
  BOOL success = TerminateProcess(hProcess, 0);
  CloseHandle(hProcess);
  
  result.Set("success", Napi::Boolean::New(env, success != FALSE));
  if (!success) {
    result.Set("error", StringToNapi(env, GetLastErrorString()));
  }
  
  return result;
}

// GetWindowInfo: Get window title and process name
Napi::Object GetWindowInfoNative(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  
  if (info.Length() < 1 || !info[0].IsNumber()) {
    Napi::TypeError::New(env, "Expected (hwnd: number)").ThrowAsJavaScriptException();
    return Napi::Object::New(env);
  }
  
  HWND hwnd = (HWND)(intptr_t)info[0].As<Napi::Number>().Int64Value();
  
  Napi::Object result = Napi::Object::New(env);
  
  if (!IsWindow(hwnd)) {
    result.Set("success", Napi::Boolean::New(env, false));
    result.Set("error", StringToNapi(env, "Invalid window handle"));
    return result;
  }
  
  // Get window title
  char title[256];
  GetWindowTextA(hwnd, title, sizeof(title));
  
  // Get process name
  DWORD processId;
  GetWindowThreadProcessId(hwnd, &processId);
  
  HANDLE hProcess = OpenProcess(PROCESS_QUERY_INFORMATION | PROCESS_VM_READ, FALSE, processId);
  std::string processName = "Unknown";
  
  if (hProcess != NULL) {
    char processPath[MAX_PATH];
    if (GetModuleFileNameExA(hProcess, NULL, processPath, MAX_PATH)) {
      processName = processPath;
      // Extract just the filename
      size_t pos = processName.find_last_of("\\/");
      if (pos != std::string::npos) {
        processName = processName.substr(pos + 1);
      }
    }
    CloseHandle(hProcess);
  }
  
  result.Set("success", Napi::Boolean::New(env, true));
  result.Set("title", StringToNapi(env, title));
  result.Set("processName", StringToNapi(env, processName));
  
  return result;
}

// GetMainWindowAPI: Find main window for a process ID
Napi::Object GetMainWindowAPI(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  
  if (info.Length() < 1 || !info[0].IsNumber()) {
    Napi::TypeError::New(env, "Expected (processId: number)").ThrowAsJavaScriptException();
    return Napi::Object::New(env);
  }
  
  DWORD processId = info[0].As<Napi::Number>().Uint32Value();
  
  Napi::Object result = Napi::Object::New(env);
  
  HWND hwnd = FindMainWindow(processId);
  
  if (hwnd != NULL && IsWindow(hwnd)) {
    result.Set("success", Napi::Boolean::New(env, true));
    result.Set("hwnd", Napi::Number::New(env, (intptr_t)hwnd));
  } else {
    result.Set("success", Napi::Boolean::New(env, false));
  }
  
  return result;
}

// Initialize module
Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set(Napi::String::New(env, "launchApplication"),
              Napi::Function::New(env, LaunchApplication));
  exports.Set(Napi::String::New(env, "embedWindow"),
              Napi::Function::New(env, EmbedWindow));
  exports.Set(Napi::String::New(env, "showWindow"),
              Napi::Function::New(env, ShowWindowNative));
  exports.Set(Napi::String::New(env, "resizeWindow"),
              Napi::Function::New(env, ResizeWindow));
  exports.Set(Napi::String::New(env, "moveWindow"),
              Napi::Function::New(env, MoveWindowNative));
  exports.Set(Napi::String::New(env, "unparentWindow"),
              Napi::Function::New(env, UnparentWindow));
  exports.Set(Napi::String::New(env, "terminateProcess"),
              Napi::Function::New(env, TerminateProcessNative));
  exports.Set(Napi::String::New(env, "getWindowInfo"),
              Napi::Function::New(env, GetWindowInfoNative));
  exports.Set(Napi::String::New(env, "getMainWindow"),
              Napi::Function::New(env, GetMainWindowAPI));
  
  // App discovery functions (defined in app-discovery.cc)
  exports.Set(Napi::String::New(env, "scanRegistry"),
              Napi::Function::New(env, ScanRegistry));
  exports.Set(Napi::String::New(env, "scanProgramFiles"),
              Napi::Function::New(env, ScanProgramFiles));
  exports.Set(Napi::String::New(env, "scanSystemApps"),
              Napi::Function::New(env, ScanSystemApps));
  exports.Set(Napi::String::New(env, "extractAppIcon"),
              Napi::Function::New(env, ExtractAppIcon));
  
  return exports;
}

NODE_API_MODULE(window_manager, Init)

