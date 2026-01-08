#include <napi.h>
#include <windows.h>
#include <shlobj.h>
#include <shlwapi.h>
#include <string>
#include <vector>
#include <algorithm>
#include "app-discovery.h"

#pragma comment(lib, "shlwapi.lib")

// Helper function to convert std::string to Napi::String
static Napi::String StringToNapi(const Napi::Env& env, const std::string& str) {
  return Napi::String::New(env, str.c_str());
}

// Helper function to convert wide string to UTF-8 string
std::string WideToUtf8(const std::wstring& wstr) {
  if (wstr.empty()) return std::string();
  int size_needed = WideCharToMultiByte(CP_UTF8, 0, &wstr[0], (int)wstr.size(), NULL, 0, NULL, NULL);
  std::string strTo(size_needed, 0);
  WideCharToMultiByte(CP_UTF8, 0, &wstr[0], (int)wstr.size(), &strTo[0], size_needed, NULL, NULL);
  return strTo;
}

// Helper function to read registry string value
std::wstring ReadRegistryString(HKEY hKey, const std::wstring& subKey, const std::wstring& valueName) {
  HKEY hSubKey;
  if (RegOpenKeyExW(hKey, subKey.c_str(), 0, KEY_READ, &hSubKey) != ERROR_SUCCESS) {
    return L"";
  }
  
  DWORD dataSize = 0;
  DWORD type = REG_SZ;
  if (RegQueryValueExW(hSubKey, valueName.c_str(), NULL, &type, NULL, &dataSize) != ERROR_SUCCESS) {
    RegCloseKey(hSubKey);
    return L"";
  }
  
  std::vector<wchar_t> buffer(dataSize / sizeof(wchar_t) + 1);
  if (RegQueryValueExW(hSubKey, valueName.c_str(), NULL, &type, (LPBYTE)buffer.data(), &dataSize) != ERROR_SUCCESS) {
    RegCloseKey(hSubKey);
    return L"";
  }
  
  RegCloseKey(hSubKey);
  return std::wstring(buffer.data());
}

// Helper function to find executable path from install location or uninstall string
std::wstring FindExePath(const std::wstring& installLocation, const std::wstring& uninstallString) {
  // Try install location first
  if (!installLocation.empty()) {
    std::wstring searchPath = installLocation;
    if (searchPath.back() != L'\\') searchPath += L"\\";
    
    WIN32_FIND_DATAW findData;
    HANDLE hFind = FindFirstFileW((searchPath + L"*.exe").c_str(), &findData);
    if (hFind != INVALID_HANDLE_VALUE) {
      FindClose(hFind);
      // Prefer main executable (not uninstaller)
      if (wcsstr(findData.cFileName, L"uninstall") == NULL &&
          wcsstr(findData.cFileName, L"Uninstall") == NULL) {
        return searchPath + findData.cFileName;
      }
    }
    
    // Search recursively (limited depth)
    hFind = FindFirstFileW((searchPath + L"*").c_str(), &findData);
    if (hFind != INVALID_HANDLE_VALUE) {
      do {
        if (findData.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY) {
          if (wcscmp(findData.cFileName, L".") != 0 && wcscmp(findData.cFileName, L"..") != 0) {
            std::wstring subPath = searchPath + findData.cFileName + L"\\";
            WIN32_FIND_DATAW subFindData;
            HANDLE hSubFind = FindFirstFileW((subPath + L"*.exe").c_str(), &subFindData);
            if (hSubFind != INVALID_HANDLE_VALUE) {
              FindClose(hSubFind);
              if (wcsstr(subFindData.cFileName, L"uninstall") == NULL &&
                  wcsstr(subFindData.cFileName, L"Uninstall") == NULL) {
                FindClose(hFind);
                return subPath + subFindData.cFileName;
              }
            }
          }
        }
      } while (FindNextFileW(hFind, &findData));
      FindClose(hFind);
    }
  }
  
  // Try extracting from uninstall string
  if (!uninstallString.empty()) {
    size_t pos = uninstallString.find(L".exe");
    if (pos != std::wstring::npos) {
      size_t start = uninstallString.find(L"\"");
      if (start != std::wstring::npos) {
        size_t end = uninstallString.find(L"\"", start + 1);
        if (end != std::wstring::npos) {
          std::wstring path = uninstallString.substr(start + 1, end - start - 1);
          if (PathFileExistsW(path.c_str())) {
            return path;
          }
        }
      }
    }
  }
  
  return L"";
}

