#ifndef APP_DISCOVERY_H
#define APP_DISCOVERY_H

#include <napi.h>

// Function declarations for app discovery
Napi::Array ScanRegistry(const Napi::CallbackInfo& info);
Napi::Array ScanProgramFiles(const Napi::CallbackInfo& info);
Napi::Array ScanSystemApps(const Napi::CallbackInfo& info);
Napi::String ExtractAppIcon(const Napi::CallbackInfo& info);

#endif

