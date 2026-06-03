#include <napi.h>

/**
 * Linux Stub for Window Manager
 * Provides empty implementations of Windows-only features to prevent crashes
 * while allowing the native module to be compiled and loaded on Linux.
 */

Napi::Value LaunchApplication(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    Napi::Object result = Napi::Object::New(env);
    result.Set("success", Napi::Boolean::New(env, false));
    result.Set("error", Napi::String::New(env, "Native application launching is not supported on Linux."));
    return result;
}

Napi::Value EmbedWindow(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    Napi::Object result = Napi::Object::New(env);
    result.Set("success", Napi::Boolean::New(env, false));
    result.Set("error", Napi::String::New(env, "Native window embedding is not supported on Linux."));
    return result;
}

Napi::Value ShowWindow(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    Napi::Object result = Napi::Object::New(env);
    result.Set("success", Napi::Boolean::New(env, true));
    return result;
}

Napi::Value ResizeWindow(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    Napi::Object result = Napi::Object::New(env);
    result.Set("success", Napi::Boolean::New(env, true));
    return result;
}

Napi::Value MoveWindow(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    Napi::Object result = Napi::Object::New(env);
    result.Set("success", Napi::Boolean::New(env, true));
    return result;
}

Napi::Value UnparentWindow(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    Napi::Object result = Napi::Object::New(env);
    result.Set("success", Napi::Boolean::New(env, true));
    return result;
}

Napi::Value TerminateProcess(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    Napi::Object result = Napi::Object::New(env);
    result.Set("success", Napi::Boolean::New(env, true));
    return result;
}

Napi::Value GetWindowInfo(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    Napi::Object result = Napi::Object::New(env);
    result.Set("success", Napi::Boolean::New(env, false));
    result.Set("error", Napi::String::New(env, "Window info retrieval is not supported on Linux."));
    return result;
}

Napi::Value GetMainWindow(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    Napi::Object result = Napi::Object::New(env);
    result.Set("success", Napi::Boolean::New(env, false));
    return result;
}

// App discovery stubs
Napi::Value ScanRegistry(const Napi::CallbackInfo& info) {
    return Napi::Array::New(info.Env());
}

Napi::Value ScanProgramFiles(const Napi::CallbackInfo& info) {
    return Napi::Array::New(info.Env());
}

Napi::Value ScanSystemApps(const Napi::CallbackInfo& info) {
    return Napi::Array::New(info.Env());
}

Napi::Value ExtractAppIcon(const Napi::CallbackInfo& info) {
    return Napi::String::New(info.Env(), "");
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
    exports.Set("launchApplication", Napi::Function::New(env, LaunchApplication));
    exports.Set("embedWindow", Napi::Function::New(env, EmbedWindow));
    exports.Set("showWindow", Napi::Function::New(env, ShowWindow));
    exports.Set("resizeWindow", Napi::Function::New(env, ResizeWindow));
    exports.Set("moveWindow", Napi::Function::New(env, MoveWindow));
    exports.Set("unparentWindow", Napi::Function::New(env, UnparentWindow));
    exports.Set("terminateProcess", Napi::Function::New(env, TerminateProcess));
    exports.Set("getWindowInfo", Napi::Function::New(env, GetWindowInfo));
    exports.Set("getMainWindow", Napi::Function::New(env, GetMainWindow));
    
    // App discovery functions
    exports.Set("scanRegistry", Napi::Function::New(env, ScanRegistry));
    exports.Set("scanProgramFiles", Napi::Function::New(env, ScanProgramFiles));
    exports.Set("scanSystemApps", Napi::Function::New(env, ScanSystemApps));
    exports.Set("extractAppIcon", Napi::Function::New(env, ExtractAppIcon));
    
    return exports;
}

NODE_API_MODULE(window_manager, Init)