// ScanRegistry: Scan Windows Registry for installed applications
Napi::Array ScanRegistry(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  Napi::Array result = Napi::Array::New(env);
  
  HKEY hKey;
  if (RegOpenKeyExW(HKEY_LOCAL_MACHINE,
    L"SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall",
    0, KEY_READ, &hKey) != ERROR_SUCCESS) {
    return result;
  }
  
  DWORD index = 0;
  wchar_t subKeyName[256];
  DWORD subKeyNameSize;
  int arrayIndex = 0;
  
  while (true) {
    subKeyNameSize = sizeof(subKeyName) / sizeof(wchar_t);
    if (RegEnumKeyExW(hKey, index, subKeyName, &subKeyNameSize, NULL, NULL, NULL, NULL) != ERROR_SUCCESS) {
      break;
    }
    
    std::wstring subKey = L"SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\";
    subKey += subKeyName;
    
    std::wstring displayName = ReadRegistryString(HKEY_LOCAL_MACHINE, subKey, L"DisplayName");
    if (displayName.empty()) {
      index++;
      continue;
    }
    
    // Filter out system updates
    std::wstring lowerName = displayName;
    std::transform(lowerName.begin(), lowerName.end(), lowerName.begin(), ::towlower);
    if (lowerName.find(L"update") != std::wstring::npos ||
        lowerName.find(L"hotfix") != std::wstring::npos ||
        lowerName.find(L"kb") != std::wstring::npos) {
      index++;
      continue;
    }
    
    std::wstring installLocation = ReadRegistryString(HKEY_LOCAL_MACHINE, subKey, L"InstallLocation");
    std::wstring uninstallString = ReadRegistryString(HKEY_LOCAL_MACHINE, subKey, L"UninstallString");
    std::wstring displayIcon = ReadRegistryString(HKEY_LOCAL_MACHINE, subKey, L"DisplayIcon");
    
    std::wstring exePath = FindExePath(installLocation, uninstallString);
    if (exePath.empty() && !displayIcon.empty()) {
      // Try to extract path from icon string
      size_t pos = displayIcon.find(L",");
      if (pos != std::wstring::npos) {
        exePath = displayIcon.substr(0, pos);
      } else {
        exePath = displayIcon;
      }
      // Remove quotes
      if (exePath.front() == L'"') exePath = exePath.substr(1);
      if (exePath.back() == L'"') exePath = exePath.substr(0, exePath.length() - 1);
    }
    
    if (exePath.empty() || !PathFileExistsW(exePath.c_str())) {
      index++;
      continue;
    }
    
    Napi::Object app = Napi::Object::New(env);
    app.Set("id", StringToNapi(env, WideToUtf8(subKeyName)));
    app.Set("name", StringToNapi(env, WideToUtf8(displayName)));
    app.Set("path", StringToNapi(env, WideToUtf8(exePath)));
    app.Set("icon", StringToNapi(env, WideToUtf8(displayIcon)));
    
    result.Set(arrayIndex++, app);
    index++;
  }
  
  RegCloseKey(hKey);
  return result;
}

// Helper function to recursively find executables in directory
void FindExecutablesInDirectory(const std::wstring& dirPath, std::vector<std::wstring>& exePaths, int maxDepth = 2, int currentDepth = 0) {
  if (currentDepth >= maxDepth) return;
  
  std::wstring searchPath = dirPath;
  if (searchPath.back() != L'\\') searchPath += L"\\";
  searchPath += L"*";
  
  WIN32_FIND_DATAW findData;
  HANDLE hFind = FindFirstFileW(searchPath.c_str(), &findData);
  if (hFind == INVALID_HANDLE_VALUE) return;
  
  do {
    if (wcscmp(findData.cFileName, L".") == 0 || wcscmp(findData.cFileName, L"..") == 0) {
      continue;
    }
    
    std::wstring fullPath = dirPath;
    if (fullPath.back() != L'\\') fullPath += L"\\";
    fullPath += findData.cFileName;
    
    if (findData.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY) {
      // Skip common system directories
      if (wcsstr(findData.cFileName, L"Windows") != NULL ||
          wcsstr(findData.cFileName, L"ProgramData") != NULL ||
          wcsstr(findData.cFileName, L"$") != NULL) {
        continue;
      }
      FindExecutablesInDirectory(fullPath, exePaths, maxDepth, currentDepth + 1);
    } else if (wcsstr(findData.cFileName, L".exe") != NULL) {
      // Skip uninstallers and common system files
      std::wstring lowerName = findData.cFileName;
      std::transform(lowerName.begin(), lowerName.end(), lowerName.begin(), ::towlower);
      if (lowerName.find(L"uninstall") == std::wstring::npos &&
          lowerName.find(L"setup") == std::wstring::npos &&
          lowerName.find(L"install") == std::wstring::npos) {
        exePaths.push_back(fullPath);
      }
    }
  } while (FindNextFileW(hFind, &findData));
  
  FindClose(hFind);
}

// ScanProgramFiles: Scan Program Files directories for executables
Napi::Array ScanProgramFiles(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  Napi::Array result = Napi::Array::New(env);
  
  std::vector<std::wstring> programDirs = {
    L"C:\\Program Files",
    L"C:\\Program Files (x86)"
  };
  
  std::vector<std::wstring> exePaths;
  
  for (const auto& programDir : programDirs) {
    if (PathFileExistsW(programDir.c_str())) {
      FindExecutablesInDirectory(programDir, exePaths, 2);
    }
  }
  
  int arrayIndex = 0;
  for (const auto& exePath : exePaths) {
    // Extract app name from path
    size_t lastSlash = exePath.find_last_of(L"\\/");
    std::wstring fileName = (lastSlash != std::wstring::npos) ? 
      exePath.substr(lastSlash + 1) : exePath;
    
    // Remove .exe extension
    size_t dotPos = fileName.find_last_of(L".");
    if (dotPos != std::wstring::npos) {
      fileName = fileName.substr(0, dotPos);
    }
    
    Napi::Object app = Napi::Object::New(env);
    app.Set("id", StringToNapi(env, WideToUtf8(fileName) + "_" + std::to_string(arrayIndex)));
    app.Set("name", StringToNapi(env, WideToUtf8(fileName)));
    app.Set("path", StringToNapi(env, WideToUtf8(exePath)));
    app.Set("icon", Napi::String::New(env, "")); // Icons extracted separately if needed
    
    result.Set(arrayIndex++, app);
  }
  
  return result;
}

// ScanSystemApps: Scan Windows System32 for common system apps
Napi::Array ScanSystemApps(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  Napi::Array result = Napi::Array::New(env);
  
  // Common Windows system apps that users might want to use
  struct SystemApp {
    const wchar_t* name;
    const wchar_t* exeName;
    const wchar_t* path;
  };
  
  std::vector<SystemApp> systemApps = {
    { L"Notepad", L"notepad.exe", L"C:\\Windows\\System32\\notepad.exe" },
    { L"Calculator", L"calc.exe", L"C:\\Windows\\System32\\calc.exe" },
    { L"Paint", L"mspaint.exe", L"C:\\Windows\\System32\\mspaint.exe" },
    { L"Command Prompt", L"cmd.exe", L"C:\\Windows\\System32\\cmd.exe" },
    { L"Windows PowerShell", L"powershell.exe", L"C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" },
    { L"Task Manager", L"taskmgr.exe", L"C:\\Windows\\System32\\taskmgr.exe" },
    { L"Registry Editor", L"regedit.exe", L"C:\\Windows\\regedit.exe" },
    { L"Character Map", L"charmap.exe", L"C:\\Windows\\System32\\charmap.exe" },
    { L"Snipping Tool", L"SnippingTool.exe", L"C:\\Windows\\System32\\SnippingTool.exe" },
    { L"Magnifier", L"magnify.exe", L"C:\\Windows\\System32\\magnify.exe" },
    { L"On-Screen Keyboard", L"osk.exe", L"C:\\Windows\\System32\\osk.exe" },
    { L"Remote Desktop Connection", L"mstsc.exe", L"C:\\Windows\\System32\\mstsc.exe" }
  };
  
  int arrayIndex = 0;
  for (const auto& app : systemApps) {
    // Check if the file exists
    if (PathFileExistsW(app.path)) {
      Napi::Object appObj = Napi::Object::New(env);
      appObj.Set("id", StringToNapi(env, WideToUtf8(std::wstring(app.exeName)) + "_system"));
      appObj.Set("name", StringToNapi(env, WideToUtf8(std::wstring(app.name))));
      appObj.Set("path", StringToNapi(env, WideToUtf8(std::wstring(app.path))));
      appObj.Set("icon", StringToNapi(env, WideToUtf8(std::wstring(app.path))));
      
      result.Set(arrayIndex++, appObj);
    }
  }
  
  return result;
}

// ExtractAppIcon: Extract icon from executable (simplified - returns path for now)
Napi::String ExtractAppIcon(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  
  if (info.Length() < 1 || !info[0].IsString()) {
    Napi::TypeError::New(env, "Expected (exePath: string)").ThrowAsJavaScriptException();
    return Napi::String::New(env, "");
  }
  
  std::string exePath = info[0].As<Napi::String>().Utf8Value();
  
  // For now, just return the exe path - icon extraction to base64 is complex
  // and can be done in JavaScript if needed
  // Full implementation would use ExtractIconEx and convert to PNG/base64
  return StringToNapi(env, exePath);
}

// Functions are exported from window-manager.cc's Init function
// This file contains the implementations

